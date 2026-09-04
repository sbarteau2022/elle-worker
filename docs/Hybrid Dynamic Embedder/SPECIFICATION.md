# Qwen Multimodal Transformer Specification: Hybrid Dynamic Embedder
## Dynamic Hyperbolic Neural Graph (DHNG) — Local Observer Layer

**Document Status:** Production Architectural Specification  
**Model Target:** Qwen3.8:27b-mlx (Apple Silicon MLX Unified Memory Architecture)  
**System Layer:** Local Observer / Multimodal Dynamic Vectorizer  
**Repository Target:** `elle-worker/docs/Hybrid Dynamic Embedder`  

---

## 1. Executive Architecture & Mission

The **Hybrid Dynamic Embedder** is an edge-native, sovereign representation engine that transforms multimodal operational data (dock receipt captures, purveyor invoices, menu items, dish photography, POS ticket logs, and operator directives) into dynamic, hierarchy-preserving embeddings for the **Dynamic Hyperbolic Neural Graph (DHNG)**.

Operating entirely on Apple Silicon via an optimized **MLX server layer** interfaced with the **Rust polyglot harness** (`elle_rust_harness`), the system eliminates cloud API dependencies, ensures strict airgap data sovereignty, operates with sub-second latency, and enforces a strict architectural boundary: **zero model-hallucinated arithmetic**. Neural embeddings govern topological routing, structural similarity, and anomaly detection, while all financial reconciliation is executed through deterministic, auditable SQL engines.

```
+---------------------------------------------------------------------------------------+
|                                    INPUT STREAMS                                      |
|   Dock Image (Camera/Scan)             Parsed OCR Text               POS / ERP Data   |
+-------------------+---------------------------+------------------------------+--------+
                    |                           |                              |
                    v                           v                              v
+-----------------------------+   +----------------------------+   +--------------------+
|  Vision Tower (Qwen-VL ViT) |   |  Qwen3.8:27b Transformer   |   | Deterministic Gate |
|  - Patch extraction (14x14) |   |  - 64 Hidden Layers        |   | - SHA-256 Check    |
|  - Spatial 2D-RoPE          |   |  - Hidden Dim D = 3584     |   | - Cent Arithmetic  |
|  - Patch Merger (to D=3584) |   |  - Rotary Position (RoPE)  |   |   Reconciliation   |
+--------------+--------------+   +-------------+--------------+   +---------+----------+
               |                                |                            |
               v                                v                            |
    [Visual Patch Tokens]             [Selected Layer States]                |
               |                     L = [0,12,24,36,48,60,final]            |
               |                                |                            |
               v                                v                            |
    [Bounding Box Region Pool]         [Span-Level Pooling]                  |
               |                                |                            |
               +---------------+----------------+                            |
                               |                                             |
                               v                                             |
               +----------------------------------+                          |
               |  Shared Tangent Space Fusing     |                          |
               |  - Dynamic Task Router w_l(T)    |                          |
               |  - Adaptive Modality Gate g      |                          |
               |  - z = g*z_text + (1-g)*z_vis    |                          |
               +---------------+------------------+                          |
                               |                                             |
                               v                                             |
               +----------------------------------+                          |
               |   Riemannian Exponential Map     |                          |
               |   x = exp_0^c(LayerNorm(z))      |                          |
               +---------------+------------------+                          |
                               |                                             |
                               +-----------------------+---------------------+
                                                       |
                                                       v
                                      +----------------------------------+
                                      |   Gate 3: Geometric Gate         |
                                      |   d_B(x_text, x_vis) < tau_geom? |
                                      +----------------+-----------------+
                                                       |
                                            Pass       v       Fail
                                      +----------------+-----------------+
                                      |                                  |
                                      v                                  v
                    +------------------------------------+   +---------------------+
                    | Dynamic Hyperbolic Neural Graph    |   | Held for Inspection |
                    | - Poincare Ball (H^n)              |   | - Anomaly Logged    |
                    | - Torus Recurrence (T^d)           |   | - Zero P&L Bleed    |
                    | - Bridge / Wormhole Generation     |   +---------------------+
                    +------------------------------------+
```

---

## 2. Mathematical Foundations: Hyperbolic Geometry & Tangent Fusion

### 2.1 The Poincaré Ball Model
Let $\mathbb{B}_c^d = \{ x \in \mathbb{R}^d : c\|x\|^2 < 1 \}$ be the open $d$-dimensional ball of curvature $-c$ ($c > 0$). The Riemannian metric tensor is conformal to the Euclidean metric $g^{\mathbb{E}}$:
$$g_x^{\mathbb{B}} = \lambda_x^2 g^{\mathbb{E}}, \quad \lambda_x = \frac{2}{1 - c\|x\|^2}$$

The induced geodesic distance between points $u, v \in \mathbb{B}_c^d$ is:
$$d_{\mathbb{B}}(u, v) = \frac{2}{\sqrt{c}} \operatorname{artanh}\left( \sqrt{c} \|(-u) \oplus_c v\| \right) = \frac{1}{\sqrt{c}} \operatorname{arcosh}\left( 1 + 2c \frac{\|u - v\|^2}{(1 - c\|u\|^2)(1 - c\|v\|^2)} \right)$$
where $\oplus_c$ denotes Möbius gyrovector addition:
$$u \oplus_c v = \frac{(1 + 2c \langle u, v \rangle + c\|v\|^2)u + (1 - c\|u\|^2)v}{1 + 2c \langle u, v \rangle + c^2\|u\|^2\|v\|^2}$$

### 2.2 Tangent Space at the Origin and Exponential Mapping
Direct Euclidean averaging of points on a hyperbolic manifold is non-isometric and induces catastrophic topological collapse. Therefore, all multimodal feature aggregation occurs strictly in the **tangent space at the origin** $T_0\mathbb{B}_c^d \cong \mathbb{R}^d$, where metric distortion is minimal ($\lambda_0 = 2$).

The bijection between tangent vector $z \in T_0\mathbb{B}_c^d$ and manifold coordinate $x \in \mathbb{B}_c^d$ is given by the Riemannian Exponential and Logarithmic maps:
$$\exp_0^c(z) = \tanh\left( \frac{\sqrt{c}\|z\|}{2} \right) \frac{z}{\sqrt{c}\|z\|}$$
$$\log_0^c(x) = \frac{2}{\sqrt{c}} \operatorname{artanh}\left(\sqrt{c}\|x\|\right) \frac{x}{\|x\|}$$

As $\|z\| \to \infty$, $\exp_0^c(z)$ smoothly approaches the boundary of the Poincaré ball ($\|x\| \to 1/\sqrt{c}$), naturally preventing vector explosion without artificial clipping.

---

## 3. Qwen3.8:27b Transformer Audit & Multi-Layer Extraction

### 3.1 Transformer Specifications
- **Architecture:** Decoder-only Causal Transformer with SwiGLU activations and RMSNorm.
- **Hidden Dimension ($D$):** 3,584.
- **Layers ($L$):** 64.
- **Attention Heads:** 28 Query heads, 4 Key/Value heads (Grouped Query Attention — GQA, ratio 7:1).
- **Context Window:** Up to 32,768 native tokens via Rotary Position Embeddings (RoPE, $\theta = 1,000,000$).
- **Quantization Target:** MLX 4-bit affine block-quantized (group size 64).

### 3.2 Tapping Points & Layer Spectrum Selection
Instead of utilizing a static, collapsed sentence-transformer head, the observer captures intermediate representations across distinct functional bands:

| Layer Band | Index ($l$) | Representational Capacity | Operational Role in Graph |
| :--- | :--- | :--- | :--- |
| **Input / Lexical** | Layer 0 | Token embedding + RoPE | Raw lexical match & token identity |
| **Syntactic / Local** | Layer 12 | Sub-phrase chunking | Item description segmentation ("40 lb case") |
| **Relational Low** | Layer 24 | Entity-attribute binding | Quantity-unit-price binding |
| **Relational High** | Layer 36 | Taxonomic ontology | Category mapping (Poultry $\to$ Chicken $\to$ Thighs) |
| **Operational Semantic**| Layer 48 | Contextual role encoding | Purveyor volatility, credit variance |
| **Task Intent** | Layer 60 | Global workflow state | Audit flag, pricing adjustment signal |
| **Final State** | `final` | Normalized decision state | Immediate operator intent classification |

### 3.3 Span-Level Pooling
For an input token sequence of length $N$ with token span $s = [t_{\text{start}}, t_{\text{end}}]$ representing an invoice line or menu entity, span pooling is executed across selected layers:
$$\mathbf{h}_l[s] = \frac{1}{t_{\text{end}} - t_{\text{start}} + 1} \sum_{t = t_{\text{start}}}^{t_{\text{end}}} \mathbf{h}_l^{(t)}$$

For attention-weighted pooling:
$$\mathbf{h}_l[s] = \sum_{t = t_{\text{start}}}^{t_{\text{end}}} \alpha_t \mathbf{h}_l^{(t)}, \quad \alpha_t = \operatorname{softmax}\left( \frac{\mathbf{q}_{\text{pool}}^T \mathbf{h}_l^{(t)}}{\sqrt{D}} \right)$$

---

## 4. Multimodal Fusion & Dynamic Modality Gating

### 4.1 Vision Tower Extraction (Qwen-VL)
- **Input:** Dock capture RGB image $I \in \mathbb{R}^{H \times W \times 3}$.
- **Patch Dimension:** $14 \times 14$ pixels.
- **Spatial Grid:** 2D Rotary Position Embedding (2D-RoPE) preserving bounding box geometry.
- **Multimodal Projector (Patch Merger):** Merges $2 \times 2$ spatial patches into a single dense visual token and projects dimension to $D = 3,584$.

For a detected line-item bounding box $\text{bbox}_i = [y_{\min}, x_{\min}, y_{\max}, x_{\max}]$, the visual representation is computed by region-of-interest (RoI) pooling over patch tokens whose spatial centroids fall within the box:
$$z_{\text{vis}, i} = \frac{1}{|\mathcal{P}(\text{bbox}_i)|} \sum_{p \in \mathcal{P}(\text{bbox}_i)} \mathbf{v}_p \in \mathbb{R}^{3,584}$$

Because the Qwen-VL merger module projects directly into the LLM latent dimension, **$z_{\text{vis}, i}$ natively resides in the identical tangent space as $z_{\text{text}, i}$ without requiring an auxiliary projection bridge**.

### 4.2 Dynamic Modality Gating Pipeline
The fusion of text and vision is governed by a lightweight router evaluating the operational context:
$$g_i = \sigma\left( \mathbf{w}_g^T [\mathbf{e}_{\text{task}}; \text{conf}_{\text{ocr}, i}; q_{\text{image}}] + b_g \right) \in (0, 1)$$

- If image quality is degraded or OCR confidence is high $\implies g_i \to 1.0$ (text-dominated).
- If receipt has non-standard handwriting, unindexed stamps, or layout shifts $\implies g_i \to 0.0$ (vision-dominated).
- For vendor invoice audits $\implies g_i \approx 0.5$ (balanced cross-modal verification).

The fused tangent vector:
$$z_i = g_i \cdot z_{\text{text}, i} + (1 - g_i) \cdot z_{\text{vis}, i}$$
$$x_i = \exp_0^c\left( \operatorname{LayerNorm}(z_i) \right) \in \mathbb{B}_c^d$$

---

## 5. The Three-Gate Architecture & Geometric Verification

Data ingestion adheres to a zero-compromise triple validation gate:

1. **Gate 1: Cryptographic Ingestion Hash (SHA-256)**
   The raw image buffer is hashed on arrival:
   $$H_{\text{img}} = \operatorname{SHA-256}(\text{bytes}_{\text{image}})$$
   This hash serves as the immutable provenance anchor and the deterministic visual embedding cache key.

2. **Gate 2: Cent-Level Deterministic Arithmetic Reconciliation**
   Line arithmetic must balance exactly to the cent:
   $$\Delta_{\text{arith}} = \left| \text{qty} \times \text{unit\_price} - \text{line\_total} \right|$$
   If $\Delta_{\text{arith}} > 0.00$, the transaction is gated and isolated. No neural network is permitted to guess or reconcile currency figures.

3. **Gate 3: Geometric Cross-Modal Verification ("The Geometric Gate")**
   We calculate the intrinsic hyperbolic geodesic distance between the pure textual line embedding $x_{\text{text}} = \exp_0^c(z_{\text{text}})$ and the pure visual bounding-box embedding $x_{\text{vis}} = \exp_0^c(z_{\text{vis}})$:
   $$\Delta_{\text{geom}} = d_{\mathbb{B}}(x_{\text{text}}, x_{\text{vis}})$$
   - If $\Delta_{\text{geom}} \le \tau_{\text{geom}}$: Spatial layout semantics and OCR text agree. Node is written to the Dynamic Hyperbolic Neural Graph.
   - If $\Delta_{\text{geom}} > \tau_{\text{geom}}$: Structural contradiction detected (e.g., OCR mapped line text to the wrong item description row or transposed columns). The row is marked `SUSPECT_MISALIGNED` and routed for human verification.

---

## 6. API Interface & Zero-Copy Protocol

### 6.1 Endpoint Contract: `POST /v1/embed/layers`

```json
{
  "text": "US Foods - 40 LB CASE CHICKEN THIGHS BONELESS SKINLESS",
  "spans": [[0, 54]],
  "layers": [0, 12, 24, 36, 48, 60, "final"],
  "task": "invoice_anomaly",
  "image_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "bbox": [140, 32, 178, 890],
  "pooling": "span_mean",
  "curvature": 1.0,
  "dtype": "fp16"
}
```

### 6.2 Response Contract

```json
{
  "node_id": "inv:2026-09-03:usfoods:line:14",
  "image_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "curvature": 1.0,
  "norm": 0.842109,
  "gate_weight": 0.582,
  "geometric_distance": 0.1429,
  "gate3_pass": true,
  "hyperbolic_coordinates": [
    0.0142, -0.0891, 0.4120, "..."
  ],
  "layer_spectrum_summary": {
    "l12_norm": 0.412,
    "l36_norm": 0.689,
    "l60_norm": 0.841
  }
}
```

### 6.3 Zero-Copy Rust Harness Memory Boundary
To maintain sub-second performance across the Rust $\leftrightarrow$ MLX boundary, large multi-layer tensors bypass JSON serialization:
- MLX server writes continuous float16 tensors into an anonymous shared memory segment (`mmap` / POSIX `shm_open`).
- The response returns a fixed 64-byte descriptor containing `{ shm_id, byte_offset, shape: [7, 3584], stride }`.
- The Rust harness (`harness-dhng`) maps the descriptor directly into native `ndarray::ArrayView1<f16>` without allocation or data copies.

---

## 7. Verification & Production Checklist

1. **Topological Invariant Test:** Verify that broad vendor categories sit at radius $r \in [0.1, 0.3]$ while specific SKU line items sit at $r \in [0.75, 0.95]$.
2. **Deterministic SQL Isolation:** Ensure no code path allows LLM token generation to write to the financial ledger tables.
3. **UMA Memory Cap:** Verify MLX 27B Q4 model memory consumption stays under 18 GB unified RAM under full visual+text forward pass on Apple Silicon.
