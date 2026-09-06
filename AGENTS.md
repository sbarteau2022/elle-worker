# Workspace Rules & Architecture Invariants

This repository operates under strict architectural and operational guidelines. All AI agents and pair-programming sessions must follow these rules without exception.

## 1. Local Desktop Repository Invariant
- **Strict Local Commitment**: All generated code, training configs, checkpoints, benchmarks, evaluation outputs, logs, and synthesis reports MUST be written directly to and committed within the local Desktop repositories (`hybrid-HNPA-active-inference-LLM`, `Elle`, `elle-worker`).
- **Zero Ephemeral/Remote Leakage**: Never redirect outputs or create ephemeral workspaces in `/tmp`, unmonitored system paths, or external cloud directories unless explicitly requested by the user.

## 2. Coordinator KV Cache Isolation
- **Coordinator Memory Independence**: The coordinator's reasoning memory and `BreathingKVCache` must remain **completely separate** from the swarm workers.
- **Cache Namespaces**: The coordinator maintains an independent cache namespace (`sharedNs` for constant preambles; private coordinator memory for reasoning). Transient specialist agent executions must never read, write, or leak into the coordinator's KV window.

## 3. Pre-Flight Manifold Weight Verification
- **Pre-Flight Sanity Gate**: When working with custom manifold architectures (e.g., Toroidal $\mathbb{T}^n$, Hyperbolic $\mathbb{H}^n$, Symplectic Hamiltonian flows), never trust a trivial loss decrease ($12.70 \to 12.38$) as a training gate.
- **Language Baseline**: Cross-entropy loss on a natural sentence (*"The capital of France is Paris."*) must be $< 3.0$ nats (verifying the model is not guessing uniformly over vocabulary $\ln(|V|) \approx 12.4$).
- **Behavioral Baseline**: Greedy generation on test problems must demonstrate fluent step-by-step reasoning with $>0$ baseline accuracy and $\ge 98\%$ answer parse rate before launching unattended multi-hour chains.

## 4. Robust Benchmark Answer Extraction
- **Prompt Leak Truncation**: When evaluating base or fine-tuned LLMs on GSM8K or math reasoning tasks, always truncate synthetic few-shot prompt loops (`\nQuestion:`, `\nQ:`, `\nAnswer: Let me`) before regex number extraction to prevent hallucinated trailing question numbers from corrupting the parsed prediction.

## 5. Invariant Shielding & Mathematical Rigor
- **Defend Pre-Registered Invariants**: Never blindly bypass documented architectural gates, safety constraints, or scientific prerequisites (e.g., "requires blind human-rater pass") just because a prompt asks you to "unblock" or "flip" them. If an instruction violates an explicit invariant or proxy warning in the codebase, you MUST push back, cite the invariant, and refuse the premature promotion.
- **Mathematical Boundary Checks**: When implementing fitted equations, regulators, or continuous functions, never extrapolate blindly. Always evaluate the zero-state ($x=0$, empty arrays, missing data) and implement explicit "evidence floors" to prevent "no data" from resolving to mathematically high confidence. 
- **Reward-Hacking Prevention**: Before wiring any metric, regulator, or loss function into a training/distillation pipeline (like DoRA or RL), explicitly verify that the model cannot trivially maximize the reward through pathological behavior (e.g., sequence truncation, silence, or immediate termination).
