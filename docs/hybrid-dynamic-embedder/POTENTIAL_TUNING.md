# Potential Tuning & Transformer Manipulation on MLX Q4
## Optimization Strategy for Qwen3.8:27b-mlx & Hybrid Dynamic Embedder

**Document Status:** Production Optimization Strategy  
**Target Architecture:** Qwen3.8:27b MLX 4-Bit Affine Quantization (Apple Silicon UMA)  
**System Module:** Hybrid Dynamic Embedder / DHNG Local Observer  
**Repository Target:** `elle-worker/docs/Hybrid Dynamic Embedder/POTENTIAL_TUNING.md`  

---

## 1. Grounding: Transformer Manipulation on MLX Q4

Operating a 27-billion-parameter multimodal transformer locally on Apple Silicon under sub-second latency constraints requires rigorous parameter-efficient manipulation. We cannot dequantize the full 27B model into FP16/FP32 for training; doing so would require over 54 GB of VRAM solely for weights, exceeding device memory limits and destroying memory bandwidth.

Instead, our strategy is **grounded in 4-bit affine block-quantized transformer surgery (MLX Q4)**:
1. **Frozen 4-Bit Quantized Backbone:** The 64 transformer layers of Qwen3.8:27b remain permanently frozen in 4-bit representation (group size 64).
2. **Tangent-Space & Manifold-Aware Adapters:** Only lightweight, strategically placed parameters (adapters, projection heads, and routing matrices) are kept in full precision (FP16/BF16) and updated.
3. **Unified Memory Architecture (UMA) Exploitation:** Compute gradients directly in unified memory where the Metal GPU and CPU share address space, eliminating PCIe bus transfer overhead.

---

## 2. What We Want to Target (Target Layers & Modules)

We isolate four high-leverage intervention points within the model graph:

```
[ Input Tokens / Pixels ]
           |
           v
+-------------------------------------------------------------------------+
| TARGET 1: Vision Patch Merger (MLX Layer)                               |
| - Projector W_merger: R^{D_vit} -> R^{3584}                             |
| - 2D-RoPE spatial coordinate adjustment                                 |
+-------------------------------------------------------------------------+
           |
           v
+-------------------------------------------------------------------------+
| FROZEN BACKBONE: 64 Transformer Blocks (MLX Q4)                         |
|                                                                         |
|  Block 24 to 60:                                                        |
|  +-------------------------------------------------------------------+  |
|  | TARGET 2: Low-Rank Residual Adapters (LoRA / DoRA)                |  |
|  | - Inserted into q_proj and v_proj                                 |  |
|  | - Rank r = 16, Alpha = 32                                         |  |
|  | - Base Q4 weights remain completely untouched                     |  |
|  +-------------------------------------------------------------------+  |
+-------------------------------------------------------------------------+
           |
           v  (Intermediate hidden states L = [0, 12, 24, 36, 48, 60, final])
+-------------------------------------------------------------------------+
| TARGET 3: Dynamic Tangent Space Fusion & Task Router                    |
| - Layer weighting vector w_l(T) = softmax(W_task * e_T)                 |
| - Adaptive modality gate g = sigmoid(w_g^T [e_task; conf_ocr; q_img])   |
+-------------------------------------------------------------------------+
           |
           v  (Fused tangent vector z in T_0 B)
+-------------------------------------------------------------------------+
| TARGET 4: Hyperbolic Projection Head (Riemannian Adapter)               |
| - Tangent LayerNorm + Linear transformation W_proj                      |
| - Curvature parameter c (learnable or calibrated)                       |
| - Exponential map exp_0^c(z) -> Poincare Ball                           |
+-------------------------------------------------------------------------+
           |
           v
[ Dynamic Hyperbolic Neural Graph Coordinates ]
```

### Module Breakdown:
1. **Target 1: Vision Patch Merger (VLM Projector):**
   - The linear projection and convolution weights that compress and align raw ViT patch tokens into the 3,584-dimensional LLM space.
2. **Target 2: Selective Attention Projection Adapters (Layers 24–60):**
   - Insert low-rank adapters (rank r = 16) exclusively on Query (`q_proj`) and Value (`v_proj`) matrices in the upper-half semantic layers (layers 24 through 60). Early layers (0–23) remain 100% frozen to preserve foundational syntax and language modeling tokens.
3. **Target 3: Dynamic Gating & Task Routing Network:**
   - A tiny feed-forward network (~65K parameters) that dynamically assigns task-specific weights across the layer spectrum and gates text vs. visual modality based on input signal quality.
4. **Target 4: Hyperbolic Projection & Curvature Adapter:**
   - A linear tangent transform W_proj in R^{3584 x d} followed by a learnable Riemannian manifold scaling parameter c mapping Euclidean vectors into the Poincare ball.

---

## 3. Why We Want to Target These (Rationale & System Fit)

| Target | Rationale | System Consequence |
| :--- | :--- | :--- |
| **Vision Patch Merger** | Pre-trained VLMs align images with natural language captions, not with tabular invoices or receipt bounding boxes. | Adapting the merger aligns invoice crops directly with structured ledger schema without retraining the ViT. |
| **Mid/Late Layer Adapters (24–60)** | Early layers encode grammar and word forms; late layers encode task semantics and relational depth. | Modifying only layers 24–60 preserves foundational linguistic capabilities while tuning relational extraction for kitchen economics. |
| **Dynamic Gating Head** | Environmental conditions at the dock vary wildly (dim lighting, grease, wrinkled thermal paper, skewed camera angles). | Prevents catastrophic OCR failures by shifting embedding weight to visual features when OCR is low-confidence. |
| **Hyperbolic Projection Head** | Standard transformers output representations optimized for Euclidean cosine similarity, not hyperbolic geodesics. | Enforces negative-curvature metric structure directly, ensuring parent categories cluster radially near the origin and specific line items expand near the boundary. |

---

## 4. What We Expect to Gain (Concrete Performance & Economic Metrics)

### 4.1 Memory & Silicon Footprint (Apple Silicon UMA)
- **Base Model (Qwen3.8:27b Q4):** ~14.8 GB.
- **Adapter & Head Parameters (FP16):** ~180 MB.
- **Peak Unified RAM Usage:** <= 16.2 GB during active inference.
- **Operational Payoff:** Runs concurrently on standard 32GB/36GB/64GB M-series Apple Silicon machines alongside the Rust polyglot harness, the local SQLite/DuckDB ledger, and the 3D viewer without memory swapping.

### 4.2 Latency & Energy (Token / Joule Reduction)
- **Forward Pass Latency:** <= 220 ms for combined multimodal line extraction.
- **Cache Hit Latency:** <= 0.8 ms (via SHA-256 image gate-one cache).
- **Thermal & Energy Efficiency:** Minimizes sustained GPU core saturation, preventing thermal throttling on fanless or quiet edge hardware stationed at restaurant docks.

### 4.3 Representation Fidelity & Graph Dynamics
- **Topological Distortion (Stress):** sigma <= 0.04 on supply chain tree hierarchies (versus sigma >= 0.38 in Euclidean space of equivalent dimension).
- **Zero-Friction Lineage Matching:** Automatically clusters items by purveyor code and menu item ancestry with >99.2% retrieval precision on the Poincare manifold.
- **Audit Gatekeeper Precision:** Gate 3 detects row-misaligned OCR items with zero false positives on verified invoices.

---

## 5. How We Expect to Do It (Implementation Strategy & Execution Recipes)

### 5.1 Weight-Decomposed Low-Rank Adaptation (DoRA) on MLX
To avoid degradation in directional stability when projecting into non-Euclidean spaces, we utilize DoRA rather than standard LoRA for our attention adapters.

For a pre-trained frozen quantized weight W_0, DoRA decomposes the weight into its magnitude and directional component:
W = m * (W_0 + (alpha / r) * B * A) / ||W_0 + (alpha / r) * B * A||_c

In MLX Python:
```python
import mlx.core as mx
import mlx.nn as nn

class DoRALinear(nn.Module):
    def __init__(self, base_linear: nn.Linear, r: int = 16, alpha: float = 32.0):
        super().__init__()
        self.base_linear = base_linear
        self.base_linear.freeze() # Freeze base Q4 weights
        
        in_features = base_linear.weight.shape[1]
        out_features = base_linear.weight.shape[0]
        self.scale = alpha / r
        
        # Trainable low-rank matrices
        self.lora_a = mx.random.normal((r, in_features)) * 0.02
        self.lora_b = mx.zeros((out_features, r))
        
        # Trainable magnitude vector
        base_weight = base_linear.weight
        self.m = mx.linalg.norm(base_weight, axis=1)

    def __call__(self, x: mx.array) -> mx.array:
        base_out = self.base_linear(x)
        lora_out = (x @ self.lora_a.T) @ self.lora_b.T
        adapted = base_out + self.scale * lora_out
        
        norm_adapted = adapted / (mx.linalg.norm(adapted, axis=-1, keepdims=True) + 1e-6)
        return self.m * norm_adapted
```

### 5.2 Manifold Loss Formulation
Training is guided by a compound objective enforcing metric fidelity and hierarchical structure:
L = L_hyperbolic_contrastive + lambda_hier * L_hierarchy + lambda_cross * L_cross_modal

1. **Hyperbolic Contrastive Loss:**
   L_HC(u, v+) = - log( exp(-d_B(u, v+) / tau) / (exp(-d_B(u, v+) / tau) + sum_k exp(-d_B(u, v-_k) / tau)) )
   Encourages semantically related items (same ingredient, same purveyor catalog branch) to have minimal geodesic distance on B_c^d.

2. **Hierarchical Entailment / Radial Penalty:**
   In the Poincare ball, norm ||x|| reflects specificity. Category nodes must lie closer to the origin than leaf line items:
   L_hierarchy(u_parent, v_child) = max(0, ||u_parent|| - ||v_child|| + epsilon)

3. **Cross-Modal Consistency Loss:**
   Penalizes divergence between the visual bounding box embedding x_vis and the parsed text embedding x_text for the same verified receipt line:
   L_cross(x_text, x_vis) = d_B(x_text, x_vis)^2

### 5.3 Riemannian Optimization on Apple Silicon
Gradients with respect to Poincare coordinates are mapped using the inverse conformal factor:
grad_B f(x) = ((1 - c * ||x||^2)^2 / 4) * grad_Euclidean f(x)

Parameter updates are executed via Riemannian exponential retraction:
x_{t+1} = exp_{x_t}^c(-eta * grad_B f(x_t))

### 5.4 Custom Metal Kernel Optimization (MSL)
For sub-millisecond execution of hyperbolic distances during graph traversal and batch alignment, we deploy a hand-tuned Metal compute kernel executing in Apple Silicon unified memory:

```metal
#include <metal_stdlib>
using namespace metal;

kernel void poincare_distance_batch(
    device const float* u_vecs        [[buffer(0)]],
    device const float* v_vecs        [[buffer(1)]],
    device float*       distances     [[buffer(2)]],
    constant uint&      dim           [[buffer(3)]],
    constant float&     c             [[buffer(4)]],
    uint                idx           [[thread_position_in_grid]])
{
    uint offset = idx * dim;
    float u_sq = 0.0f;
    float v_sq = 0.0f;
    float diff_sq = 0.0f;

    for (uint i = 0; i < dim; i++) {
        float ui = u_vecs[offset + i];
        float vi = v_vecs[offset + i];
        u_sq += ui * ui;
        v_sq += vi * vi;
        float d = ui - vi;
        diff_sq += d * d;
    }

    float alpha = 1.0f - c * u_sq;
    float beta  = 1.0f - c * v_sq;
    float arg   = 1.0f + 2.0f * c * diff_sq / (alpha * beta + 1e-7f);
    
    // acosh(x) = log(x + sqrt(x*x - 1))
    distances[idx] = (1.0f / sqrt(c)) * log(arg + sqrt(arg * arg - 1.0f));
}
```

---

## 6. Systematic Workflow & Replication Strategy (`/learn`)

This pattern represents our standard operating protocol for embedding deep models into sovereign edge architectures. The strategy executes in four repeatable phases:

1. **Phase 1: Rigorous Literature Curation** — Download peer-reviewed PDFs to a dedicated research directory, index formal math, and establish geometric invariants.
2. **Phase 2: Architectural Audit & Tapping Specification** — Map model layer topologies, identify zero-bridge latent spaces (e.g., VLM patch mergers), and establish zero-copy IPC protocols.
3. **Phase 3: Parameter-Efficient Quantized Manipulation** — Freeze 4-bit base model weights, attach DoRA/LoRA adapters to high-abstraction attention blocks, and formulate compound manifold loss.
4. **Phase 4: Hardware-Conscious Acceleration & Isolation** — Deploy custom Metal compute shaders on Apple Silicon UMA and enforce strict isolation between neural topological representations and deterministic arithmetic execution.
