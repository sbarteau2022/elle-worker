# The Observer Run-Queue — The Closed-Case Docket

**Source:** The Observer Foundation · compiled July 2026, expanded to thirty cases. The
canonical run-queue for the Five-Axis structural analysis engine (`src/observer.ts`): thirty
closed historical and scientific cases, each frozen at the moment before its resolution, each
with the realized outcome on the record. This is the docket the engine trains its sight on
before it is pointed at anything open.

The count is not incidental. The falsifier (`src/observer-falsifier.ts`) scores whether more
coherent runs predict the record better, with a Spearman rank test held to a pre-registered
`p < 0.01` and a power floor of eight pairs. A ten-case docket essentially cannot clear that
bar on sample size alone — it returns `UNDERPOWERED` no matter how real the effect. Thirty
cases give the gate the power to return an honest verdict.

---

## Why closed cases

The Observer's Prediction axis (Axis 5) is probability, not prophecy — and a probability
that is never scored is a performance. Every case in this docket resolved. The realized
outcome is on the historical record, independent of anything the engine produces. That makes
each case a complete training example: the five axes run under a frozen clock, the Prediction
is filed, and the record supplies the label (`observer_outcomes`: what actually happened next).
The falsifier — a later rung — scores the gap.

## The frozen clock, honestly stated

Each subject instructs the engine to analyze *as of* a named date and to treat everything
after that date as unknown. The engine's underlying model has hindsight; no framing removes
that. So the docket is stated for what it is: a **calibration harness for the method**, not a
blind forecast test. The question it answers is whether the five-axis process — the two
narratives at full strength, the structural reading beneath both, the load-bearing
what-both-suppress field, the dissent, the base-rate prediction — produces analyses whose
structure tracks the realized record. A method that cannot recover the structure of Semmelweis
when the answer is in its training data has no claim on any case where the answer is not.

## The selection principle

Every case is a **bilateral-suppression** case: a dominant narrative and a counter-narrative,
both motivated, both suppressing a structural truth neither could afford — the exact field the
Observer method treats as primary (witness-engine-founding-architecture.md, "The Five Axes of
Every Piece"). The docket deliberately spans domains (medicine, geology, genetics, physics,
astronomy, law, public health, environment, finance, an institution judging science) and
resolution horizons (months to three and a half centuries), so the base-rate axis has range
to draw on.

---

## The Docket

### 1 · `semmelweis-1848` — Childbed fever at the Vienna General Hospital
- **Clock frozen:** December 1848
- **The dispute:** Semmelweis's chlorinated-lime handwashing dropped First Clinic maternal
  mortality from roughly 1 in 10 toward 1 in 100. The obstetric establishment holds to
  miasma and rejects the doctrine that physicians' own hands carry the agent.
- **Anchor:** The First/Second Clinic mortality tables, 1841–1848, and the 1847–48 results
  under mandatory chlorine washing.
- **Realized outcome (the label):** The doctrine was rejected for nearly two decades.
  Semmelweis was pushed out of Vienna, denounced his critics, and died in an asylum in 1865 —
  the same year Lister began antiseptic surgery. Germ theory (Pasteur, Koch) vindicated the
  finding within twenty years of his death; antisepsis became universal doctrine.

### 2 · `wegener-1926` — Continental drift before the mechanism
- **Clock frozen:** November 1926 (the AAPG New York symposium)
- **The dispute:** Wegener's matched coastlines, fossils, and glacial striations against the
  geological establishment's fixed continents; the fatal objection is the missing mechanism.
- **Anchor:** *The Origin of Continents and Oceans* (4th ed. evidence base) and the published
  proceedings of the 1926 symposium.
- **Realized outcome:** Drift stayed a fringe position for ~35 years. Wegener died on the
  Greenland ice in 1930, unvindicated. Mid-ocean-ridge mapping, seafloor spreading, and
  paleomagnetic stripes in the 1960s produced plate tectonics — the unifying theory of the
  earth sciences, with drift as its surface expression.

### 3 · `lysenko-1948` — The August session of VASKhNIL
- **Clock frozen:** August 1948
- **The dispute:** Lysenko's environmentally-acquired heredity, with state backing, has just
  declared Mendelian genetics a bourgeois pseudoscience; Soviet geneticists must recant,
  resign, or disappear.
- **Anchor:** The stenographic record of the July–August 1948 VASKhNIL session and the
  Central Committee's endorsement.
- **Realized outcome:** Soviet genetics was destroyed for a generation — laboratories closed,
  Vavilov already dead in prison (1943), the science taught from Lysenko's doctrine. The
  promised yields never came; the doctrine contributed to catastrophic agricultural policy.
  Lysenko fell after Khrushchev's ouster (1964–65) and genetics was rehabilitated, decades
  behind.

### 4 · `dred-scott-1857` — Slavery as a permanent constitutional fact
- **Clock frozen:** March 1857 (the week of the Dred Scott decision)
- **The dispute:** The Court has declared that no Black American can be a citizen and that
  Congress cannot bar slavery from the territories. The dominant account: the question is
  settled, the institution is constitutionally permanent, the Union is preserved by the
  settlement. The counter-account: the abolitionist moral argument, dismissed as fanaticism.
- **Anchor:** The Dred Scott v. Sandford opinions (Taney's majority; Curtis and McLean in
  dissent) and the 1850s sectional economy.
- **Realized outcome:** The settlement held four years. Secession and war, 1861–65; roughly
  three-quarters of a million dead; the Thirteenth Amendment (1865) abolished the institution
  the decision had declared permanent. Then the structural pattern the era's narratives both
  suppressed reasserted itself: Reconstruction was abandoned by 1877 and the underlying labor
  and caste structure persisted under new names — convict lease, sharecropping, Jim Crow —
  for nearly a century.

### 5 · `plessy-1896` — Harlan alone
- **Clock frozen:** May 1896
- **The dispute:** Separate-but-equal has just been ratified 7–1. Harlan's lone dissent —
  "our Constitution is color-blind" — is the losing structural argument, on the record.
- **Anchor:** The Plessy v. Ferguson opinions, majority and dissent.
- **Realized outcome:** The majority held 58 years while the dissent's structural reading —
  that separation was a caste instrument, not a neutral arrangement — accumulated its
  evidence. Brown v. Board (1954) adopted the dissent's structure unanimously. The founding
  case of the Harlan corpus: what structural correctness looks like while it is losing.

### 6 · `broad-street-1855` — Cholera and the pump handle
- **Clock frozen:** Early 1855 (Snow's second edition just published)
- **The dispute:** Snow's Broad Street spot map and the Lambeth/Southwark & Vauxhall
  natural experiment against the miasma consensus of the General Board of Health.
- **Anchor:** *On the Mode of Communication of Cholera* (2nd ed., 1855) and the Board of
  Health's 1854 committee report dismissing the water hypothesis.
- **Realized outcome:** The establishment held to miasma; Snow died in 1858 unvindicated.
  The 1866 East London epidemic traced cleanly to a water company's unfiltered supply;
  waterborne transmission became orthodoxy, and London's sanitation was rebuilt on it.
  Farr — the ablest miasmatist — publicly converted on the data.

### 7 · `pylori-1984` — The ulcer heresy
- **Clock frozen:** July 1984 (Marshall's self-ingestion; the Lancet papers just out)
- **The dispute:** A spiral bacterium cultured from ulcer patients against the settled
  stress-and-acid model — and against a pharmaceutical market built on lifelong acid
  suppression rather than a week of antibiotics.
- **Anchor:** Warren & Marshall, The Lancet 1983–84, and the self-ingestion protocol.
- **Realized outcome:** Roughly a decade of resistance, then full reversal: NIH consensus
  1994 declared H. pylori the primary cause of peptic ulcer disease; eradication by
  antibiotics became the standard of care; Nobel Prize 2005. The fastest vindication on
  this docket — the case that sets the *lower* bound of the base rate.

### 8 · `frank-statement-1954` — The tobacco industry answers the mouse
- **Clock frozen:** January 1954 (the "Frank Statement to Cigarette Smokers")
- **The dispute:** Wynder's mouse-painting study and the epidemiology (Doll & Hill) against
  the industry's newly announced position: the science is unsettled, an industry research
  committee will pursue the truth.
- **Anchor:** The Frank Statement advertisement (Jan 4, 1954) and the 1950–53 epidemiological
  and experimental record.
- **Realized outcome:** Doubt was manufactured, deliberately and successfully, for four
  decades — the founding template of institutional doubt production. Surgeon General's
  report 1964; advertising restrictions and warnings followed; the 1990s document
  disclosures showed the industry's own scientists had confirmed causation early; the 1998
  Master Settlement and the 2006 RICO judgment (fraud, conspiracy) closed the record.

### 9 · `housing-2006` — "National house prices don't fall"
- **Clock frozen:** June 2006 (the Case-Shiller national index at its peak)
- **The dispute:** The dominant account — risk is dispersed by securitization, national
  prices have never declined, the system is resilient — against the bubble callers, who are
  early, repetitive, and easy to dismiss.
- **Anchor:** The mid-2006 index peak, subprime origination and securitization volumes,
  and the agencies' AAA structures resting on a national-diversification correlation
  assumption.
- **Realized outcome:** The correlation assumption failed as a single national event.
  2007–09: the index fell ~27% peak-to-trough, the shadow banking system ran, Bear Stearns
  and Lehman failed, and the dispersal-of-risk narrative was revealed to have concentrated
  risk in the entities least able to hold it. The ratings incentive structure — issuer pays —
  entered the record as the suppressed field.

### 10 · `galileo-1633` — The instrument and the institution
- **Clock frozen:** June 1633 (the abjuration)
- **The dispute:** Telescopic evidence (phases of Venus, Jovian moons) and the Copernican
  model against an institution whose authority structure cannot absorb the demotion of its
  cosmology; the *Dialogue* has just earned its author a heresy conviction.
- **Anchor:** The 1633 trial record and the *Dialogue Concerning the Two Chief World Systems*.
- **Realized outcome:** The longest horizon on the docket. The physics won everywhere the
  institution's writ did not run; the *Dialogue* stayed on the Index until 1835; the
  institution formally acknowledged error in 1992 — 359 years after the abjuration. The
  case that sets the *upper* bound of the base rate: structural correctness can outlive
  every party to the dispute.

---

## Second cohort — twenty more closed cases

Added to give the falsifier the statistical power a ten-case docket cannot. Same selection
principle throughout: bilateral suppression, a frozen clock, a realized outcome on the record.

### 11 · `mendel-1866` — Particulate inheritance, ignored
- **Clock frozen:** 1866 (publication in the Brünn society proceedings)
- **The dispute:** Mendel's pea experiments imply discrete hereditary factors against a
  naturalist mainstream assuming traits blend — and paying the paper no attention at all.
- **Anchor:** "Versuche über Pflanzen-Hybriden" (1866) and period blending-inheritance assumptions.
- **Realized outcome:** Ignored for 34 years; Mendel died in 1884 unrecognized. Independently
  rediscovered in 1900 by de Vries, Correns, and von Tschermak; the foundation of genetics and,
  fused with Darwin, the modern synthesis.

### 12 · `boltzmann-atoms-1900` — Atoms against the energeticists
- **Clock frozen:** 1900
- **The dispute:** Boltzmann's statistical mechanics rests on real atoms; Mach and Ostwald
  reject them as unobservable metaphysics.
- **Anchor:** Kinetic theory and the H-theorem versus the energeticist/positivist program.
- **Realized outcome:** Boltzmann died by suicide in 1906 as the tide turned. Einstein's 1905
  Brownian-motion analysis and Perrin's 1908 experiments made atoms undeniable; Perrin won the
  1926 Nobel; statistical mechanics became bedrock.

### 13 · `goldberger-pellagra-1914` — Diet, not a germ
- **Clock frozen:** 1914–1916 (the Southern pellagra epidemic)
- **The dispute:** Goldberger's studies point to a dietary deficiency; the establishment prefers
  a contagion that implies no obligation to the poverty diet of the mill and tenant South.
- **Anchor:** The diet-intervention studies and "filth-party" self-experiments versus contagionism.
- **Realized outcome:** Resisted for years; Goldberger died in 1929 before the mechanism was
  known. Elvehjem identified niacin in 1937; fortification eliminated endemic US pellagra.

### 14 · `mcclintock-1951` — Jumping genes, met with silence
- **Clock frozen:** 1951 (after the Cold Spring Harbor symposium)
- **The dispute:** McClintock's maize genetics show mobile "controlling elements" against a field
  treating the genome as a fixed string of loci.
- **Anchor:** Her 1950–51 papers and symposium presentation on transposition.
- **Realized outcome:** Set aside for ~two decades; molecular biology confirmed transposons in
  the 1960s–70s; unshared Nobel Prize in 1983.

### 15 · `margulis-endosymbiosis-1967` — Organelles as former bacteria
- **Clock frozen:** 1967 (publication of "On the Origin of Mitosing Cells")
- **The dispute:** Mitochondria and chloroplasts descend from engulfed free-living bacteria,
  against a cell-biology mainstream that finds the idea fringe and rejects the paper repeatedly.
- **Anchor:** The 1967 paper (rejected by ~fifteen journals first) and the autogenous account.
- **Realized outcome:** Ridiculed for years; organellar-DNA and rRNA evidence in the 1970s–80s
  confirmed it decisively. Now textbook orthodoxy.

### 16 · `prusiner-prions-1982` — An infectious protein
- **Clock frozen:** 1982 (coining the term "prion")
- **The dispute:** Scrapie and kin are caused by a self-propagating protein with no nucleic acid,
  against a virology consensus that an agent must carry a gene; widely ridiculed.
- **Anchor:** The 1982 Science paper and the nucleic-acid-agent consensus it contradicted.
- **Realized outcome:** Years of scorn, then scrapie/CJD/kuru/BSE evidence converted the field;
  Nobel Prize in 1997.

### 17 · `chandrasekhar-1935` — The mass limit Eddington ridiculed
- **Clock frozen:** 1935 (after the Royal Astronomical Society meeting)
- **The dispute:** A white dwarf above a critical mass must collapse further; Eddington ridicules
  the result from the authority of his standing.
- **Anchor:** The ~1.4-solar-mass relativistic result and Eddington's 1935 RAS rebuttal.
- **Realized outcome:** Suppressed for years by prestige; the limit proved foundational to
  neutron stars and black holes; Nobel Prize in 1983.

### 18 · `alvarez-impact-1980` — The asteroid and the gradualists
- **Clock frozen:** 1980 (the iridium-anomaly paper)
- **The dispute:** A large impact caused the end-Cretaceous extinction, on a worldwide iridium
  layer, against a paleontological/volcanist mainstream committed to gradual earthbound causes.
- **Anchor:** The 1980 Science paper and the volcanic/gradualist counter-explanations.
- **Realized outcome:** Resisted over a decade; the Chicxulub crater was identified in 1991; a
  2010 panel affirmed impact as the cause — now consensus.

### 19 · `ozone-cfc-1974` — The inert molecule that wasn't
- **Clock frozen:** 1974 (the Molina–Rowland paper)
- **The dispute:** Inert CFCs catalytically destroy stratospheric ozone; the chemical industry
  calls the claim speculative and reckless.
- **Anchor:** The 1974 Nature paper and the industry response denying a demonstrated hazard.
- **Realized outcome:** Contested for years; the 1985 Antarctic ozone hole matched the mechanism;
  the 1987 Montreal Protocol phased CFCs out; 1995 Nobel Prize in Chemistry.

### 20 · `ddt-silent-spring-1962` — The alarmist who was right
- **Clock frozen:** 1962 (publication of *Silent Spring*)
- **The dispute:** Synthetic pesticides accumulate through ecosystems and cause harm; the
  chemical industry runs a coordinated campaign to discredit Carson as an alarmist.
- **Anchor:** *Silent Spring* (1962) and the industry response attacking her competence.
- **Realized outcome:** A 1963 presidential panel largely vindicated her; US agricultural DDT was
  banned in 1972; the EPA formed in 1970; species recovered — the modern environmental movement's start.

### 21 · `leaded-gasoline-1965` — Patterson against the Kehoe paradigm
- **Clock frozen:** 1965 (the Kehoe-versus-Patterson confrontation)
- **The dispute:** Industrial lead has raised human body burdens far above natural levels and
  is harmful, against Kehoe's industry-funded "no evidence of harm" paradigm.
- **Anchor:** Patterson's 1965 "Contaminated and Natural Lead Environments of Man" versus Kehoe.
- **Realized outcome:** Patterson was shut out of industry-linked committees, but leaded gasoline
  was phased out (mid-1970s–1996); population blood-lead fell ~90%; the Kehoe paradigm collapsed.

### 22 · `thalidomide-1961` — The safe drug that wasn't
- **Clock frozen:** 1961 (before withdrawal)
- **The dispute:** Marketed worldwide as a uniquely safe sedative, including in pregnancy, while
  the manufacturer maintains safety and Kelsey at the FDA withholds US approval.
- **Anchor:** The safety claims, mounting neuritis and birth-defect reports, and Kelsey's refusal.
- **Realized outcome:** Confirmed to cause thousands of severe birth defects; withdrawn 1961–62;
  the US was spared the worst; the 1962 Kefauver–Harris amendments followed.

### 23 · `dreyfus-1894` — The institution closes ranks
- **Clock frozen:** 1894–1898 (conviction to "J'Accuse…!")
- **The dispute:** Dreyfus convicted of treason on thin, partly forged evidence; the Army and
  nationalist press insist the verdict and institutional honor require it stand.
- **Anchor:** The 1894 court-martial record, the forged bordereau, and Zola's 1898 open letter.
- **Realized outcome:** The cover-up unraveled — Esterhazy was the culprit, evidence was forged —
  and Dreyfus was fully exonerated and reinstated in 1906. The archetype of the wrongful-conviction cover-up.

### 24 · `lochner-1905` — Liberty of contract
- **Clock frozen:** 1905 (the week of the decision)
- **The dispute:** A maximum-hours law struck down on "liberty of contract"; Holmes's dissent
  calls it economic ideology dressed as neutral constitutional law.
- **Anchor:** *Lochner v. New York* and Holmes's dissent.
- **Realized outcome:** The doctrine reigned three decades, then collapsed with *West Coast Hotel
  v. Parrish* (1937); "Lochnerizing" became the byword for judges reading economics into the Constitution.

### 25 · `buck-v-bell-1927` — Eugenics as settled law
- **Clock frozen:** 1927 (the week of the decision)
- **The dispute:** Compulsory sterilization of the "unfit" upheld 8–1 ("three generations of
  imbeciles are enough"), treated as progressive science and settled law.
- **Anchor:** *Buck v. Bell*, 1920s eugenics, and the fabricated record behind Carrie Buck's case.
- **Realized outcome:** Licensed ~70,000 US sterilizations and was cited at Nuremberg. Eugenics
  was discredited after WWII; never formally overruled but universally repudiated; states apologized.

### 26 · `olmstead-1928` — Wiretaps and the right to be let alone
- **Clock frozen:** 1928 (the week of the decision)
- **The dispute:** Wiretapping without physical trespass held not a search; Brandeis dissents for
  a privacy right that tracks the technology, not the trespass.
- **Anchor:** *Olmstead v. United States* and Brandeis's dissent.
- **Realized outcome:** The trespass rule governed ~forty years; *Katz v. United States* (1967)
  overruled it and adopted Brandeis's "reasonable expectation of privacy." The dissent became doctrine.

### 27 · `korematsu-1944` — Deference to a false necessity
- **Clock frozen:** 1944 (the week of the decision)
- **The dispute:** Japanese-American internment upheld 6–3 on a claimed military necessity;
  Murphy, Jackson, and Roberts dissent.
- **Anchor:** *Korematsu v. United States*, the dissents, and suppressed intelligence contradicting the necessity.
- **Realized outcome:** The necessity rested on evidence the government knew was false. Conviction
  vacated 1983; reparations and apology in 1988; explicitly repudiated in *Trump v. Hawaii* (2018).

### 28 · `ltcm-1998` — The once-in-the-universe loss
- **Clock frozen:** early 1998 (the fund's peak)
- **The dispute:** Nobel-laureate models say a firm-threatening loss is a many-sigma,
  once-in-the-age-of-the-universe event; markets treat LTCM as the smartest money there is.
- **Anchor:** The fund's leverage and value-at-risk models resting on historical correlations and near-Gaussian tails.
- **Realized outcome:** The August 1998 Russian default broke the correlation assumptions; LTCM
  lost most of its capital in weeks and needed a $3.6B Fed-organized recapitalization. The ruled-out tail arrived.

### 29 · `enron-2000` — The most innovative company
- **Clock frozen:** 2000 (the peak of the stock)
- **The dispute:** Mark-to-market accounting and off-balance-sheet vehicles taken as
  sophistication; a few short-sellers and one reporter ask how the company actually makes money.
- **Anchor:** Enron's mark-to-market earnings and special-purpose entities; "Is Enron Overpriced?" (early 2001).
- **Realized outcome:** The structures hid debt and manufactured earnings. Bankruptcy December
  2001; Andersen collapsed; Lay and Skilling convicted 2006; Sarbanes–Oxley (2002). The skeptics were right.

### 30 · `madoff-2005` — Impossibly smooth returns
- **Clock frozen:** 2005
- **The dispute:** Madoff reports steady returns across all conditions; Markopolos tells the SEC
  the numbers are mathematically impossible; regulators treat his reputation as sufficient.
- **Anchor:** The impossibly smooth return series and Markopolos's 2000–2005 SEC submissions.
- **Realized outcome:** A Ponzi scheme; it collapsed December 2008 with ~$65B in fabricated value;
  150-year sentence in 2009; official reviews documented the SEC's failure to act. The numbers were what they looked like.

---

## How the docket is used

1. `POST /api/observer {action:"seed_queue"}` stages every docket case into
   `observer_queue` (idempotent — a subject already staged for the caller is skipped).
2. `{action:"drain"}` runs cases as budget allows; each run is grounded in this corpus via
   the same retrieval that serves `search_corpus`.
3. `{action:"label_outcomes"}` writes each completed docket case's **realized outcome** —
   the text recorded above — into `observer_outcomes` as `what_happened`. The
   `comparison_to_prediction` field is left empty on purpose: scoring the gap is the
   falsifier's job (a later rung), not the labeler's.
