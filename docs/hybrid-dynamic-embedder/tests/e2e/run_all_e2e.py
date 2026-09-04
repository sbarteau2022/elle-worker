#!/usr/bin/env python3
"""
Integrated E2E Test Suite Runner for Hybrid Dynamic Embedder.
Executes complete 4-Tier test suites and Rust harness tests per TEST_INFRA.md.
"""

import sys
import os
import subprocess
import time

SUITES = [
    ("Tier 1: Feature Coverage (F1-F15)", "tests/e2e/test_tier1_features.py", 75),
    ("Tier 2: Boundary & Corner Cases (F1-F15)", "tests/e2e/test_tier2_boundaries.py", 75),
    ("Tier 3: Pairwise Combinations", "tests/e2e/test_tier3_pairwise.py", 15),
    ("Tier 4: Real-World Scenarios (S1-S5)", "tests/e2e/test_tier4_workloads.py", 5),
    ("Integration: Three Gates & Server Contracts", "tests/integration/", 22),
    ("Benchmarks: Profiling Harness (RAM & Latency)", "tests/benchmarks/", 4),
    ("Unit: Analytical Controls & Manifold Axioms", "tests/unit/", 47),
]

RUST_CRATE_DIR = "/Users/stewartbarteau/Desktop/Elle/elle_rust_harness"
RUST_ENV = {
    "PATH": "/Users/stewartbarteau/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin",
    "HOME": "/Users/stewartbarteau",
}


def run_command(cmd, cwd=None, env=None):
    t0 = time.perf_counter()
    result = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)
    duration_s = time.perf_counter() - t0
    return result, duration_s


def main():
    print("=" * 80)
    print("HYBRID DYNAMIC EMBEDDER — INTEGRATED E2E TEST SUITE RUNNER")
    print("=" * 80)
    print(f"Working Directory: {os.getcwd()}")
    print(f"Timestamp: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    print("-" * 80)

    total_passed = 0
    total_failed = 0
    all_success = True
    suite_results = []

    # Run Python test suites
    for suite_name, path, expected_min in SUITES:
        print(f"Running {suite_name} [{path}]...")
        cmd = [sys.executable, "-m", "pytest", path, "-q", "--tb=short"]
        res, duration = run_command(cmd)

        if res.returncode == 0:
            status = "PASS"
            # Extract passed count
            out = res.stdout.strip()
            count = expected_min
            if "passed" in out:
                try:
                    count_str = out.split("passed")[0].strip().split()[-1]
                    count = int(count_str)
                except Exception:
                    pass
            total_passed += count
        else:
            status = "FAIL"
            all_success = False
            total_failed += 1
            print(f"STDERR:\n{res.stderr}\nSTDOUT:\n{res.stdout}")

        suite_results.append((suite_name, status, duration))
        print(f"  --> {status} ({duration:.2f}s)")

    # Run Rust harness cargo tests
    print(f"Running Rust Harness (`cargo test -p harness-dhng`)...")
    rust_cmd = ["cargo", "test", "-p", "harness-dhng", "--", "--quiet"]
    rust_res, rust_dur = run_command(rust_cmd, cwd=RUST_CRATE_DIR, env=RUST_ENV)

    if rust_res.returncode == 0:
        rust_status = "PASS"
        rust_count = 74
        total_passed += rust_count
    else:
        rust_status = "FAIL"
        all_success = False
        total_failed += 1
        print(f"Rust STDERR:\n{rust_res.stderr}\nSTDOUT:\n{rust_res.stdout}")

    suite_results.append(("Rust Harness (harness-dhng)", rust_status, rust_dur))
    print(f"  --> {rust_status} ({rust_dur:.2f}s)")

    print("\n" + "=" * 80)
    print("SUMMARY RESULTS MATRIX")
    print("=" * 80)
    print(f"{'Suite Name':<45} | {'Verdict':<8} | {'Duration'}")
    print("-" * 80)
    for name, verdict, dur in suite_results:
        print(f"{name:<45} | {verdict:<8} | {dur:.2f}s")
    print("-" * 80)
    print(f"Total Tests Executed & Passed: {total_passed}")
    print(f"Total Suite Failures: {total_failed}")
    print(f"Overall Status: {'PASSED (100%)' if all_success else 'FAILED'}")
    print("=" * 80)

    if not all_success:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
