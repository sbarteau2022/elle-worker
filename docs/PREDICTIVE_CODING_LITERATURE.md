# Predictive coding, grounded — what the literature actually supports

Status: literature survey, no code. Written to answer one question before Target C:
**if κ measures self-consistency (rho≈+0.08 vs outcome, per `src/observer-blanket.ts`),
what does the literature say we should measure instead, and what is worth importing?**

Searched 2026-08-30 across Consensus (peer-reviewed, 220M corpus), Hugging Face
papers (arXiv), and a Wiley full-text gateway. The Wiley pass returned noise and is
not cited here.

---

## 0. The finding that lands hardest on us

> "One-step prediction accuracy does not predict long-horizon planning success:
> across three checkpoints spanning a sevenfold range in prediction error —
> including the authors' own — accuracy orders short-horizon success monotonically
> and **fails to order long-horizon success at all**, where the two most accurate
> checkpoints finish farther from the goal than a random-action policy."
> — *The Evaluation Protocol Determines the Result: An Independent Reproduction of
> LeWorldModel on TwoRoom*, arXiv 2608.10145 (Aug 2026)

This is our rho=+0.08 result, found independently, in a world-model setting, with a
mechanism attached. A per-step residual is a real signal about the step and says
nothing reliable about the trajectory. It cuts both ways for us:

- **Confirms** the instinct to watch alignment over the phase state rather than per
  turn. Per-turn is the level at which the signal is known to be uninformative.
- **Refutes** any assumption that per-turn residuals aggregate into a good
  long-horizon signal just by accumulating them. Our superposition accumulator
  (`T_k = (1-rho)T_{k-1} + |u_k|`) is exactly such an accumulation. It has to earn
  the long-horizon claim on its own evidence; inheriting it from the per-turn term
  is not available.

Same paper, second warning worth keeping: a batch-norm layer inflated their reported
validation loss by up to 300x and concealed a flat training loss for three runs. The
metric hid the failure. We have shipped that failure mode twice this month.

---

## 1. The highest-value import: precision-weighted prediction error

> "Predictive coding offers a local and biologically grounded alternative to
> backpropagation... yet it remains slower, and performance degrades sharply as
> network depth increases. We trace both problems to a single simplification:
> **current PC networks fix the precision matrix to the identity, discarding
> precision-weighted prediction errors** that the variational derivation requires...
> The resulting networks can simultaneously learn activations, weights, and
> precisions under a single free-energy objective, with no global error signal, and
> **resolve inference without requiring iterations or automatic differentiation**."
> — Baskakovs et al., *Closed-form predictive coding via hierarchical Gaussian
> filters*, arXiv 2026

**We are making the identity-precision mistake.** Our holding function weights every
observation equally: a clean transcript and a clipped microphone contribute the same
magnitude to `T_k` and `D_k`. That is the discarded-precision simplification, in our
own code, in the exact place it does the most damage — because the whole point of the
three-cell reading (sincere-and-aligned / sincere-and-divergent / don't-trust-the-
reading) is that observation confidence must be separable from divergence. Without a
precision term there is no way to express "the reading is bad" as distinct from "the
speaker is diverging." That is not a refinement. It is the difference between a
grounding signal and a defamation machine.

Why this specific paper rather than the general PC literature:
- **Closed-form.** No iterative relaxation, no autodiff. That is the difference
  between "cannot run in a 128MB Workers isolate on the request path" and "can."
- **Online + concept drift** is where it beats backprop, which is our regime (a
  conversation is nonstationary by construction) rather than the batch regime.
- Precisions are *learned*, so observation confidence is estimated from data rather
  than being another hand-tuned constant like rho=0.02.

Caveat: FashionMNIST only, zero citations, 2026. Unreplicated. Import the
formulation; do not cite the benchmark.

---

## 2. Hierarchical / multi-timescale prediction is the empirically supported shape

> "While language models are optimized to predict nearby words, the human brain would
> continuously predict a **hierarchy of representations that spans multiple
> timescales**... enhancing these algorithms with predictions that span multiple
> timescales improves this brain mapping... frontoparietal cortices predict
> higher-level, longer-range and more contextual representations than temporal cortices."
> — Caucheteux et al., *Evidence of a predictive coding hierarchy in the human brain
> listening to speech*, Nature Human Behaviour 2023 (n=304 fMRI, 312 citations)

This is the strongest evidence in the survey — large n, top venue, heavily cited —
and it says the thing the phase-state view needs: prediction is organized as a
hierarchy over timescales, not a single next-step residual.

Supporting, from the ML side:
- **Multi-token prediction** (Gloeckle et al. 2024, 372 cites): n independent heads on
  a shared trunk. Sample-efficiency gains that *grow* with model size, 3x faster
  inference, +12% HumanEval / +17% MBPP at 13B. Cheap, proven, orthogonal.
- **HiLP** (2026) is the honest counterweight: naive multi-step latent rollout
  **compounds error**, and they need a higher-level abstract latent above the rollout
  to damp it. Our `L_k = exp(rho * D_k) - 1` bound *is* a compounding-error bound —
  we derived the same failure and bounded it. Their fix is structurally what the DHNG
  phase position is supposed to be for us. That correspondence is the best argument
  yet that the DHNG layer belongs under the superposition rather than beside it.

---

## 3. The correspondence channel we lack has an off-the-shelf toolbox

We have no `agreement` producer. `spine.ts:71` computes agreement *across collapse
tiers* — intra-model consensus, not observation-vs-world. Candidates that measure
correspondence:

- **Semantic entropy probes** (arXiv 2406.15927): approximates semantic entropy from
  the hidden states of **a single generation**. No sampling loop, so it is affordable
  on the request path. Direct descendant of Semantic Uncertainty (2302.09664).
- **Conformal abstention** (arXiv 2405.01563; learnable thresholds, 2502.06884):
  gives a *distribution-free, finite-sample bound* on hallucination rate. This is the
  only family here that converts an assertion into a guarantee. If we ever want a
  claim like S1 to be a bound rather than a slogan, this is the mechanism.
- **Conformal-RAG** (2506.20978): per-sub-claim factuality guarantees over a
  retrieve-and-generate system, no ground-truth annotation needed. Closest fit to
  Elle's actual retrieval shape.

Honest caveat, from inside the same literature: *Addressing Pitfalls in the Evaluation
of Uncertainty Estimation Methods for NLG* (2510.02279) finds the standard evaluations
of these methods are themselves unreliable. Adopting one still requires our own
held-out run — which `RETRIEVAL_EVAL_001.md` says we have never done.

---

## 4. Multimodal grounding: our ceiling design is right, our channel is missing

The modality grounding ceilings (`incoherent:0 / consistent_only:1 /
ungrounded_consistent:2 / grounded:3`) are consistent with what this literature finds,
namely that failure concentrates at *cross-modal alignment*, not within any one modality:

- *The Curse of Multi-Modalities* (2410.12787, 30 upvotes) — vulnerabilities are in
  modality **integration**.
- **AVHBench** (2410.18325) and **SVHalluc** (2026) — audio-visual models specifically
  fail to align spoken content with visual signal.
- **DHCP** (2411.18659) and **vision-aware head divergence** (2412.13949) — cross-modal
  attention divergence is a working detector, training-free.
- **Grounding or Guessing** (2510.18439) — a token-level visual-grounding reliability
  measure that *predicts hallucination rate*. This is the nearest existing thing to
  the `agreement` producer we do not have.

---

## 5. Two claims we must NOT make

**5a. "Predictive coding" is five different claims and they are not interchangeable.**

> Confounds "often identified with predictive coding, but which are **not** predictive
> coding" include: efficient sensory encoding; perceptual experience shaped by prior
> beliefs; cognition as prediction-error minimisation; the brain as a probabilistic
> inference engine; the brain learning a generative model.
> — Sprevak, *Predictive coding I: Introduction*, Philosophy Compass 2023

Several of our docs lean on the free-energy framing loosely. If we invoke predictive
coding in anything published, we must name which of these five we mean. We almost
certainly mean precision-weighted prediction-error minimisation over a hierarchical
generative model — which is the strong version, and the one that carries a burden.

**5b. The canonical sensory-cortex story is contested.**

> "Recent studies of neuronal spiking suggest that genuine prediction errors emerge in
> **prefrontal cortex**. This implies that predictive processing is a more cognitive
> than sensory-based mechanism — an observation that challenges PC."
> — Gabhart et al., *Predictive coding: a more cognitive process than we thought?*,
> Trends in Cognitive Sciences 2025 (38 citations)

Do not build a claim on prediction errors being computed at the sensory layer. If
anything this *supports* the layering we want (the residual is computed high, against
the model, not low, against the pixels) — but it should be cited as contested.

---

## 6. Ranked, what to actually do

1. **Add a precision term to the holding function.** Every observation carries an
   estimated confidence; `T_k`/`D_k` accumulate precision-weighted magnitudes. This is
   the one change that makes the three-cell reading expressible at all, and §1 gives a
   closed-form, iteration-free way to do it. Prerequisite to everything else.
2. ~~**Measure delta-hyperbolicity on content-derived structure.**~~ **Measured on two
   of three arms — precondition not cleared.** `DELTA_HYPERBOLICITY_CONTENT.md`. Real corpus (51 files -> 1021 production
   chunks, tf-idf k-NN) reads graph delta/diam **0.16-0.25** against a synthetic-tree band
   of 0.00-0.08 and a ring/cycle band of 0.475-0.480: **not tree-like**. Instrument
   validated on four controls with hard assertions. Two measured caveats bound the claim:
   the pull-comparison half of the pre-registered rule is uninformative through any k-NN
   pipeline (it returns "not tree-like" for a corpus that IS a tree by construction), and
   tf-idf distances on this corpus are concentrated (IQR/median 0.0210), so the low metric
   delta is an artifact, not evidence of hyperbolicity. The decisive arm — the production
   bge embedding on the same chunks — is egress-blocked from this environment and
   remains open; "not cleared" is not "refuted".
3. **Build one correspondence probe and run it held-out** (§3). Semantic-entropy probe
   is the cheapest honest start; conformal abstention is the one that yields a bound.
   Until a held-out number exists, `agreement` stays absent — a producer that has not
   been scored is not a producer.
4. **Rename κ to what it measures.** `kappa_traj` -> self-consistency. rho=+0.08 against
   outcome is not a defect to hide; it is a correctly-scoped instrument mislabeled.
5. Defer multi-token / multi-timescale prediction heads (§2). Well-supported, but it is
   a training-time change and we do not train the base model.

**Verdict on Target C: not yet, and now for a measured reason.** Item 2 was its own
stated precondition; measured where reachable, no arm found tree-likeness and the lexical
arm reads against it, so the hyperbolic prior Target C would assume is currently
unjustified. It is not condemned: the production-embedding arm is blocked-unmeasured, and
unblocking it (see `DELTA_HYPERBOLICITY_CONTENT.md`) is the one path that could still
clear the precondition. Item 1 is a separate defect in the mechanism Target C would be
built on and is unaffected.

---

## Sources

- arXiv 2608.10145 — *The Evaluation Protocol Determines the Result* (2026)
- Baskakovs et al. — *Closed-form predictive coding via hierarchical Gaussian filters*, arXiv (2026)
- Caucheteux et al. — *Evidence of a predictive coding hierarchy in the human brain listening to speech*, Nature Human Behaviour (2023)
- Gloeckle et al. — *Better & Faster Large Language Models via Multi-token Prediction* (2024)
- Shi et al. — *Hierarchical Latent Prediction for Language Models* (2026)
- Sprevak — *Predictive coding I: Introduction*, Philosophy Compass (2023)
- Gabhart et al. — *Predictive coding: a more cognitive process than we thought?*, Trends in Cognitive Sciences (2025)
- Blondel et al. — *Autoregressive Language Models are Secretly Energy-Based Models* (2025)
- arXiv 2406.15927 (semantic entropy probes), 2302.09664 (semantic uncertainty)
- arXiv 2405.01563, 2502.06884 (conformal abstention), 2506.20978 (Conformal-RAG)
- arXiv 2510.02279 (pitfalls in UQ evaluation)
- arXiv 2410.12787, 2410.18325, 2411.18659, 2412.13949, 2510.18439 (multimodal grounding)
