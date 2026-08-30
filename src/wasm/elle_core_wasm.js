/* @ts-self-types="./elle_core_wasm.d.ts" */
import * as wasm from "./elle_core_wasm_bg.wasm";
import { __wbg_set_wasm } from "./elle_core_wasm_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    cordic_sin_cos, cordic_sinh_cosh, div_q_wasm, gabor_filter_2d, mul_q_wasm, poincare_distance, poincare_distance_q30, real_fft
} from "./elle_core_wasm_bg.js";
