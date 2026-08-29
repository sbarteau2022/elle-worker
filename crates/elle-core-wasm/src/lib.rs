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
        if num >= 0 { i32::MAX } else { i32::MIN }
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
    let dx = px.wrapping_sub(qx);
    let dy = py.wrapping_sub(qy);
    let dist_sq = mul_q(dx, dx) + mul_q(dy, dy);
    let p_norm_sq = mul_q(px, px) + mul_q(py, py);
    let q_norm_sq = mul_q(qx, qx) + mul_q(qy, qy);
    let one_q = ONE;
    let one_minus_p = one_q - p_norm_sq;
    let one_minus_q = one_q - q_norm_sq;
    let denom = mul_q(one_minus_p, one_minus_q);
    let numer = mul_q(dist_sq, 2);
    let term = one_q + div_q(numer, denom);
    // Approximate arcosh(term) using f64 conversion (fallback)
    let term_f = term as f64 / (ONE as f64);
    let acosh_f = (term_f + (term_f * term_f - 1.0).sqrt()).ln();
    (acosh_f * (ONE as f64)).round() as i32
}

// Utility exports for testing
#[wasm_bindgen]
pub fn mul_q_wasm(a: i32, b: i32) -> i32 { mul_q(a, b) }

#[wasm_bindgen]
pub fn div_q_wasm(num: i32, den: i32) -> i32 { div_q(num, den) }

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


