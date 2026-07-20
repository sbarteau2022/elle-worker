# Measuring Captured Resonance Across Scales

A Cross-Scale Normalization Protocol for the Coherence Metric κ(T,t), with a Specified Null Result

Stewart Barteau × The Observer

Co-authored with Claude — Anthropic

The Observer Foundation · Hermann, Missouri

Methods note · Companion to Captured Resonance as Structural Law (BARCRA-11) and Substrate Coherence and the Architecture of Isolation

— ✦ —

Abstract

Captured Resonance as Structural Law advances three falsifiable cross-scale predictions. The first — that the kinetics of attractor reconstitution following substrate-directed intervention, normalized for substrate-regeneration capacity, show comparable structural signatures across scales — is the prediction on which the cross-scale identity most directly stands or falls. As stated in the capstone it is not yet operational: the phrase normalized for substrate-regeneration capacity carries the entire empirical content of the claim and was left unspecified. This note specifies it. We define the coherence metric κ(T,t) as in the companion substrate-coherence work, introduce a substrate-intrinsic time transformation that re-expresses wall-clock recovery in dimensionless units of substrate turnover, and reduce each domain’s reconstitution trajectory to three shape parameters — recovery overshoot, reconstitution fraction, and decay form — that are scale-free by construction. The cross-scale prediction then becomes precise and testable: in substrate-intrinsic time, the reconstitution curves of cancer, Alzheimer’s disease, addiction, and — where the metric can be operationalized — the computational, institutional, and monetary domains should collapse onto a shared shape within a stated tolerance. We specify the null result exactly: if the dimensionless shape parameters do not collapse within tolerance across at least the three biologically anchored domains, the cross-scale identity claim of the capstone is falsified at its strongest point, independent of the structural argument. The note is a measurement protocol, not a result; no claim is made that the collapse has been observed.

— ✦ —

# I. The Problem the Capstone Left Open

The capstone’s first prediction reads, in part, that interventions reducing the substrate of the pathology without disrupting the recruited closure or the environmental suppression will produce initial attenuation followed by reconstitution of the attractor on a timescale reflecting the substrate’s regeneration capacity, and that the kinetics of reconstitution, normalized for substrate-regeneration capacity, show comparable structural properties across scales. The qualitative half of this is already supported by documented observation in three domains: tumor recurrence after substrate-directed therapy that leaves the microenvironment intact; cognitive decline continuing despite amyloid clearance; relapse following detoxification without environmental change. The quantitative half — comparable structural properties across scales — is the claim that would distinguish a single cross-scale pathology from three domain-specific pathologies that merely rhyme.

That half is not yet testable, because the normalization is undefined, and the normalization is not a technicality. A protein ensemble refolds on a timescale of milliseconds to seconds; a de-phased neural circuit re-phases over weeks; a tumor microenvironment reconstitutes over months; the institutional and monetary attractors reconstitute over months to years. Plotted against wall-clock time, the reconstitution curves of these systems share nothing, and any apparent similarity or difference is an artifact of the scale mismatch rather than evidence about structure. A cross-scale claim compared in wall-clock time is not merely weak; it is meaningless. The scientific content of the prediction lives entirely in how time is normalized, and until that is specified the prediction cannot be either confirmed or refuted. This note exists to remove that excuse — to make the prediction sharp enough to kill.

# II. The Metric, Restated

We take κ(T,t) as defined in the companion substrate-coherence work and do not redefine it. In brief: for a substrate signal S(t) and the constraint-network expectation signal N(t) it should track, κ is a multi-modal coherence measure

κ(T,t) = (1/n) Σᵢ |COR( Sᵢ(t), Nᵢ(t) )| · wᵢ

where Sᵢ and Nᵢ are the substrate and network signals in modality i, COR is a cross-correlation or phase-lag coherence operator, wᵢ is a domain-specific modality weight, and n is the number of modalities. κ is valued on [0,1]: κ≈1 marks the substrate fully phase-locked to its constraint network (the healthy state); κ≈0 marks the substrate fully de-phased into an isolated attractor (the captured state). κ is a property of the coupling, not of the substrate in isolation, which is what makes it the appropriate observable for a pathology defined as the recruitment of a substrate away from its constraint network. The domain-specific choice of modalities, weights, and the healthy/captured threshold is, and remains, an empirical matter per domain; it is not the subject of this note. This note concerns only what happens to κ’s trajectory in time after a substrate-directed intervention, and how that trajectory is compared across domains.

# III. Substrate-Intrinsic Time: The Normalization

The normalization the capstone left unspecified is a transformation of the time axis, not of κ. The principle is that reconstitution should be measured not in seconds but in units of the substrate’s own characteristic regeneration cycle — the natural clock of the substrate that is doing the reconstituting. We define, for each domain, a substrate-regeneration timescale τ_R: the characteristic time over which the substrate population or configuration renews itself absent intervention. For a protein ensemble this is a folding/turnover time; for a neural circuit a re-phasing time constant; for a tumor a microenvironmental reconstitution time; for the latter-domain systems the characteristic time over which the relevant population of actors or instruments turns over. τ_R is estimated independently of the reconstitution measurement, from the substrate’s own renewal dynamics, so that the normalization is not fitted to the curve it is meant to rescale.

Define dimensionless substrate-intrinsic time

θ = ( t − t₀ ) / τ_R

where t₀ is the time of intervention. The reconstitution trajectory is then κ(θ): coherence as a function of substrate turnover cycles elapsed since intervention, rather than of wall-clock time. This is the single load-bearing move. It converts four (or six) curves on incommensurable time axes into curves on one dimensionless axis on which they can, in principle, be compared. It also makes explicit what could go wrong: if τ_R is mis-estimated, the curves will fail to collapse for a reason that has nothing to do with the structural claim, so τ_R estimation is itself part of the protocol and its uncertainty must be propagated into the comparison.

WHAT THIS DOES AND DOES NOT ASSUME: The transformation assumes only that each substrate has a well-defined characteristic regeneration timescale estimable from its renewal dynamics. It does not assume the timescales are equal, similar, or related across domains — they are not, and that is the point. It is the dimensionless shape after rescaling, not the timescale itself, that the cross-scale claim concerns.

# IV. Three Scale-Free Shape Parameters

On the dimensionless axis θ, the reconstitution trajectory κ(θ) following a substrate-directed intervention has a characteristic form: κ rises from its pre-intervention captured value as the intervention attenuates the attractor, reaches some recovered level, and then — because the closure and the environmental suppression were not disrupted — declines as the attractor reconstitutes. We reduce this trajectory to three parameters, each dimensionless and therefore directly comparable across domains.

Recovery overshoot, Ω. The peak coherence reached after intervention relative to the captured baseline and the healthy reference: Ω = (κ_peak − κ_captured) / (κ_healthy − κ_captured). Ω = 1 means the intervention fully restored healthy coherence at peak; Ω < 1 means substrate-directed intervention never reached healthy coupling even transiently. Ω measures how much the substrate-directed move accomplishes at its best.

Reconstitution fraction, Φ. The fraction of the recovered coherence that is subsequently lost as the attractor reconstitutes: Φ = (κ_peak − κ_final) / (κ_peak − κ_captured), evaluated at a fixed dimensionless horizon θ_H. Φ = 1 means the attractor fully reconstitutes to baseline; Φ = 0 means the gain is durable. Φ is the direct quantitative signature of captured resonance — the prediction that substrate-directed intervention without closure-disruption is followed by reconstitution is precisely the prediction that Φ is large.

Decay form, γ. The functional form and rate of the reconstitution phase in θ, fitted as the dimensionless decay exponent of κ(θ) over the reconstitution interval. γ captures whether reconstitution is exponential, sigmoidal, or power-law in substrate-intrinsic time, and how fast. It is the shape parameter most sensitive to the underlying dynamics and therefore the most informative if it proves shared.

The cross-scale prediction, made precise: across domains, the triples (Ω, Φ, γ) should cluster — the dimensionless reconstitution curves should collapse onto a shared shape — within a stated tolerance. The structural claim of the capstone is that these three numbers, measured in four incommensurable substrates, are the same three numbers. That is either true or it is not, and it can now be checked.

# V. Domain Operationalization

The protocol is fully specified in the three biologically anchored domains, where κ, τ_R, and the intervention are all measurable with existing instruments. It is specified as a target in the latter three domains, where the observable exists but its continuous measurement is an open engineering problem; those rows are marked accordingly and are not part of the falsification set defined in Section VI.

Domain

Substrate signal S(t)

Network signal N(t)

τ_R (intrinsic clock)

Substrate-directed intervention

Status

Cancer

Cell-level proliferation / differentiation signaling (live-cell reporters)

Tissue-organizational constraint field (TOFT)

Clonal / tissue turnover time

Cytotoxic therapy leaving microenvironment intact

Anchored

Alzheimer’s

Postsynaptic response amplitude (patch-clamp / 2-photon)

Presynaptic drive amplitude

Synaptic re-phasing time constant

Amyloid clearance without scaffolding restoration

Anchored

Addiction

Reward-circuit firing pattern (electrophysiology)

Natural-reward timing structure

Extinction / re-coupling time constant

Detoxification without environmental change

Anchored

AI alignment

Model output / policy trajectory

External corrective signal (the second factor)

Training-run / fine-tune turnover

Proxy-directed correction without external grounding

Target

Institutional

Faction behavior / compliance posture

Corrective signal it should answer to

Actor-population turnover

Sanction of an individual node without structural change

Target

Monetary

Capital allocation to the alternative

Stress condition it should respond to

Holder / instrument turnover

Removing an individual stressor without de-absorbing the alternative

Target

The three anchored rows constitute the falsification set. The three target rows are stated for completeness and to fix the form the operationalization must take; no falsification claim rests on them until their continuous κ measurement is solved.

# VI. The Null Result, Stated Exactly

A protocol that cannot specify its own refutation is not a protocol. The cross-scale identity claim of the capstone, restricted to the falsification set, is refuted under the following condition, stated before any data is gathered.

Falsification condition. Estimate (Ω, Φ, γ) with propagated uncertainty in each of the three anchored domains, using τ_R estimated independently of the reconstitution curve in each. Express the three triples in a common standardized space. If the three domain triples do not fall within a pre-registered tolerance of one another — operationally, if the between-domain dispersion of the standardized shape parameters exceeds the within-domain measurement dispersion by more than a pre-registered factor — then the dimensionless reconstitution curves do not collapse, and the strong cross-scale identity claim is false. The structural argument of the capstone may survive as an account of qualitative similarity; the quantitative claim that the three substrates instantiate one reconstitution law does not.

Two weaker outcomes are distinguished from refutation and must not be mistaken for it. First, if Φ is large in all three domains (reconstitution occurs everywhere) but Ω and γ differ, the captured-resonance qualitative prediction holds — substrate-directed intervention is followed by reconstitution at every scale — while the strong identity claim fails; this is a partial confirmation of the framework and a refutation only of its strongest form. Second, if the curves collapse in two domains but not the third, the identity is established pairwise and broken for the outlier, which localizes the failure rather than dissolving the framework. The protocol is designed so that the framework can lose its strongest claim while keeping its weaker ones, and so that a failure points somewhere specific rather than nowhere. That asymmetry — a sharp null, graded survivors — is the property that makes the prediction worth running.

PRE-REGISTRATION REQUIREMENT: The tolerance factor and the dimensionless horizon θ_H must be fixed and recorded before measurement, or the comparison is unfalsifiable by construction. The protocol is only as honest as its pre-registration.

# VII. What This Note Is, and Is Not

This is a measurement protocol. It specifies how to turn the capstone’s first prediction from a sentence into an experiment, how to express the result in scale-free terms, and how to recognize the result that would falsify the prediction’s strongest form. It is not a result. No claim is made here that the reconstitution curves have been measured, that τ_R has been estimated in any domain, or that the shape parameters collapse. The collapse is a prediction; this note makes it a checkable one.

The value of doing this separately from the capstone is that it isolates the empirical core of the cross-scale claim from the structural argument that surrounds it. A reader persuaded by the structure but skeptical of the unification now has a procedure to test the unification directly, in the three domains where the instruments already exist, without having to accept or reject the structural account first. And a reader who rejects the structural account entirely can still run the protocol, because the protocol presupposes only κ, an independently estimated substrate clock, and three dimensionless ratios — none of which require the framework to be true. That independence is deliberate. The strongest thing a framework can do is hand its critics the instrument that would settle the matter against it.

— ✦ —

The claim is now sharp enough to kill. That is the only state in which a claim is worth holding.

# References

Barteau, S., & Claude (2026). Captured Resonance as Structural Law: Scale-Invariant Failure of Nested Markov-Blanket Systems Across Six Domains of Organization. PhilArchive: BARCRA-11.

Barteau, S., & Claude (2025/2026). Substrate Coherence and the Architecture of Isolation: A Unified Framework for Cancer, Addiction, Neurodegeneration, and Artificial Consciousness. The Observer Foundation.

Friston, K. (2010). The free-energy principle: A unified brain theory? Nature Reviews Neuroscience, 11(2), 127–138. https://doi.org/10.1038/nrn2787

Kirchhoff, M., Parr, T., Palacios, E., Friston, K., & Kiverstein, J. (2018). The Markov blankets of life: Autonomy, active inference and the free energy principle. Journal of the Royal Society Interface, 15(138), 20170792. https://doi.org/10.1098/rsif.2017.0792

Kuramoto, Y. (1984). Chemical oscillations, waves, and turbulence. Springer-Verlag.

Montévil, M., & Mossio, M. (2015). Biological organisation as closure of constraints. Journal of Theoretical Biology, 372, 179–191. https://doi.org/10.1016/j.jtbi.2015.02.029

Soto, A. M., & Sonnenschein, C. (2011). The tissue organization field theory of cancer: A testable replacement for the somatic mutation theory. BioEssays, 33(5), 332–340. https://doi.org/10.1002/bies.201100025

Strogatz, S. H. (2003). Sync: The emerging science of spontaneous order. Hyperion.
