# Cognitive Mapping Protocol & Literature Synthesis: End-to-End Implementation Plan for Geometric Deep Learning, Mixed-Curvature Product Manifolds, and Active Inference

**Document Identifier:** `DOC-COGMAP-2026-M6`  
**Author:** Worker M6 (Cognitive Mapping Protocol & Literature Synthesis Author)  
**Target System:** `elle-worker` (Cloudflare Workers, D1, Vectorize, KV, R2, Queues, `workerd` V8 Isolate, Rust/WASM Core)  
**Publication Status:** Live Architecture Specification & Engineering Roadmap  
**Date:** 2026-08-29  
**Mathematical Grounding:** Riemannian Hyperbolic Geometry, Toroidal Homology, Geometric Deep Learning, Active Inference & Variational Free Energy Minimization  

---

## Table of Contents
1. [Executive Summary & Foundational Theoretical Framework](#1-executive-summary--foundational-theoretical-framework)
   - [1.1 Paradigm & Architectural Mission](#11-paradigm--architectural-mission)
   - [1.2 The Geometric Distortion Problem & Curvature Taxonomy](#12-the-geometric-distortion-problem--curvature-taxonomy)
   - [1.3 Tripartite Manifold Paradigm: $\mathbb{H}^n \times \mathbb{T}^8 \times \mathcal{G}$](#13-tripartite-manifold-paradigm-mathbbhn-times-mathbft8-times-mathcalg)
   - [1.4 Formal Axiomatic System & Cognitive Invariants](#14-formal-axiomatic-system--cognitive-invariants)
2. [End-to-End Cognitive Mapping Architecture](#2-end-to-end-cognitive-mapping-architecture)
   - [2.1 Multimodal Sensory Ripper Subsystem](#21-multimodal-sensory-ripper-subsystem)
   - [2.2 Leaf Encoder $\psi$: Multimodal Tokenization to Tangent Space](#22-leaf-encoder-psi-multimodal-tokenization-to-tangent-space)
   - [2.3 Poincaré Ball Hyperbolic Manifold $\mathbb{B}^n$](#23-poincaré-ball-hyperbolic-manifold-mathbbbn)
   - [2.4 Product Manifold Geometry ($\mathbb{H}^n \times \mathbb{T}^8$)](#24-product-manifold-geometry-mathbbhn-times-mathbft8)
   - [2.5 Topological Memory Graph & Persistent Homology](#25-topological-memory-graph--persistent-homology)
3. [Preprint Literature Synthesis & Formal Grounding](#3-preprint-literature-synthesis--formal-grounding)
   - [3.1 Hyperbolic Graph Neural Networks (HGNNs & HGCNs)](#31-hyperbolic-graph-neural-networks-hgnns--hgcns)
   - [3.2 Active Inference & The Free Energy Principle](#32-active-inference--the-free-energy-principle)
   - [3.3 Geometric Deep Learning & Mixed-Curvature Product Spaces](#33-geometric-deep-learning--mixed-curvature-product-spaces)
   - [3.4 Topological Deep Learning & Persistent Memory Networks](#34-topological-deep-learning--persistent-memory-networks)
4. [Step-by-Step 4-Phase Implementation Roadmap](#4-step-by-step-4-phase-implementation-roadmap)
   - [4.1 Phase 1: Hyperbolic Geometric Foundation & WASM CORDIC Acceleration](#41-phase-1-hyperbolic-geometric-foundation--wasm-cordic-acceleration)
   - [4.2 Phase 2: Multimodal Sensory Intake & Leaf Encoder $\psi$ Pipeline](#42-phase-2-multimodal-sensory-intake--leaf-encoder-psi-pipeline)
   - [4.3 Phase 3: Topological Memory Graph & HGNN Associative Recall](#43-phase-3-topological-memory-graph--hgnn-associative-recall)
   - [4.4 Phase 4: Active Inference Action-Perception Loop & Free Energy Regulator](#44-phase-4-active-inference-action-perception-loop--free-energy-regulator)
5. [Precise Data Interfaces, TypeScript/Rust Type Signatures & Acceptance Criteria](#5-precise-data-interfaces-typescriptrust-type-signatures--acceptance-criteria)
   - [5.1 TypeScript Core Interfaces](#51-typescript-core-interfaces)
   - [5.2 Rust Crate FFI ABI & Linear Memory Layout](#52-rust-crate-ffi-abi--linear-memory-layout)
   - [5.3 Database & Vector Storage Schemas](#53-database--vector-storage-schemas)
   - [5.4 Quantitative Acceptance Test Criteria & Validation Fixtures](#54-quantitative-acceptance-test-criteria--validation-fixtures)

---

## 1. Executive Summary & Foundational Theoretical Framework

### 1.1 Paradigm & Architectural Mission

`elle-worker` operates as an edge-native, sovereign cognitive agent and multi-step reasoning substrate deployed on Cloudflare Workers (`workerd`). As the complexity of autonomous workflows, multi-modal signal streams, and associative memories expands, standard Euclidean vector databases (e.g., flat $\mathbb{R}^d$ cosine similarity spaces) suffer catastrophic metric distortion when modeling hierarchical provenance, cyclical phase recurrence, and topological invariants.

This deliverable establishes the **Cognitive Mapping Protocol**—an end-to-end mathematical and engineering architecture that unifies:
1. **Sensory Rippers:** Acoustic prosody extraction (PFAR), visual field tensor analysis (vFAR), and continuous wavelet phase tracking (PAMI).
2. **The Leaf Encoder $\psi$:** Deterministic mapping of heterogeneous multimodal observation tokens into tangent spaces and conformal manifold coordinates.
3. **Mixed-Curvature Product Manifolds ($\mathbb{H}^n \times \mathbb{T}^8$):** A coupled geometric framework combining negative-curvature hyperbolic space $\mathbb{H}^n$ (capturing tree-like derivation depth and semantic hierarchy) and flat toroidal space $\mathbb{T}^8$ (capturing periodic phase recurrence, rhythm kinship, and topological winding).
4. **Topological Memory Graphs:** Simplicial complex modeling over Cloudflare D1 and Vectorize, leveraging persistent homology ($\beta_0, \beta_1$) and $1.3\times$ non-bridge cycle boost for associative recall.
5. **Active Inference & Variational Free Energy Minimization:** A closed-loop cognitive regulator governing tool selection, policy execution ($G(\pi)$), and internal state stability ($F = U - T \cdot S$).

```
                      ┌────────────────────────────────────────┐
                      │    Multimodal Sensory Input Streams    │
                      │  (Audio PCM, Visual Luma, Text Corpus) │
                      └───────────────────┬────────────────────┘
                                          │
                                          ▼
                      ┌────────────────────────────────────────┐
                      │ 1. Sensory Ripper Subsystem            │
                      │  • PFAR (eGeMAPS acoustic prosody, F0) │
                      │  • vFAR (Sobel, Gabor, GLCM tensors)   │
                      │  • PAMI (8 phi-spaced wavelet phases)  │
                      └───────────────────┬────────────────────┘
                                          │ Raw Feature Leaves {(p_i, v_i)}
                                          ▼
                      ┌────────────────────────────────────────┐
                      │ 2. Leaf Encoder psi: R^1024 -> B^n     │
                      │  • Deterministic Tangent Projection    │
                      │  • Exponential Map at Origin exp_0(W x)│
                      │  • Boundary Clamping (norm < 1 - eps)  │
                      └───────────────────┬────────────────────┘
                                          │ Conformal Hyperbolic Embeddings
                                          ▼
                      ┌────────────────────────────────────────┐
                      │ 3. Mixed-Curvature Manifold H^n x T^8  │
                      │  • Hyperbolic Tree Depth: rho = d(0,x) │
                      │  • Toroidal Phase Coordinates: theta   │
                      │  • Disagreement / Resonance Detection  │
                      └───────────────────┬────────────────────┘
                                          │ Dual-Chart Geodesics & Topology
                                          ▼
                      ┌────────────────────────────────────────┐
                      │ 4. Topological Memory Graph & HGNN     │
                      │  • Spreading Activation (1.3x boost)   │
                      │  • Persistent Homology (beta_0, beta_1)│
                      │  • Hyperbolic Graph Convolutional Net  │
                      └───────────────────┬────────────────────┘
                                          │ Structural Context & State Priors
                                          ▼
                      ┌────────────────────────────────────────┐
                      │ 5. Active Inference Coherence Loop     │
                      │  • Variational Free Energy: F = U - TS │
                      │  • Expected Free Energy: G(pi) Policy  │
                      │  • Lyapunov Regulator & Swarm Actions  │
                      └────────────────────────────────────────┘
```

---

### 1.2 The Geometric Distortion Problem & Curvature Taxonomy

In standard deep learning architectures, representations are forced into Euclidean vector spaces $\mathbb{R}^d$ equipped with the standard inner product $\langle u, v \rangle = \sum u_i v_i$. However, geometric analysis demonstrates that Euclidean spaces cannot embed complex graph topologies without severe metric distortion:

#### The Hierarchical Volume Mismatch:
In Euclidean space $\mathbb{R}^d$, the volume of a ball of radius $r$ grows polynomially:
$$\text{Vol}_{\mathbb{R}^d}(r) = \frac{\pi^{d/2}}{\Gamma(d/2 + 1)} r^d = O(r^d)$$
Conversely, in a tree structure with branching factor $b > 1$, the number of nodes at depth $k$ grows exponentially:
$$N(k) = b^k = O(e^{k \ln b})$$
Embedding a tree into $\mathbb{R}^d$ requires expanding dimensions to infinity or accepting catastrophic distortion where leaf nodes are crammed together near the boundary.

#### Hyperbolic Space Resolution:
In hyperbolic space $\mathbb{H}^n$ of constant negative sectional curvature $K = -c < 0$ ($c > 0$), the volume of a ball of radius $r$ grows exponentially:
$$\text{Vol}_{\mathbb{H}^n}(r) = \frac{2 \pi^{n/2}}{\Gamma(n/2)} \int_0^r \left(\frac{\sinh(\sqrt{c} t)}{\sqrt{c}}\right)^{n-1} dt = O\left(e^{(n-1)\sqrt{c} r}\right)$$
This exponential expansion matches tree growth exactly. Consequently, hierarchical taxonomies, causal derivations, and epistemic trees embed into low-dimensional hyperbolic manifolds with near-zero metric distortion (Nickel & Kiela, 2017; Sarkar, 2011).

#### The Cyclical Recurrence Problem:
Hyperbolic space $\mathbb{H}^n$ and Euclidean space $\mathbb{R}^n$ are simply connected ($\pi_1(\mathbb{H}^n) = 0$, $\pi_1(\mathbb{R}^n) = 0$). Any cyclic trajectory embedded into $\mathbb{H}^n$ must be cut open along a seam, causing points with angular difference $\epsilon \approx 0$ (e.g., $1^\circ$ and $359^\circ$) to appear maximally distant ($d \approx 2\pi$).

#### Toroidal Space Resolution:
The flat torus $\mathbb{T}^d = \mathbb{R}^d / (2\pi \mathbb{Z}^d)$ possesses non-trivial fundamental group $\pi_1(\mathbb{T}^d) = \mathbb{Z}^d$. Cyclic trajectories wrap naturally without boundary seams, and trajectories carry integer **winding numbers** $W \in \mathbb{Z}^d$ serving as exact, discrete topological invariants.

| Manifold Space | Sectional Curvature $K$ | Metric Tensor $g$ | Volume Growth $\text{Vol}(r)$ | Fundamental Group $\pi_1$ | Optimal Structural Representation |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Euclidean $\mathbb{R}^d$** | $K = 0$ | $I_d$ | Polynomial $O(r^d)$ | $\{0\}$ | Flat grids, linear independent features |
| **Poincaré Ball $\mathbb{B}^n$** | $K = -1$ | $\left(\frac{2}{1-\|x\|^2}\right)^2 I_n$ | Exponential $O(e^{(n-1)r})$ | $\{0\}$ | Hierarchies, DAGs, causal lineage, derivation depth |
| **Flat Torus $\mathbb{T}^d$** | $K = 0$ (compact) | $I_d$ (modulo $2\pi\mathbb{Z}^d$) | Compact / Bounded | $\mathbb{Z}^d$ | Periodic signals, phase kinship, recurrence invariants |
| **Product $\mathbb{H}^n \times \mathbb{T}^d$** | Mixed ($\le 0$) | $g_{\mathbb{H}} \oplus g_{\mathbb{T}}$ | Hybrid Exponential | $\mathbb{Z}^d$ | Unified cognitive state (Lineage $\times$ Recurrence) |

---

### 1.3 Tripartite Manifold Paradigm: $\mathbb{H}^n \times \mathbb{T}^8 \times \mathcal{G}$

The `elle-worker` cognitive mapping engine decomposes each internal state representation into three mutually grounding components:

$$\mathcal{M}_{\text{cognitive}} = \underbrace{\mathbb{B}^{128}}_{\text{Hyperbolic Tree Depth}} \times \underbrace{\mathbb{T}^8}_{\text{Toroidal Phase Recurrence}} \times \underbrace{\mathcal{G}(V, E, W)}_{\text{Topological Memory Graph}}$$

1. **Hyperbolic Component ($\mathbb{B}^{128}$):** Points sit within the open unit ball $\{x \in \mathbb{R}^{128} : \|x\| < 1\}$. Radial distance $\rho(x) = d_{\mathbb{B}}(0, x) = 2 \text{atanh}(\|x\|)$ quantifies derivation depth. High-level abstractions sit near the origin ($\|x\| \to 0$), while highly specialized, leaf-level episodic observations sit near the conformal boundary ($\|x\| \to 1$).
2. **Toroidal Component ($\mathbb{T}^8$):** Points represent 8 continuous wavelet phase angles $\theta = (\theta_0, \dots, \theta_7) \in [0, 2\pi)^8$ computed at golden-ratio ($\phi = \frac{1+\sqrt{5}}{2} \approx 1.6180339$) frequency partitions. Provides an exact integer winding invariant $W \in \mathbb{Z}^8$ across multi-turn trajectories.
3. **Graph Topology Component ($\mathcal{G}$):** Memory nodes form an associative 1-complex with Betti number $\beta_1 = E - V + C$ (independent cycle rank). Non-bridge cycle edges receive a $1.3\times$ conductance multiplier, boosting multi-hop associative recall.

---

### 1.4 Formal Axiomatic System & Cognitive Invariants

The cognitive mapping substrate adheres to four formal mathematical axioms:

#### Axiom 1: Radial Derivation Monotonicity
For any directed causal or generative memory edge $(u \to v) \in E_{\text{causal}}$, the radial distance of the consequent $v$ in the Poincaré ball must exceed or equal that of the antecedent $u$, up to regularized geodesic slack:
$$\rho(v) \ge \rho(u) - \epsilon_{\text{slack}}, \quad \text{where } \rho(x) = 2 \operatorname{artanh}(\|x\|)$$

#### Axiom 2: Topological Identity Continuity (Winding Invariance)
Recognition of a recurring cognitive pattern across an extended dialogue or reasoning trajectory is certified by the homology class of the trajectory on the flat torus $\mathbb{T}^8$. For any closed trajectory loop $\gamma: S^1 \to \mathbb{T}^8$, the winding number vector:
$$W(\gamma) = \frac{1}{2\pi} \oint_\gamma d\theta \in \mathbb{Z}^8$$
is an exact topological invariant that is invariant under smooth metric deformations of the cognitive trajectory.

#### Axiom 3: Variational Free Energy Minimization (Lyapunov Stability)
The internal cognitive state $c = (c_{\text{struct}}, c_{\text{rel}}, c_{\text{harm}}) \in [0, 1]^3$ descends a convex free energy functional:
$$F(c) = U(c) - T \cdot S(c) = \sum_{k=1}^3 a_k (1 - c_k)^2 + T \sum_{k=1}^3 (c_k - \bar{c})^2$$
where weights $a = (a_1, a_2, a_3) \propto (1, \phi^{-1}, \phi^{-2})$ are golden-partitioned. The system possesses a global asymptotic fixed point $c^* = (1, 1, 1)$, with guaranteed negative semi-definite Lyapunov derivative:
$$\dot{V}(c) = \langle \nabla F(c), \dot{c} \rangle = -\sum_{k=1}^3 \eta_k \left(\frac{\partial F}{\partial c_k}\right)^2 \le 0$$

#### Axiom 4: Markov Blanket Boundary Separation
The cognitive agent interacts with external environments strictly through its Markov blanket $\mathcal{B} = (\mu_s, \mu_a)$, where sensory states $\mu_s$ condition internal state updates $\mu$ without direct external feedthrough, and active states $\mu_a$ govern external tool dispatch without direct internal exposure.

---

## 2. End-to-End Cognitive Mapping Architecture

```
                                  SENSORY RIPPERS
                 ┌───────────────────────┬───────────────────────┐
                 │                       │                       │
          [ Audio PCM ]            [ Visual Luma ]         [ Signal/Text ]
                 │                       │                       │
                 ▼                       ▼                       ▼
          ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
          │ PFAR Ripper │         │ vFAR Ripper │         │ PAMI Ripper │
          │ • F0 Pitch  │         │ • Gabor 8-O │         │ • 8-phi CWT │
          │ • Flux/RMS  │         │ • GLCM Text │         │ • Phase Ang │
          │ • eGeMAPS   │         │ • Sobel Eng │         │ • Multifrac │
          └──────┬──────┘         └──────┬──────┘         └──────┬──────┘
                 │                       │                       │
                 └───────────────────────┼───────────────────────┘
                                         ▼
                     ┌───────────────────────────────────────┐
                     │   Leaf Encoder psi (1024-dim Dense)   │
                     │    f = sum_i s(v_i) e(p_i) in R^1024  │
                     │    psi(f) = exp_0(0.9 * f / ||f||)    │
                     └───────────────────┬───────────────────┘
                                         ▼
                     ┌───────────────────────────────────────┐
                     │ Poincaré Ball Manifold B^128 (c = -1) │
                     │  • Geodesic: d(u,v) = arcosh(...)     │
                     │  • Depth: rho(x) = 2 atanh(||x||)     │
                     │  • Möbius: u (+) v                    │
                     └───────────────────┬───────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
┌─────────────────────────────────┐             ┌─────────────────────────────────┐
│ Toroidal Manifold T^8 (F6)      │             │ Topological Memory Graph G      │
│ • Wrapped Metric d_T(theta1, th2│             │ • Persistent Homology beta_0, b1│
│ • Winding Number W in Z^8       │             │ • 1.3x Recurrent Cycle Boost    │
│ • Low-Discrepancy Roberts R_8   │             │ • HGCN Riemannian Conv Layers   │
└────────────────┬────────────────┘             └────────────────┬────────────────┘
                 │                                               │
                 └───────────────────────┬───────────────────────┘
                                         ▼
                     ┌───────────────────────────────────────┐
                     │ Active Inference Coherence Regulator  │
                     │  • Expected Free Energy G(pi) Policy  │
                     │  • Dual-Router Task Allocation        │
                     │  • Lyapunov Descent to c* = (1,1,1)   │
                     └───────────────────────────────────────┘
```

---

### 2.1 Multimodal Sensory Ripper Subsystem

The sensory intake layer transforms unconditioned high-bandwidth continuous signals into structured mathematical feature trees without intermediate lossy LLM summarization.

#### 2.1.1 PFAR: Acoustic Prosody & Spectral Dynamics (`src/pfar.ts`)
The PFAR ripper extracts the standardized Geneva Minimalistic Acoustic Parameter Set (eGeMAPS) across three primary dimensions:
1. **Fundamental Frequency ($F_0$) Tracking:**
   - Evaluates short-time normalized autocorrelation $R_x(\tau)$ and parabolic peak interpolation over $20\,\text{ms}$ Hamming-windowed frames:
     $$R_x(\tau) = \frac{\sum_{t=0}^{N-\tau-1} x(t) x(t+\tau)}{\sqrt{\sum_{t=0}^{N-\tau-1} x^2(t) \sum_{t=0}^{N-\tau-1} x^2(t+\tau)}}$$
   - Extracts pitch contour, mean $F_0$, pitch variance $\sigma_{F_0}^2$, and jitter (cycle-to-cycle pitch perturbation).
2. **Energy & Intensity Dynamics:**
   - Frame-wise Root Mean Square (RMS) energy:
     $$\text{RMS}_t = \sqrt{\frac{1}{N} \sum_{n=0}^{N-1} x^2[n] \cdot w[n]}$$
   - Energy velocity $\Delta \text{RMS}$ and Shimmer (cycle-to-cycle amplitude perturbation).
3. **Spectral Flux & Formant Distributions:**
   - Real-to-Complex FFT computes magnitude spectrogram $|X(k, t)|$. Spectral flux measures the Euclidean distance between consecutive normalized spectra:
     $$\text{Flux}(t) = \sum_{k=1}^{K} \left( |X(k, t)|_{\text{norm}} - |X(k, t-1)|_{\text{norm}} \right)^2$$
   - Harmonic-to-Noise Ratio (HNR):
     $$\text{HNR} = 10 \log_{10} \left( \frac{\mathcal{E}_{\text{harmonic}}}{\mathcal{E}_{\text{noise}}} \right) \text{ dB}$$

#### 2.1.2 vFAR: Visual Field Tensors & Spatial Rhythms (`src/vfar.ts`)
The vFAR engine rips luminance grids and spatial attention tensors:
1. **Spatial Gradient Energy:**
   - 2D Sobel convolutions calculate spatial intensity gradients:
     $$G_x = \begin{bmatrix} -1 & 0 & +1 \\ -2 & 0 & +2 \\ -1 & 0 & +1 \end{bmatrix} * I, \quad G_y = \begin{bmatrix} +1 & +2 & +1 \\ 0 & 0 & 0 \\ -1 & -2 & -1 \end{bmatrix} * I$$
     $$\|\nabla I(x, y)\| = \sqrt{G_x(x, y)^2 + G_y(x, y)^2}, \quad \theta(x, y) = \operatorname{atan2}(G_y, G_x)$$
2. **Gabor Multiscale Texture Bank:**
   - Convolves luminance with an 8-orientation, 4-scale 2D Gabor filter bank:
     $$g(x, y; \lambda, \theta, \psi, \sigma, \gamma) = \exp\left(-\frac{x'^2 + \gamma^2 y'^2}{2\sigma^2}\right) \cos\left(2\pi \frac{x'}{\lambda} + \psi\right)$$
     where $x' = x\cos\theta + y\sin\theta$ and $y' = -x\sin\theta + y\cos\theta$.
3. **Gray-Level Co-occurrence Matrix (GLCM) Features:**
   - Evaluates contrast, dissimilarity, homogeneity, energy, and entropy over displacement vector $d = (dx, dy)$:
     $$\text{Contrast} = \sum_{i,j} |i - j|^2 P(i, j), \quad \text{Energy} = \sum_{i,j} P(i, j)^2, \quad \text{Homogeneity} = \sum_{i,j} \frac{P(i, j)}{1 + |i - j|}$$

#### 2.1.3 PAMI: Continuous Wavelet Phase Decomposition (`src/pami.ts`)
The PAMI ripper samples temporal dynamics across 8 dyadic scales partitioned by the golden ratio $\phi$:
$$s_k = s_0 \cdot \phi^k, \quad k \in \{0, 1, \dots, 7\}$$
Continuous Morlet Wavelet Transform:
$$W(s_k, t) = \frac{1}{\sqrt{s_k}} \int_{-\infty}^{\infty} x(\tau) \psi^*\left(\frac{\tau - t}{s_k}\right) d\tau, \quad \psi(t) = \pi^{-1/4} e^{i \omega_0 t} e^{-t^2/2}$$
The 8 relative phase angles $\theta_k = \operatorname{Arg}(W(s_k, t)) \in [0, 2\pi)$ construct the native coordinate vector on the flat torus $\mathbb{T}^8$.

---

### 2.2 Compact input features and fitted coordinates

[MEASURED] The B^1024 hard-clamp leaf encoder formerly described here is retired; `PSI_ENCODER_FINDING.md` records its constant-radius and cosine-equivalent retrieval failure. Current `src/hyper.ts` uses `RIP_DIM = 29`: PAMI inputs use the phase-aware bridge and other numeric-leaf reports use deterministic hashing followed by radial tanh squash with a zero-norm guard.

[MEASURED] Input feature dimension is distinct from fitted manifold dimension: `hyperMap` defaults to 128 coordinates and permits dimensions 2–512. A 1024-dimensional storage/index boundary does not require a 1024-dimensional leaf encoder.

---

### 2.3 Poincaré Ball Hyperbolic Manifold $\mathbb{B}^n$

The Riemannian manifold $(\mathbb{B}^n, g^{\mathbb{B}})$ of constant negative curvature $-1$ is defined on the open unit ball $\mathbb{B}^n = \{x \in \mathbb{R}^n : \|x\|_2 < 1\}$ with conformal metric tensor:
$$g_x^{\mathbb{B}} = \lambda_x^2 g^E = \left(\frac{2}{1 - \|x\|^2}\right)^2 I_n$$

#### 2.3.1 Möbius Gyrovector Operations
Möbius addition $\oplus$ provides the non-associative, non-commutative group operation governing translations in hyperbolic space:
$$u \oplus v = \frac{(1 + 2\langle u, v \rangle + \|v\|^2)u + (1 - \|u\|^2)v}{1 + 2\langle u, v \rangle + \|u\|^2 \|v\|^2}$$
Möbius subtraction is defined as $u \ominus v = u \oplus (-v)$.

#### 2.3.2 Geodesic Distance & Radial Depth
The geodesic distance $d_{\mathbb{B}}(u, v)$ between any two points $u, v \in \mathbb{B}^n$ is computed analytically:
$$d_{\mathbb{B}}(u, v) = \operatorname{arcosh}\left(1 + 2 \frac{\|u - v\|^2}{(1 - \|u\|^2)(1 - \|v\|^2)}\right) = 2 \operatorname{artanh}\left( \|(-u) \oplus v\| \right)$$
The radial depth $\rho(x)$ measured from the manifold origin $\mathbf{0}$ represents derivation depth:
$$\rho(x) = d_{\mathbb{B}}(\mathbf{0}, x) = 2 \operatorname{artanh}(\|x\|)$$

#### 2.3.3 Logarithmic & Exponential Maps
For an arbitrary basepoint $x \in \mathbb{B}^n$, the Riemannian exponential map $\exp_x: T_x\mathbb{B}^n \to \mathbb{B}^n$ and logarithmic map $\log_x: \mathbb{B}^n \to T_x\mathbb{B}^n$ are given by:
$$\exp_x(v) = x \oplus \left( \tanh\left(\frac{\lambda_x \|v\|}{2}\right) \frac{v}{\|v\|} \right)$$
$$\log_x(y) = \frac{2}{\lambda_x} \operatorname{artanh}(\|(-x) \oplus y\|) \frac{(-x) \oplus y}{\|(-x) \oplus y\|}$$
When centered at the origin $x = \mathbf{0}$ ($\lambda_{\mathbf{0}} = 2$), these simplify to:
$$\exp_{\mathbf{0}}(v) = \tanh(\|v\|) \frac{v}{\|v\|}, \quad \log_{\mathbf{0}}(y) = \operatorname{artanh}(\|y\|) \frac{y}{\|y\|}$$

#### 2.3.4 Analytic Distance Gradient & Riemannian SGD
The Euclidean gradient of geodesic distance $\nabla_u d_{\mathbb{B}}(u, v)$ (Nickel & Kiela, 2017):
$$\frac{\partial d_{\mathbb{B}}(u, v)}{\partial u} = \frac{4}{\beta \sqrt{\gamma^2 - 1}} \left( \frac{\|v\|^2 - 2\langle u, v \rangle + 1}{\alpha^2} u - \frac{1}{\alpha} v \right)$$
where $\alpha = 1 - \|u\|^2$, $\beta = 1 - \|v\|^2$, and $\gamma = 1 + \frac{2\|u - v\|^2}{\alpha \beta}$.

The Riemannian gradient $\text{grad}_R f(u)$ rescals the Euclidean gradient via the inverse metric tensor $g_u^{-1}$:
$$\operatorname{grad}_R f(u) = \frac{1}{\lambda_u^2} \nabla_u f(u) = \frac{(1 - \|u\|^2)^2}{4} \nabla_u f(u)$$
Riemannian Stochastic Gradient Descent (RSGD) updates parameter $u_t$ with learning rate $\eta$:
$$u_{t+1} = \Pi_{\varepsilon}\left( \exp_{u_t}\left( -\eta \operatorname{grad}_R f(u_t) \right) \right) = \Pi_{\varepsilon}\left( u_t \oplus \left( -\tanh\left( \frac{\lambda_{u_t} \eta \|\operatorname{grad}_R f(u_t)\|}{2} \right) \frac{\operatorname{grad}_R f(u_t)}{\|\operatorname{grad}_R f(u_t)\|} \right) \right)$$

---

### 2.4 Product Manifold Geometry ($\mathbb{H}^n \times \mathbb{T}^8$)

Cognitive states require joint representation of hierarchical derivation and periodic phase recurrence. Following Gu et al. (ICLR 2019), the unified manifold metric space is defined as the direct Riemannian product:
$$\mathcal{M} = \mathbb{H}^{128} \times \mathbb{T}^8$$
For points $p = (u, \theta_u)$ and $q = (v, \theta_v)$ where $u, v \in \mathbb{B}^{128}$ and $\theta_u, \theta_v \in [0, 2\pi)^8$:
$$d_{\mathcal{M}}^2(p, q) = w_h \cdot d_{\mathbb{B}}^2(u, v) + w_t \cdot d_{\mathbb{T}}^2(\theta_u, \theta_v)$$

#### 2.4.1 $\phi$-Scale Weighted Toroidal Metric
On the flat torus $\mathbb{T}^8$, the distance is the weighted L2 norm over wrapped angular differences:
$$\operatorname{wrap}(\delta) = ((\delta + \pi) \bmod 2\pi) - \pi \in (-\pi, \pi]$$
$$d_{\mathbb{T}}^2(\theta_u, \theta_v) = \sum_{k=0}^{7} \phi^{-k} \cdot \left( \operatorname{wrap}\left(\theta_{u,k} - \theta_{v,k}\right) \right)^2$$
where $\phi^{-k} = (\frac{\sqrt{5}-1}{2})^k$ applies progressive dyadic decay to finer wavelet scales.

#### 2.4.2 Cognitive Disagreement & Tension Detection
The dual-chart product representation enables real-time diagnostic classification of cognitive memory relationships:

$$\begin{aligned}
\text{Normalized Ball Distance: } & \bar{d}_{\mathbb{B}}(u, v) \in [0, 1] \\
\text{Normalized Torus Distance: } & \bar{d}_{\mathbb{T}}(\theta_u, \theta_v) \in [0, 1]
\end{aligned}$$

1. **PAMI Resonance (Convergent Rhythms across Unrelated Lineages):**
   $$\bar{d}_{\mathbb{T}}(\theta_u, \theta_v) < 0.20 \quad \land \quad \bar{d}_{\mathbb{B}}(u, v) > 0.70$$
   *Cognitive Meaning:* Two concepts originate from completely distinct derivation trees but exhibit identical temporal/acoustic phase signatures (e.g., cross-domain metaphorical analogies).
2. **Lineage Drift (Semantic Phase Drift within Shared Lineage):**
   $$\bar{d}_{\mathbb{B}}(u, v) < 0.20 \quad \land \quad \bar{d}_{\mathbb{T}}(\theta_u, \theta_v) > 0.70$$
   *Cognitive Meaning:* A derived conclusion or memory has fundamentally diverged in rhythm, tone, or frequency from its generative premise.

#### 2.4.3 Topological Identity Certification via Winding Invariants
Given a sequential trajectory of memory nodes $S = (p_0, p_1, \dots, p_N)$ with $p_k = (u_k, \theta_k)$, the winding number across each torus circle $j \in \{0, \dots, 7\}$ is computed by integrating wrapped phase increments:
$$W_j(S) = \frac{1}{2\pi} \sum_{k=1}^{N} \operatorname{wrap}\left(\theta_{k, j} - \theta_{k-1, j}\right)$$
For closed loops ($p_N = p_0$), $W(S) \in \mathbb{Z}^8$ is strictly integer-valued. This resolves the identity continuity problem without requiring an ad-hoc lemniscate coordinate chart.

---

### 2.5 Topological Memory Graph & Persistent Homology

The associative memory subsystem organizes episodic and semantic nodes into a simplicial 1-complex $\mathcal{G} = (V, E)$.

```
[ Raw Node Set V ] ──▶ Vietoris-Rips Filtration VR(V, eps) ──▶ Simplicial Complex K
                                                                       │
                                                                       ▼
                                                          Boundary Operators:
                                                          partial_1: C_1 -> C_0
                                                          partial_2: C_2 -> C_1
                                                                       │
                                                                       ▼
                                                          Homology Groups:
                                                          H_0 = Ker(partial_0)/Im(partial_1) (b_0 = C)
                                                          H_1 = Ker(partial_1)/Im(partial_2) (b_1 = E - V + C)
                                                                       │
                                                                       ▼
                                                          Non-Bridge Cycle Edges:
                                                          Conductance w_ij <- 1.30 * w_ij
```

#### 2.5.1 Persistent Homology & Betti Invariants
1. **Chain Groups & Boundary Operators:**
   Let $C_0$ be the $\mathbb{R}$-vector space generated by vertices $V$, $C_1$ by edges $E$, and $C_2$ by 3-cliques (triangles). The linear boundary operators $\partial_k: C_k \to C_{k-1}$ satisfy $\partial_k \circ \partial_{k+1} = 0$:
   $$\partial_1([v_i, v_j]) = [v_j] - [v_i]$$
   $$\partial_2([v_i, v_j, v_k]) = [v_j, v_k] - [v_i, v_k] + [v_i, v_j]$$
2. **Cycle and Boundary Subspaces:**
   $$\text{Cycle Group: } Z_k = \ker(\partial_k), \quad \text{Boundary Group: } B_k = \operatorname{im}(\partial_{k+1})$$
   $$\text{k-th Homology Group: } H_k = Z_k / B_k$$
3. **Betti Numbers:**
   - $\beta_0 = \dim(H_0) = C$ (number of connected components).
   - $\beta_1 = \dim(H_1) = |E| - |V| + C$ (first Betti number = independent topological cycle rank).

#### 2.5.2 Spreading Activation with $1.3\times$ Recurrent Cycle Boost
During associative memory queries, activation propagates across the graph via 2-hop BFS. To reward structurally robust associative paths that participate in persistent cycles (and penalize fragile tree bridges):
$$\text{Conductance}(e_{ij}) = \begin{cases} 1.30 \cdot w_{ij} & \text{if } e_{ij} \in \text{NonBridgeEdges}(\mathcal{G}) \\ 1.00 \cdot w_{ij} & \text{if } e_{ij} \text{ is a cut-edge / bridge} \end{cases}$$
An edge $e_{ij}$ is a non-bridge edge if and only if its removal does not increase the connected component count $C$, certifying its membership in a cycle generator of $H_1(\mathcal{G})$.

---

## 3. Preprint Literature Synthesis & Formal Grounding

### 3.1 Hyperbolic Graph Neural Networks (HGNNs & HGCNs)

#### Literature Synthesis:
- **Nickel & Kiela (NeurIPS 2017):** *Poincaré Embeddings for Learning Hierarchical Representations.* Demonstrated that Poincaré ball embeddings capture semantic hierarchies with orders-of-magnitude fewer dimensions than Euclidean embeddings.
- **Chami, Ying, Ré, & Leskovec (NeurIPS 2019):** *Hyperbolic Graph Convolutional Networks (HGCN).* Formulated Riemannian graph convolutions by mapping node features into tangent spaces via $\log_x$, applying linear transformations and neighborhood aggregation, and mapping back via $\exp_x$.
- **Liu, Nickel, Kiela, & Kantchelian (NeurIPS 2019):** *Hyperbolic Graph Neural Networks.* Introduced hyperbolic attention mechanisms using gyrovector Lorentz/Poincaré formulations.

#### Formal Mathematical Specification in `elle-worker`:
HGCN layers operate directly on node embeddings $h_i^{(l)} \in \mathbb{B}^d$:

$$h_i^{(l+1)} = \exp_{h_i^{(l)}}\left( \sum_{j \in \mathcal{N}(i) \cup \{i\}} \alpha_{ij}^{(l)} \log_{h_i^{(l)}}\left( W^{(l)} \otimes h_j^{(l)} \right) \right)$$

where:
1. **Hyperbolic Matrix Multiplication ($\otimes$):**
   $$W \otimes x = \exp_{\mathbf{0}}\left( W \log_{\mathbf{0}}(x) \right)$$
2. **Tangent Neighborhood Aggregation:**
   $$v_{j \to i}^{(l)} = \log_{h_i^{(l)}}\left( W^{(l)} \otimes h_j^{(l)} \right) \in T_{h_i^{(l)}}\mathbb{B}^d$$
3. **Hyperbolic Attention Weights ($\alpha_{ij}$):**
   $$\alpha_{ij} = \frac{\exp\left( -\beta \cdot d_{\mathbb{B}}\left( W^{(l)} \otimes h_i^{(l)}, W^{(l)} \otimes h_j^{(l)} \right) \right)}{\sum_{k \in \mathcal{N}(i)} \exp\left( -\beta \cdot d_{\mathbb{B}}\left( W^{(l)} \otimes h_i^{(l)}, W^{(l)} \otimes h_k^{(l)} \right) \right)}$$

---

### 3.2 Active Inference & The Free Energy Principle

#### Literature Synthesis:
- **Friston, FitzGerald, Rigoli, Schwartenbeck, & Pezzulo (2017–2024):** *Active Inference: A Process Theory.* Formulated cognition as variational free energy minimization across a Markov blanket.
- **Parr, Pezzulo, & Friston (MIT Press 2022):** *Active Inference: The Free Energy Principle in Mind, Brain, and Behavior.* Rigorous mathematical grounding of discrete state-space Partially Observable Markov Decision Processes (POMDPs).
- **Da Costa et al. (2020):** *Active inference on discrete state-spaces: a synthesis.* Explicit derivations for policy selection based on Expected Free Energy $G(\pi)$.

#### Mathematical Formulation in `elle-worker`:

```
                 ┌──────────────────────────────────────────────┐
                 │             External Environment             │
                 │         (Tool Outputs, DBs, User Chats)      │
                 └──────────────┬────────────────▲──────────────┘
                                │                │
                   Sensory mu_s │                │ Active mu_a
                   Observations │                │ Tool Dispatches
                                ▼                │
                 ┌───────────────────────────────┴──────────────┐
                 │                MARKOV BLANKET                │
                 ├──────────────────────────────────────────────┤
                 │ Internal Cognitive State mu                  │
                 │  • Coherence Triad c = (c_s, c_r, c_h)       │
                 │  • Variational Free Energy: F(c) = U - TS    │
                 │  • Policy Evaluator: min G(pi)               │
                 └──────────────────────────────────────────────┘
```

1. **Variational Free Energy Functional ($F$):**
   Given internal generative model $p(o, s)$ and approximate posterior $q(s)$:
   $$F = \mathbb{E}_{q(s)}[\ln q(s) - \ln p(o, s)] = \underbrace{D_{\text{KL}}[q(s) \parallel p(s)]}_{\text{Complexity (Internal Energy } U\text{)}} - \underbrace{\mathbb{E}_{q(s)}[\ln p(o \mid s)]}_{\text{Accuracy (Entropy } S\text{)}} = U - T \cdot S$$
2. **Expected Free Energy ($G(\pi)$) for Multi-Step Tool Policy $\pi$:**
   The Autonomous Conductor evaluates candidate tool sequences $\pi = (a_1, \dots, a_H)$ by computing:
   $$G(\pi) = \sum_{\tau=1}^{H} G(\pi, \tau)$$
   $$G(\pi, \tau) = \underbrace{D_{\text{KL}}\left[ q(o_\tau \mid \pi) \parallel p(o_\tau) \right]}_{\text{Pragmatic / Instrumental Value (Risk)}} + \underbrace{\mathbb{E}_{q(s_\tau \mid \pi)}\left[ \mathcal{H}\left( q(o_\tau \mid s_\tau) \right) \right]}_{\text{Epistemic / Exploratory Value (Ambiguity)}}$$
   - **Pragmatic Value (Goal Pursuit):** Minimizes divergence between predicted observations $q(o_\tau \mid \pi)$ and prior target goals $p(o_\tau)$.
   - **Epistemic Value (Curiosity / Information Gain):** Maximizes expected entropy reduction $\mathcal{H}$, driving the agent to dispatch diagnostic tools (`diagnose`, `search_corpus`, `pfar`, `vfar`) when state uncertainty is high.
3. **Policy Posterior Probability:**
   $$\sigma(\pi) = \frac{\exp(-\gamma G(\pi))}{\sum_{\pi'} \exp(-\gamma G(\pi'))}$$
   where $\gamma > 0$ is the inverse temperature / policy precision parameter.

---

### 3.3 Geometric Deep Learning & Mixed-Curvature Product Spaces

#### Literature Synthesis:
- **Bronstein, Bruna, Cohen, & Veličković (2021):** *Geometric Deep Learning: Grids, Groups, Graphs, Geodesics, and Gauges.* Established the 5G blueprint unifying symmetry groups, graph message passing, and Riemannian geodesics.
- **Gu, Sala, Gunel, & Ré (ICLR 2019):** *Learning Mixed-Curvature Representations in Product Spaces.* Formulated Riemannian optimization across product manifolds $\mathcal{P} = \prod_{i=1}^{n_h} \mathbb{H}^{d_i} \times \prod_{j=1}^{n_s} \mathbb{S}^{d_j} \times \mathbb{R}^{d_e}$.
- **Gromov (1987):** *Hyperbolic Groups.* Four-point condition for estimating $\delta$-hyperbolicity of metric spaces.

#### $\delta$-Hyperbolicity Estimation in `elle-worker` (`src/structure.ts`):
For any four nodes $x, y, z, w \in V$ in the memory graph with shortest-path metric $d(u, v)$:
$$L_1 = d(x, y) + d(z, w), \quad L_2 = d(x, z) + d(y, w), \quad L_3 = d(x, w) + d(y, z)$$
Sort such that $L_{(1)} \ge L_{(2)} \ge L_{(3)}$. The Gromov four-point defect is:
$$\delta(x, y, z, w) = \frac{L_{(1)} - L_{(2)}}{2}$$
$$\delta(\mathcal{G}) = \max_{x,y,z,w \in V} \delta(x, y, z, w)$$
A graph is hyperbolic if $\delta(\mathcal{G})$ is small ($\delta \le 1$). When $\delta(\mathcal{G}) \to 0$ and cycle density $b_1 / |E| \to 0$, the manifold weighting shifts automatically to $w_h \to 1, w_t \to 0$. When cycle density is high, $w_t$ expands proportionally.

---

### 3.4 Topological Deep Learning & Persistent Memory Networks

#### Literature Synthesis:
- **Bodnar et al. (ICML 2021):** *Weisfeiler and Lehman Go Topological: Message Passing Simplicial Networks (MPSNs).* Extended graph neural networks to simplicial complexes, allowing message passing across boundaries and co-boundaries ($\partial_k, \partial_k^*$).
- **Carlsson (Bull. AMS 2009):** *Topology and Data.* Established persistent homology barcodes for tracking birth and death of topological features across filtration scales.
- **Edelsbrunner & Harer (2008):** *Computational Topology.* Standard matrix reduction algorithms for computing persistence pairs.

#### Implementation in Memory State Representation:
Memory clusters are parameterized as persistence diagrams:
$$\text{Dgm}_k(\mathcal{G}) = \left\{ (b_i, d_i) \in \mathbb{R}^2 : b_i = \text{birth scale}, d_i = \text{death scale} \right\}$$
Persistent features with lifetime $(d_i - b_i) > \tau_{\text{persistence}}$ represent durable cognitive invariants, protected against nightly memory compaction and $\phi^{-n}$ recency decay.

---

## 4. Step-by-Step 4-Phase Implementation Roadmap

```
2026 Q3                         2026 Q4                         2027 Q1                         2027 Q2
PHASE 1                         PHASE 2                         PHASE 3                         PHASE 4
┌─────────────────────────────┐ ┌─────────────────────────────┐ ┌─────────────────────────────┐ ┌─────────────────────────────┐
│ Hyperbolic Foundation       │ │ Multimodal Sensory Intake   │ │ Topological Memory Graph    │ │ Active Inference Loop       │
│ & WASM CORDIC Core          │ │ & Leaf Encoder psi          │ │ & HGNN Associative Recall   │ │ & Coherence Regulator       │
├─────────────────────────────┤ ├─────────────────────────────┤ ├─────────────────────────────┤ ├─────────────────────────────┤
│ • CORDIC Q0.30 Math (Rust)  │ │ • PFAR Audio eGeMAPS DSP    │ │ • Simplicial Complex Engine │ │ • Expected Free Energy G(pi)│
│ • Zero-Copy TypedArray FFI  │ │ • vFAR Visual Gradient / GLCM│ │ • Persistent Homology beta_1│ │ • Markov Blanket Gateways   │
│ • Cooley-Tukey O(NlogN) FFT │ │ • PAMI Wavelet Phase Ripper │ │ • HGCN Riemannian Conv WASM │ │ • Dual-Router Swarm Sync    │
│ • Poincaré Geodesic Metric  │ │ • 1024-dim Leaf Projection  │ │ • Product H^128 x T^8 Atlas │ │ • Live Telemetry Dashboard  │
└─────────────────────────────┘ └─────────────────────────────┘ └─────────────────────────────┘ └─────────────────────────────┘
```

---

### 4.1 Phase 1: Hyperbolic Geometric Foundation & WASM CORDIC Acceleration

**Timeline:** Weeks 1–4  
**Primary Subsystem:** `elle-core-wasm` (`wasm32-unknown-unknown`), `src/fixed-math.ts`, `src/hyper.ts`

#### Technical Objectives:
1. Construct Rust crate `crates/elle-core-wasm` with `no_std` compatibility for Cloudflare `workerd`.
2. Implement 32-bit Q0.30 fixed-point CORDIC algorithms for trigonometric ($\sin, \cos, \operatorname{atan}$) and hyperbolic ($\sinh, \cosh, \operatorname{atanh}$) functions:
   - 28 circular iterations for precision $< 2^{-28}$.
   - 24 hyperbolic iterations with repeated steps at $k \in \{4, 13, 40\}$ to ensure CORDIC convergence.
3. Replace naive $O(N^2)$ Discrete Fourier Transform in `src/pfar.ts` with real-to-complex Cooley-Tukey Radix-2 FFT ($O(N \log N)$).
4. Implement zero-copy TypedArray memory exchange over WebAssembly linear memory (`WebAssembly.Memory`).

#### Mathematical Invariant Checks:
$$\text{CORDIC Angle Error: } |\theta_{\text{calc}} - \theta_{\text{true}}| < 10^{-8}$$
$$\text{Poincaré Distance Error: } |d_{\text{WASM}}(u, v) - d_{\text{Float64}}(u, v)| < 10^{-7}$$

---

### 4.2 Phase 2: Multimodal Sensory Intake & Leaf Encoder $\psi$ Pipeline

**Timeline:** Weeks 5–8  
**Primary Subsystem:** `src/pfar.ts`, `src/vfar.ts`, `src/pami.ts`, `src/mem-intake.ts`, Cloudflare Vectorize

#### Technical Objectives:
1. Deploy WASM-accelerated eGeMAPS acoustic prosody ripper (`pfar_extract_features`), extracting pitch $F_0$, spectral flux, HNR, jitter, and shimmer within $<2\,\text{ms}$ per audio slice.
2. Deploy visual field ripper (`vfar_extract_features`) with 2D Sobel and 8-orientation Gabor filter convolutions.
3. Implement PAMI 8-scale Morlet continuous wavelet phase ripper (`pami_phase_tensor`).
4. Implement 1024-dimensional Leaf Encoder $\psi$:
   - Canonical dotted-path JSON traversal.
   - FNV-1a seeded Box-Muller Gaussian projection.
   - Conformal exponential map $\exp_{\mathbf{0}}(0.9 f)$.
5. Synchronize output embeddings with Cloudflare Vectorize index `elle-corpus-vectors` (1024 dimensions, cosine metric).

---

### 4.3 Phase 3: Topological Memory Graph & HGNN Associative Recall

**Timeline:** Weeks 9–12  
**Primary Subsystem:** `src/graph.ts`, `src/structure.ts`, `src/product.ts`, `src/torus.ts`, Cloudflare D1

#### Technical Objectives:
1. Implement persistent homology engine in Rust/WASM to compute connected components $C$, cycle rank $b_1 = E - V + C$, and identify non-bridge cycle edges.
2. Integrate $1.30\times$ recurrent cycle boost into `graphExpandAB` 2-hop BFS spreading activation.
3. Deploy 2-layer Hyperbolic Graph Convolutional Network (HGCN) message passing over Poincaré node embeddings in WASM.
4. Implement mixed-curvature product chart $\mathbb{H}^{128} \times \mathbb{T}^8$:
   - Dual-chart coordinate storage in D1 `elle_memory_atlas`.
   - Real-time cognitive disagreement detection (`same_rhythm_diff_lineage` vs `same_lineage_drift_phase`).
   - Integer winding number calculation $W \in \mathbb{Z}^8$.

---

### 4.4 Phase 4: Active Inference Action-Perception Loop & Free Energy Regulator

**Timeline:** Weeks 13–16  
**Primary Subsystem:** `src/regulator.ts`, `src/conductor.ts`, `src/observer-blanket.ts`, `src/session-bus.ts`

#### Technical Objectives:
1. Wire Variational Free Energy $F(c) = U(c) - T \cdot S(c)$ across measured system coherences $c = (c_{\text{struct}}, c_{\text{rel}}, c_{\text{harm}})$.
2. Integrate Expected Free Energy $G(\pi)$ policy evaluator into the Autonomous Conductor (`src/conductor.ts`):
   - Balance epistemic exploratory tool dispatches vs instrumental goal delivery.
   - Dynamic thresholding: trigger exploration when state ambiguity $\mathcal{H}(q(o \mid s)) > 0.40$.
3. Deploy Dual-Router task partition:
   - Cloud Gemini 2.5 Pro for deep search grounding and 1M+ token context analysis.
   - Sovereign Local Qwen Swarm for unbounded iterative execution and Docker AST mutations.
4. Finalize live telemetry stream `/api/cognitive/map` streaming real-time Poincaré disk positions, winding vectors, and free-energy Lyapunov traces via Server-Sent Events (SSE).

---

## 5. Precise Data Interfaces, TypeScript/Rust Type Signatures & Acceptance Criteria

### 5.1 TypeScript Core Interfaces

```typescript
// ============================================================
// COGNITIVE MAPPING SYSTEM INTERFACES (TypeScript)
// ============================================================

export type ManifoldKind = 'poincare_ball' | 'flat_torus' | 'product_space';

/** Multimodal sensory intake raw payloads */
export interface SensoryIntakePayload {
  audio_pcm?: {
    samples: Float32Array;
    sample_rate: number;
    channels: number;
  };
  visual_field?: {
    luma_bytes: Uint8Array;
    width: number;
    height: number;
  };
  text_corpus?: {
    raw_content: string;
    source_uri: string;
  };
  pami_stream?: {
    signal_series: Float64Array;
    time_step_ms: number;
  };
}

/** Structured output from Sensory Rippers */
export interface RippedFeatures {
  acoustic?: {
    f0_mean_hz: number;
    f0_std_hz: number;
    jitter_local: number;
    shimmer_local: number;
    hnr_db: number;
    spectral_flux: number;
    rms_energy_contour: number[];
  };
  visual?: {
    gradient_energy_mean: number;
    gabor_orientations_8: number[];
    glcm_contrast: number;
    glcm_homogeneity: number;
    glcm_entropy: number;
  };
  wavelet_phase_8: number[]; // Points in [0, 2pi)^8
  multifractal_13?: number[];
}

/** Point in mixed-curvature product manifold H^128 x T^8 */
export interface ProductManifoldPoint {
  id: string;
  hyperbolic_ball: Float64Array; // Dimension 128, norm <= 1 - 1e-5
  radial_depth: number;          // rho = 2 * atanh(||u||)
  torus_phase_8: Float64Array;   // Dimension 8, values in [0, 2pi)
  winding_vector: Int32Array;    // Topological winding in Z^8
  curvature_mix: {
    weight_hyperbolic: number;
    weight_toroidal: number;
    delta_hyperbolicity: number;
    cycle_rank_b1: number;
  };
}

/** Cognitive Disagreement Diagnostic Report */
export interface CognitiveDisagreementReport {
  pair_a_id: string;
  pair_b_id: string;
  normalized_ball_dist: number;   // [0, 1]
  normalized_torus_dist: number;  // [0, 1]
  classification: 
    | 'coherent'
    | 'pami_resonance'            // Torus-close, Ball-far
    | 'lineage_drift'             // Ball-close, Torus-far
    | 'orthogonal';
}

/** Topological Memory Graph Simplicial Invariants */
export interface TopologicalGraphInvariants {
  vertex_count: number;
  edge_count: number;
  connected_components_b0: number;
  independent_cycle_rank_b1: number; // E - V + C
  chordless_cycles: string[][];
  non_bridge_edges: [string, string][];
  persistent_homology_barcodes: Array<{
    dimension: number;
    birth: number;
    death: number;
  }>;
}

/** Active Inference Coherence State Vector */
export interface ActiveInferenceState {
  coherence_triad: {
    structural: number; // [0, 1]
    relational: number; // [0, 1]
    harmonic: number;   // [0, 1]
  };
  free_energy: {
    F: number;          // F = U - T * S
    internal_energy_U: number;
    entropy_S: number;
    anisotropy_A: number;
  };
  expected_free_energy_G: Record<string, {
    pragmatic_risk: number;
    epistemic_ambiguity: number;
    total_G: number;
    selection_probability: number;
  }>;
  selected_policy: string;
}
```

---

### 5.2 Rust Crate FFI ABI & Linear Memory Layout

```rust
// ============================================================
// ELLE-CORE-WASM: FFI ABI DEFINITIONS (Rust)
// Target: wasm32-unknown-unknown
// ============================================================

#![no_std]
use core::panic::PanicInfo;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Q30(pub i32);

impl Q30 {
    pub const ONE: Q30 = Q30(1 << 30);
    pub const EPSILON: Q30 = Q30(10737); // ~1e-5 in Q0.30

    #[inline(always)]
    pub fn mul(self, rhs: Q30) -> Q30 {
        let prod = (self.0 as i64 * rhs.0 as i64) >> 30;
        Q30(prod as i32)
    }

    #[inline(always)]
    pub fn div(self, rhs: Q30) -> Q30 {
        let quot = ((self.0 as i64) << 30) / (rhs.0 as i64);
        Q30(quot as i32)
    }
}

#[repr(C)]
pub struct WasmBufferHeader {
    pub ptr: *mut u8,
    pub len: usize,
    pub cap: usize,
}

#[repr(C)]
pub struct PoincarePoint128 {
    pub coords: [f64; 128],
    pub norm_sq: f64,
}

#[repr(C)]
pub struct TorusPoint8 {
    pub phases: [f64; 8],
}

#[repr(C)]
pub struct GraphTopologyResult {
    pub num_vertices: u32,
    pub num_edges: u32,
    pub components_b0: u32,
    pub cycle_rank_b1: u32,
    pub non_bridge_edge_count: u32,
}

// ── Exported WASM API Functions ──────────────────────────────

#[no_mangle]
pub extern "C" fn poincare_geodesic_distance(
    u: *const f64,
    v: *const f64,
    dim: usize,
) -> f64 {
    unsafe {
        let u_slice = core::slice::from_raw_parts(u, dim);
        let v_slice = core::slice::from_raw_parts(v, dim);
        
        let mut uv_dot = 0.0;
        let mut u_sq = 0.0;
        let mut v_sq = 0.0;
        let mut diff_sq = 0.0;
        
        for i in 0..dim {
            let ui = u_slice[i];
            let vi = v_slice[i];
            uv_dot += ui * vi;
            u_sq += ui * ui;
            v_sq += vi * vi;
            let d = ui - vi;
            diff_sq += d * d;
        }
        
        let alpha = (1.0 - u_sq).max(1e-12);
        let beta = (1.0 - v_sq).max(1e-12);
        let gamma = 1.0 + (2.0 * diff_sq) / (alpha * beta);
        
        // arcosh(gamma) = ln(gamma + sqrt(gamma^2 - 1))
        let gamma_clamped = gamma.max(1.0);
        (gamma_clamped + (gamma_clamped * gamma_clamped - 1.0).sqrt()).ln()
    }
}

#[no_mangle]
pub extern "C" fn mobius_addition(
    u: *const f64,
    v: *const f64,
    out: *mut f64,
    dim: usize,
) {
    unsafe {
        let u_slice = core::slice::from_raw_parts(u, dim);
        let v_slice = core::slice::from_raw_parts(v, dim);
        let out_slice = core::slice::from_raw_parts_mut(out, dim);
        
        let mut uv = 0.0;
        let mut uu = 0.0;
        let mut vv = 0.0;
        
        for i in 0..dim {
            uv += u_slice[i] * v_slice[i];
            uu += u_slice[i] * u_slice[i];
            vv += v_slice[i] * v_slice[i];
        }
        
        let den = 1.0 + 2.0 * uv + uu * vv;
        let den_safe = if den.abs() < 1e-12 { 1e-12 } else { den };
        
        let a = (1.0 + 2.0 * uv + vv) / den_safe;
        let b = (1.0 - uu) / den_safe;
        
        let mut norm_sq = 0.0;
        for i in 0..dim {
            let val = a * u_slice[i] + b * v_slice[i];
            out_slice[i] = val;
            norm_sq += val * val;
        }
        
        // Boundary Retraction (norm <= 1.0 - 1e-5)
        let max_norm = 1.0 - 1e-5;
        let norm = norm_sq.sqrt();
        if norm > max_norm {
            let scale = max_norm / norm;
            for i in 0..dim {
                out_slice[i] *= scale;
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn radix2_cooley_tukey_fft(
    real: *mut f32,
    imag: *mut f32,
    n: usize,
    inverse: bool,
) {
    unsafe {
        let r = core::slice::from_raw_parts_mut(real, n);
        let im = core::slice::from_raw_parts_mut(imag, n);
        
        // Bit-reversal permutation
        let mut j = 0;
        for i in 0..(n - 1) {
            if i < j {
                r.swap(i, j);
                im.swap(i, j);
            }
            let mut k = n >> 1;
            while k <= j {
                j -= k;
                k >>= 1;
            }
            j += k;
        }
        
        // Cooley-Tukey Radix-2 Butterflies
        let mut len = 2;
        while len <= n {
            let half = len >> 1;
            let angle_step = (if inverse { 2.0 } else { -2.0 }) * core::f32::consts::PI / (len as f32);
            let w_step_r = angle_step.cos();
            let w_step_im = angle_step.sin();
            
            let mut i = 0;
            while i < n {
                let mut wr = 1.0f32;
                let mut wim = 0.0f32;
                for k in 0..half {
                    let u_r = r[i + k];
                    let u_im = im[i + k];
                    let v_r = r[i + k + half] * wr - im[i + k + half] * wim;
                    let v_im = r[i + k + half] * wim + im[i + k + half] * wr;
                    
                    r[i + k] = u_r + v_r;
                    im[i + k] = u_im + v_im;
                    r[i + k + half] = u_r - v_r;
                    im[i + k + half] = u_im - v_im;
                    
                    let next_wr = wr * w_step_r - wim * w_step_im;
                    let next_wim = wr * w_step_im + wim * w_step_r;
                    wr = next_wr;
                    wim = next_wim;
                }
                i += len;
            }
            len <<= 1;
        }
        
        if inverse {
            let inv_n = 1.0 / (n as f32);
            for i in 0..n {
                r[i] *= inv_n;
                im[i] *= inv_n;
            }
        }
    }
}
```

---

### 5.3 Database & Vector Storage Schemas

```sql
-- ============================================================
-- CLOUDFLARE D1 RELATIONAL SCHEMA FOR COGNITIVE MANIFOLD ATLAS
-- ============================================================

-- Table: elle_memory_atlas
-- Stores dual-chart coordinates for memories across H^128 x T^8
CREATE TABLE IF NOT EXISTS elle_memory_atlas (
  id TEXT PRIMARY KEY,                       -- Memory UUID (matches elle_memory.id)
  user_id TEXT NOT NULL,
  hyperbolic_coords BLOB NOT NULL,          -- 128x Float64 raw binary (1024 bytes)
  radial_depth REAL NOT NULL,               -- rho(x) = 2 * atanh(||x||)
  torus_phases BLOB NOT NULL,               -- 8x Float64 raw binary (64 bytes)
  winding_vector TEXT NOT NULL,             -- JSON array of 8 integers: "[0,1,0,0,-1,0,0,0]"
  delta_hyperbolicity REAL NOT NULL,        -- Local 4-point defect
  cycle_rank_b1 INTEGER NOT NULL,           -- b1 invariant at time of placement
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_atlas_user_depth ON elle_memory_atlas(user_id, radial_depth);

-- Table: elle_cognitive_disagreements
-- Logs real-time tension between derivation lineage and phase resonance
CREATE TABLE IF NOT EXISTS elle_cognitive_disagreements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  node_a TEXT NOT NULL,
  node_b TEXT NOT NULL,
  ball_distance REAL NOT NULL,
  torus_distance REAL NOT NULL,
  classification TEXT NOT NULL CHECK(classification IN ('pami_resonance', 'lineage_drift', 'orthogonal')),
  detected_at INTEGER NOT NULL,
  FOREIGN KEY (node_a) REFERENCES elle_memory(id) ON DELETE CASCADE,
  FOREIGN KEY (node_b) REFERENCES elle_memory(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_disagree_user_class ON elle_cognitive_disagreements(user_id, classification);

-- Table: elle_active_inference_log
-- Audit log for Free Energy calculations and policy selections
CREATE TABLE IF NOT EXISTS elle_active_inference_log (
  turn_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  structural_coherence REAL NOT NULL,
  relational_coherence REAL NOT NULL,
  harmonic_coherence REAL NOT NULL,
  free_energy_F REAL NOT NULL,
  internal_energy_U REAL NOT NULL,
  entropy_S REAL NOT NULL,
  selected_tool_policy TEXT NOT NULL,
  expected_free_energy_G REAL NOT NULL,
  created_at INTEGER NOT NULL
);
```

---

### 5.4 Quantitative Acceptance Test Criteria & Validation Fixtures

To achieve publication-grade integrity and pass independent forensic audit, the implementation must satisfy the following exact quantitative benchmarks:

#### Benchmark 1: Hyperbolic Metric Invariant & Boundary Containment
- **Constraint:** For $N = 10{,}000$ randomly generated multimodal sensory reports, the Leaf Encoder $\psi(R)$ must strictly satisfy:
  $$\forall R, \quad \|\psi(R)\|_2 \le 1.0 - 10^{-5}$$
  $$\forall R_a, R_b, \quad d_{\mathbb{B}}(\psi(R_a), \psi(R_b)) \ge 0 \quad \text{and} \quad d_{\mathbb{B}}(\psi(R_a), \psi(R_b)) = d_{\mathbb{B}}(\psi(R_b), \psi(R_a))$$
- **Pass Threshold:** 100% boundary containment, zero NaN/Inf exceptions.

#### Benchmark 2: Integer Winding Exactness on Periodic Trajectories
- **Constraint:** For any simulated periodic state trajectory $S = (p_0, p_1, \dots, p_K, p_0)$ traversing a closed loop on $\mathbb{T}^8$, the computed winding number vector $W(S)$ must satisfy:
  $$\max_{j \in \{0,\dots,7\}} |W_j(S) - \operatorname{round}(W_j(S))| < 10^{-6}$$
- **Pass Threshold:** Exact integer quantization across all 8 wavelet phase circles.

#### Benchmark 3: Associative Graph Cycle Boost Recall Improvement
- **Constraint:** In benchmark memory graph evaluation with 500 nodes and 1,200 edges, enabling the $1.30\times$ recurrent cycle boost on non-bridge edges (`graphExpandAB`) must achieve:
  - Multi-hop recall ROC-AUC increase: $\Delta \text{AUC} \ge +0.06$ ($p < 0.01$).
  - Jaccard divergence against raw BFS: $J_{\text{div}} > 0.15$.

#### Benchmark 4: Active Inference Ambiguity-Driven Exploration
- **Constraint:** When observation state ambiguity exceeds threshold $\mathcal{H}(q(o \mid s)) > 0.40$, the Expected Free Energy policy selector must assign $>65\%$ probability mass to epistemic exploration tools (`diagnose`, `search_corpus`, `pfar`, `vfar`).
- **Pass Threshold:** 100% test pass on active inference policy fixture suite.

#### Benchmark 5: Execution Latency & Zero-Allocation Compute Budgets
- **Micro-Benchmarks:**
  - CORDIC Fixed-Point Geodesic: $< 0.50\,\mu\text{s}$ per computation in WASM ($>40\times$ faster than JS Float64).
  - 4096-Point Cooley-Tukey Real FFT: $< 0.20\,\text{ms}$ per frame in WASM ($>200\times$ faster than $O(N^2)$ JS DFT).
  - End-to-End Multimodal Turn Cycle: $< 800\,\text{ms}$ total response latency over Cloudflare Worker runtime.

---

## 6. Document Governance & Attestation

This implementation plan represents the complete, binding technical specification for the Cognitive Mapping Protocol in `elle-worker`. All subsequent code commits, Rust/WASM module integrations, and database migrations for Milestones M1–M6 must adhere strictly to the mathematical formulations, interfaces, and acceptance benchmarks established herein.

*Certified by:* Worker M6 (Cognitive Mapping Protocol & Literature Synthesis Author)  
*Attestation Date:* 2026-08-29  
*Integrity Mode:* Instrumentation — source-inspected 2026-09-09; not a runtime or deployment validation  
