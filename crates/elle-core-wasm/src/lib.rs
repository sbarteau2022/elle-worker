// src/lib.rs

use wasm_bindgen::prelude::*;

const FRAC_BITS: i32 = 30;
const ONE: i32 = 1 << FRAC_BITS;
const ONE_BIG: i128 = ONE as i128;

#[inline]
fn mul_q(a: i32, b: i32) -> i32 {
    ((a as i128 * b as i128) / ONE_BIG) as i32
}

#[inline]
fn div_q(num: i32, den: i32) -> i32 {
    if den == 0 {
        // Symmetric sentinel, matching src/fixed-math.ts `fixedDiv`, which
        // returns +/-0x7fffffff and is pinned by src/fixed-math.test.ts.
        // This used to return i32::MIN (-0x80000000) on the negative branch —
        // one LSB apart from the TypeScript twin. Both implementations feed the
        // Q0.30 keystream walk that each end of the session bus derives
        // independently, so a single divergent step yields a different key and
        // the lane goes silently deaf with no failing test to attribute it.
        if num >= 0 { i32::MAX } else { -i32::MAX }
    } else {
        ((num as i128 * ONE_BIG) / den as i128) as i32
    }
}

// ----- Circular CORDIC (sin/cos) -----
const CIRC_ITERS: usize = 28;
const ATAN_TABLE: [i32; 28] = [
    843_314_857, 497_837_829, 263_043_837, 133_525_159, 67_021_687,
    33_543_516, 16_775_851, 8_388_437, 4_194_283, 2_097_149, 1_048_576,
    524_288, 262_144, 131_072, 65_536, 32_768, 16_384, 8_192, 4_096, 2_048,
    1_024, 512, 256, 128, 64, 32, 16, 8,
];
const CIRC_GAIN_INV: i32 = 652_032_874;

#[wasm_bindgen]
pub fn cordic_sin_cos(theta_q: i32) -> JsValue {
    let mut x = CIRC_GAIN_INV;
    let mut y: i32 = 0;
    let mut z = theta_q;
    for i in 0..CIRC_ITERS {
        let dx = x >> i;
        let dy = y >> i;
        if z >= 0 {
            x = x - dy;
            y = y + dx;
            z = z - ATAN_TABLE[i];
        } else {
            x = x + dy;
            y = y - dx;
            z = z + ATAN_TABLE[i];
        }
    }
    let obj = js_sys::Object::new();
    js_sys::Reflect::set(&obj, &JsValue::from_str("cos"), &JsValue::from(x)).unwrap();
    js_sys::Reflect::set(&obj, &JsValue::from_str("sin"), &JsValue::from(y)).unwrap();
    obj.into()
}

// ----- Hyperbolic CORDIC (sinh/cosh) -----
const HYP_ITERS: usize = 24;
const HYP_SEQ: [usize; 24] = [1,2,3,4,4,5,6,7,8,9,10,11,12,13,13,14,15,16,17,18,19,20,21,22];
const ATANH_TABLE: [i32; 24] = [
    589_812_981, 274_247_419, 134_923_406, 67_196_451, 67_196_451,
    33_565_361, 16_778_582, 8_388_779, 4_194_325, 2_097_155,
    1_048_576, 524_288, 262_144, 131_072, 131_072, 65_536,
    32_768, 16_384, 8_192, 4_096, 2_048, 1_024, 512, 256,
];
const HYP_GAIN_INV: i32 = 1_296_540_104;

#[wasm_bindgen]
pub fn cordic_sinh_cosh(s_q: i32) -> JsValue {
    let mut x = HYP_GAIN_INV;
    let mut y: i32 = 0;
    let mut z = s_q;
    for k in 0..HYP_ITERS {
        let i = HYP_SEQ[k];
        let dx = x >> i;
        let dy = y >> i;
        if z >= 0 {
            x = x + dy;
            y = y + dx;
            z = z - ATANH_TABLE[k];
        } else {
            x = x - dy;
            y = y - dx;
            z = z + ATANH_TABLE[k];
        }
    }
    let obj = js_sys::Object::new();
    js_sys::Reflect::set(&obj, &JsValue::from_str("cosh"), &JsValue::from(x)).unwrap();
    js_sys::Reflect::set(&obj, &JsValue::from_str("sinh"), &JsValue::from(y)).unwrap();
    obj.into()
}

// ----- Poincaré distance (hyperbolic metric) -----
#[wasm_bindgen]
pub fn poincare_distance_q30(px: i32, py: i32, qx: i32, qy: i32) -> i32 {
    // Q0.30 in, Q0.30 out — but the ratio is computed in f64 on purpose.
    //
    // Two defects made the fixed-point form unusable. First, `mul_q(dist_sq, 2)`
    // ran the constant 2 through a Q0.30 * Q0.30 -> Q0.30 multiply, scaling the
    // numerator by 2/2^30 rather than by 2; every distance collapsed to ~0
    // (d((0.3,0),(-0.3,0)) returned 0.000000 against a true 1.238078), so all
    // recall ranking over the ball tied at zero. Second, and not fixable by
    // correcting that constant: Q0.30 carries ONE integer bit, so it tops out
    // just below 2.0, while gamma = 1 + 2||u-v||^2 / ((1-||u||^2)(1-||v||^2))
    // reaches 90.7 for a pair as ordinary as (0.9,0) and (0,0.9). The numerator
    // saturates, div_q's `as i32` wraps it negative, and acosh of a sub-1 term
    // silently returns 0 for the two most distant points in the ball.
    //
    // Computing gamma in f64 is not a concession: this function already used
    // f64 `.sqrt()` and `.ln()` for the arcosh, so the cross-runtime bit-
    // determinism that motivated fixed point was never actually delivered here.
    // Keeping the Q0.30 ABI preserves every caller.
    let scale = ONE as f64;
    let (pxf, pyf) = (px as f64 / scale, py as f64 / scale);
    let (qxf, qyf) = (qx as f64 / scale, qy as f64 / scale);

    let dist_sq = (pxf - qxf).powi(2) + (pyf - qyf).powi(2);
    let one_minus_p = 1.0 - (pxf * pxf + pyf * pyf);
    let one_minus_q = 1.0 - (qxf * qxf + qyf * qyf);

    // Outside or on the boundary the metric is undefined; report saturation
    // rather than a wrapped value a caller cannot distinguish from a real one.
    if one_minus_p <= 0.0 || one_minus_q <= 0.0 {
        return i32::MAX;
    }

    let term = 1.0 + 2.0 * dist_sq / (one_minus_p * one_minus_q);
    let d = (term + (term * term - 1.0).sqrt()).ln();

    // Q0.30 holds |x| < 2, so any distance past ~1.9999999991 nats cannot be
    // returned through this ABI at all — and real pairs blow through that
    // routinely: d((0.9,0),(0,0.9)) is 5.201, and the plan's own eps=1e-5
    // boundary projection admits radial depth 2*atanh(1-1e-5) = 12.21. Saturate
    // at i32::MAX so a caller can SEE the ceiling, rather than wrapping to a
    // small number that ranks as "very close". New callers should prefer
    // `poincare_distance` (f64), which has the range this metric needs.
    let raw = d * scale;
    if raw >= i32::MAX as f64 {
        i32::MAX
    } else {
        raw.round() as i32
    }
}

/// Poincare-ball geodesic distance in 2-D, f64 in and out.
///
/// The Q0.30 variant above cannot represent this metric's range: one integer
/// bit tops out below 2.0 nats while ordinary in-ball pairs exceed 5. This is
/// the export new code should use.
#[wasm_bindgen]
pub fn poincare_distance(px: f64, py: f64, qx: f64, qy: f64) -> f64 {
    let dist_sq = (px - qx).powi(2) + (py - qy).powi(2);
    let one_minus_p = 1.0 - (px * px + py * py);
    let one_minus_q = 1.0 - (qx * qx + qy * qy);
    if one_minus_p <= 0.0 || one_minus_q <= 0.0 {
        return f64::INFINITY;
    }
    let term = 1.0 + 2.0 * dist_sq / (one_minus_p * one_minus_q);
    (term + (term * term - 1.0).sqrt()).ln()
}

// Utility exports for testing
#[wasm_bindgen]
pub fn mul_q_wasm(a: i32, b: i32) -> i32 { mul_q(a, b) }

#[wasm_bindgen]
pub fn div_q_wasm(num: i32, den: i32) -> i32 { div_q(num, den) }

/// Compute a radix‑2 Cooley‑Tukey FFT on Q30 fixed‑point data.
/// `input` length must be a power of two. Returns interleaved real/imag Q30 values.
#[wasm_bindgen]
pub fn real_fft(input: &[i32]) -> Vec<i32> {
    let n = input.len();
    assert!(n.is_power_of_two(), "FFT length must be power of two");
    let mut real: Vec<i32> = input.to_vec();
    let mut imag: Vec<i32> = vec![0; n];

    // Bit‑reversal permutation
    let mut j: usize = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            real.swap(i, j);
            imag.swap(i, j);
        }
    }

    // Cooley‑Tukey stages
    let mut len = 2;
    while len <= n {
        let half = len / 2;
        // Twiddle factors for this stage (angle = -2π/len)
        let angle = -std::f64::consts::PI * 2.0 / (len as f64);
        let cos_f = angle.cos();
        let sin_f = angle.sin();
        let cos_q = (cos_f * (ONE as f64)).round() as i32;
        let sin_q = (sin_f * (ONE as f64)).round() as i32;

        for i in (0..n).step_by(len) {
            let mut w_real = ONE;
            let mut w_imag = 0;
            for j in 0..half {
                let idx = i + j;
                let idx_pair = idx + half;
                // t = w * a[idx_pair]
                let tr = mul_q(w_real, real[idx_pair]) - mul_q(w_imag, imag[idx_pair]);
                let ti = mul_q(w_real, imag[idx_pair]) + mul_q(w_imag, real[idx_pair]);

                let ur = real[idx];
                let ui = imag[idx];
                real[idx] = ur + tr;
                imag[idx] = ui + ti;
                real[idx_pair] = ur - tr;
                imag[idx_pair] = ui - ti;

                // w = w * twiddle
                let w_r = mul_q(w_real, cos_q) - mul_q(w_imag, sin_q);
                let w_i = mul_q(w_real, sin_q) + mul_q(w_imag, cos_q);
                w_real = w_r;
                w_imag = w_i;
            }
        }
        len <<= 1;
    }

    // Interleave real and imag for JS
    let mut out = Vec::with_capacity(n * 2);
    for i in 0..n {
        out.push(real[i]);
        out.push(imag[i]);
    }
    out
}

/// Simple separable 2‑D Gabor filter on an 8‑bit grayscale image.
/// Returns a new image buffer of the same size.
#[wasm_bindgen]
pub fn gabor_filter_2d(input: &[u8], width: usize, height: usize, sigma: f32, freq: f32) -> Vec<u8> {
    let mut output = vec![0u8; width * height];
    let two_pi_f = 2.0 * std::f32::consts::PI * freq;
    for y in 0..height {
        for x in 0..width {
            let idx = y * width + x;
            let pixel = input[idx] as f32 / 255.0;
            let gx = x as f32 - (width as f32 / 2.0);
            let gy = y as f32 - (height as f32 / 2.0);
            let gauss = (-(gx * gx + gy * gy) / (2.0 * sigma * sigma)).exp();
            let sinusoid = (two_pi_f * gx).cos();
            let val = (pixel * gauss * sinusoid).clamp(0.0, 1.0);
            output[idx] = (val * 255.0) as u8;
        }
    }
    output
}

#[cfg(test)]

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mul_div_q() {
        let half = ONE / 2;
        let quarter = mul_q(half, half);
        assert_eq!(quarter, ONE / 4);

        let div_res = div_q(quarter, half);
        assert_eq!(div_res, half);
    }

    #[test]
    fn test_cordic_sin_cos_zero() {
        // At theta = 0, sin(0) = 0, cos(0) ~ 1.0 (ONE = 1073741824)
        let mut x = CIRC_GAIN_INV;
        let mut y: i32 = 0;
        let mut z = 0;
        for i in 0..CIRC_ITERS {
            let dx = x >> i;
            let dy = y >> i;
            if z >= 0 {
                x = x - dy;
                y = y + dx;
                z = z - ATAN_TABLE[i];
            } else {
                x = x + dy;
                y = y - dx;
                z = z + ATAN_TABLE[i];
            }
        }
        // Check cos ~ ONE and sin ~ 0
        let diff_cos = (x - ONE).abs();
        assert!(diff_cos < 10, "diff_cos = {}", diff_cos);
        let diff_sin = y.abs();
        assert!(diff_sin < 10, "diff_sin = {}", diff_sin);
    }

    #[test]
    fn test_poincare_distance_origin() {
        let d = poincare_distance_q30(0, 0, 0, 0);
        assert_eq!(d, 0);
    }
}



#[cfg(test)]
mod poincare_tests {
    use super::*;
    fn q(x: f64) -> i32 { (x * ONE as f64).round() as i32 }
    fn truth(px: f64, py: f64, qx: f64, qy: f64) -> f64 {
        let d = (px - qx).powi(2) + (py - qy).powi(2);
        let a = 1.0 - (px * px + py * py);
        let b = 1.0 - (qx * qx + qy * qy);
        (1.0 + 2.0 * d / (a * b)).acosh()
    }

    /// Regression: `mul_q(dist_sq, 2)` scaled the numerator by 2/2^30 rather
    /// than 2, collapsing every distance to ~0.
    #[test]
    fn distance_matches_f64_reference() {
        for &(px, py, qx, qy) in &[
            (0.3, 0.0, -0.3, 0.0),
            (0.1, 0.1, 0.5, -0.4),
            (0.2, 0.0, 0.4, 0.0),
            (0.9, 0.0, 0.0, 0.9),
            (0.0, 0.0, 0.99, 0.0),
        ] {
            let want = truth(px, py, qx, qy);
            let got = poincare_distance(px, py, qx, qy);
            assert!(
                (got - want).abs() < 1e-9,
                "d(({px},{py}),({qx},{qy})) = {got}, want {want}"
            );
            // The Q0.30 export must either agree or saturate visibly — never
            // wrap to a small value that would rank as "close".
            let q30 = poincare_distance_q30(q(px), q(py), q(qx), q(qy));
            if want < 1.999 {
                assert!(
                    ((q30 as f64 / ONE as f64) - want).abs() < 1e-6,
                    "q30 d = {}, want {want}", q30 as f64 / ONE as f64
                );
            } else {
                assert_eq!(q30, i32::MAX, "out-of-range pair must saturate, not wrap");
            }
        }
    }

    /// Distance along a radial ray must be strictly increasing — the property
    /// that made the collapse visible as "every recall ties at zero".
    #[test]
    fn distance_is_monotone_along_a_ray() {
        let mut last = -1.0f64;
        for &r in &[0.1f64, 0.3, 0.5, 0.7, 0.9, 0.99] {
            let d = poincare_distance(0.0, 0.0, r, 0.0);
            assert!(d > last, "d(0,{r}) = {d} did not exceed previous {last}");
            last = d;
        }
    }

    #[test]
    fn identical_points_are_zero_distance() {
        assert_eq!(poincare_distance_q30(q(0.4), q(0.2), q(0.4), q(0.2)), 0);
    }
}
