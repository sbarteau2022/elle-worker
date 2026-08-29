#!/usr/bin/env bash
set -euo pipefail
# Ensure cargo's rustc (via rustup) is first in PATH
export PATH="$HOME/.cargo/bin:$PATH"
# Build the Rust WASM crate and output to the public directory
cd "$(dirname "$0")/crates/elle-core-wasm"
wasm-pack build --target web --out-dir ../../public/wasm .
ls -l "../../public/wasm"
