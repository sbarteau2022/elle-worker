// ============================================================
// THE OBSERVER DOCKET — src/observer-docket.ts
//
// The canonical run-queue for the Five-Axis engine (observer.ts): thirty CLOSED
// historical/scientific cases, each frozen at the moment before its resolution,
// each with the realized outcome on the historical record. Prose ground:
// corpus/observer/run-queue-docket.md (seeded into the retrievable corpus).
//
// Sized deliberately: the falsifier (observer-falsifier.ts) runs a Spearman
// rank test with POWER_FLOOR = 8, and a ten-case docket essentially cannot
// clear its pre-registered p < 0.01 on sample size alone. Thirty cases give
// the gate real power to return a verdict other than UNDERPOWERED.
//
// Why closed cases: the Prediction axis is probability, not prophecy — and a
// probability that is never scored is a performance. Every case here resolved,
// so the record supplies the LABEL (observer_outcomes: what actually happened),
// independent of anything the engine produces. That makes each a complete
// training example for the falsifier (a later rung) to score.
//
// Honest scope: the underlying model has hindsight on these cases; no framing
// removes that. The docket is a CALIBRATION HARNESS for the method — does the
// five-axis process recover the structure the record confirms? — not a blind
// forecast test. Stated plainly in the corpus doc; kept honest here.
//
// This module is PURE DATA + pure helpers: no I/O, no clock. observer.ts owns
// the D1 writes (seed_queue / label_outcomes). Unit-testable in isolation.
// ============================================================

export interface DocketCase {
  // Stable slug — the join key between a staged queue row, its analysis, and
  // its realized outcome. Never reused, never reordered.
  key: string;
  // The subject the engine analyzes. Carries the frozen clock in-band so the
  // analysis is instructed to treat everything after the date as unknown.
  subject: string;
  // The fixed reference the case is held against (Axis-3 anchor).
  anchor: string;
  // What actually happened next — the label written to observer_outcomes.
  // This is the historical record, not a prediction and not a grade.
  realizedOutcome: string;
}

// The frozen-clock preamble every subject carries, so the instruction to set
// hindsight aside is explicit and identical across the docket.
const asOf = (date: string) =>
  `Analyze this case AS OF ${date}. Reason only from what was knowable then; treat everything after that date as genuinely unknown. `;

export const OBSERVER_DOCKET: DocketCase[] = [
  {
    key: 'semmelweis-1848',
    subject: asOf('December 1848') +
      'Ignaz Semmelweis has cut First Clinic childbed-fever mortality roughly tenfold with mandatory chlorinated-lime handwashing, yet the Vienna obstetric establishment holds to miasma and rejects the claim that physicians’ own hands carry the lethal agent. What is actually happening, and what does the pattern predict?',
    anchor: 'The First/Second Clinic maternal-mortality tables, 1841–1848, and the 1847–48 results under mandatory chlorine washing.',
    realizedOutcome:
      'The doctrine was rejected for nearly two decades. Semmelweis was forced out of Vienna, grew embittered, and died in an asylum in 1865 — the year Lister began antiseptic surgery. Germ theory (Pasteur, Koch) vindicated the finding within twenty years of his death; antisepsis became universal doctrine.',
  },
  {
    key: 'wegener-1926',
    subject: asOf('November 1926, at the AAPG symposium in New York') +
      'Alfred Wegener’s continental drift — matched coastlines, shared fossils, aligned glacial striations — is being rejected by the geological establishment on one apparently fatal ground: no mechanism can move continents. What is actually happening beneath the dispute, and what does the pattern predict?',
    anchor: 'The Origin of Continents and Oceans (4th-edition evidence base) and the published proceedings of the 1926 AAPG symposium.',
    realizedOutcome:
      'Drift remained a fringe position for about 35 years. Wegener died on the Greenland ice sheet in 1930, unvindicated. Mid-ocean-ridge mapping, seafloor spreading, and paleomagnetic reversals in the 1960s produced plate tectonics — the unifying theory of the earth sciences, with drift as its surface expression.',
  },
  {
    key: 'lysenko-1948',
    subject: asOf('August 1948, at the close of the VASKhNIL session') +
      'Trofim Lysenko, with direct state backing, has just declared Mendelian genetics a bourgeois pseudoscience; Soviet geneticists must recant, resign, or vanish. What is actually happening, and what does the pattern predict for Soviet biology and agriculture?',
    anchor: 'The stenographic record of the July–August 1948 VASKhNIL session and the Central Committee’s endorsement of Lysenko’s report.',
    realizedOutcome:
      'Soviet genetics was destroyed for a generation — laboratories closed, Vavilov already dead in prison (1943), the science taught from Lysenko’s doctrine. The promised yields never came and the doctrine fed catastrophic agricultural policy. Lysenko fell after Khrushchev’s ouster (1964–65) and genetics was rehabilitated, decades behind the West.',
  },
  {
    key: 'dred-scott-1857',
    subject: asOf('March 1857, the week of the decision') +
      'The Supreme Court has ruled in Dred Scott that no Black American can be a citizen and that Congress cannot bar slavery from the territories. The dominant account holds the question settled and the Union preserved by the settlement; the abolitionist counter-account is dismissed as fanaticism. What is actually happening, and what does the pattern predict?',
    anchor: 'The Dred Scott v. Sandford opinions (Taney for the majority; Curtis and McLean in dissent) and the sectional economy of the 1850s.',
    realizedOutcome:
      'The settlement held four years. Secession and war followed, 1861–65, with roughly three-quarters of a million dead; the Thirteenth Amendment (1865) abolished the institution the decision had called permanent. The deeper labor-and-caste structure both era narratives suppressed reasserted itself after Reconstruction was abandoned in 1877 — convict lease, sharecropping, Jim Crow — for nearly a century.',
  },
  {
    key: 'plessy-1896',
    subject: asOf('May 1896') +
      'The Court has ratified separate-but-equal 7–1 in Plessy v. Ferguson. Justice Harlan alone dissents, calling the Constitution color-blind. What is actually happening beneath the majority’s reasoning, and what does the pattern predict for the dissent?',
    anchor: 'The Plessy v. Ferguson opinions, majority and Harlan’s dissent.',
    realizedOutcome:
      'The majority held 58 years while the dissent’s structural reading — that separation was a caste instrument, not a neutral arrangement — accumulated evidence. Brown v. Board of Education (1954) adopted the dissent’s structure unanimously. The founding case of the Harlan corpus: what structural correctness looks like while it is losing.',
  },
  {
    key: 'broad-street-1855',
    subject: asOf('early 1855, with the second edition just published') +
      'John Snow’s Broad Street spot map and his Lambeth versus Southwark-and-Vauxhall natural experiment implicate contaminated water in cholera, against the miasma consensus of the General Board of Health. What is actually happening, and what does the pattern predict?',
    anchor: 'On the Mode of Communication of Cholera (2nd ed., 1855) and the Board of Health’s 1854 committee report dismissing the water hypothesis.',
    realizedOutcome:
      'The establishment held to miasma; Snow died in 1858 unvindicated. The 1866 East London epidemic traced cleanly to a water company’s unfiltered supply; waterborne transmission became orthodoxy and London’s sanitation was rebuilt on it. William Farr, the ablest miasmatist, publicly converted on the data.',
  },
  {
    key: 'pylori-1984',
    subject: asOf('July 1984, just after Barry Marshall’s self-ingestion') +
      'Warren and Marshall have cultured a spiral bacterium from ulcer patients and argue it causes peptic ulcer disease, against the settled stress-and-acid model and a pharmaceutical market built on lifelong acid suppression. What is actually happening, and what does the pattern predict?',
    anchor: 'Warren & Marshall, The Lancet 1983–84, and the self-ingestion protocol.',
    realizedOutcome:
      'About a decade of resistance, then full reversal: the NIH consensus of 1994 named H. pylori the primary cause of peptic ulcer disease, antibiotic eradication became standard care, and the pair won the Nobel Prize in 2005. The fastest vindication on the docket — the case that sets the lower bound of the base rate.',
  },
  {
    key: 'frank-statement-1954',
    subject: asOf('January 1954, on publication of the “Frank Statement to Cigarette Smokers”') +
      'Mouse-painting experiments and the Doll–Hill epidemiology point to cigarettes as a cause of lung cancer; the tobacco industry answers with a public statement that the science is unsettled and an industry committee will pursue the truth. What is actually happening, and what does the pattern predict?',
    anchor: 'The Frank Statement advertisement (Jan 4, 1954) and the 1950–53 epidemiological and experimental record.',
    realizedOutcome:
      'Doubt was manufactured, deliberately and successfully, for four decades — the founding template of institutional doubt production. The Surgeon General’s report came in 1964; warnings and ad restrictions followed; 1990s document disclosures showed the industry’s own scientists had confirmed causation early; the 1998 Master Settlement and the 2006 RICO fraud judgment closed the record.',
  },
  {
    key: 'housing-2006',
    subject: asOf('June 2006, at the national house-price peak') +
      'The dominant account holds that securitization has dispersed mortgage risk, that national house prices have never fallen, and that the system is resilient; the bubble callers are early, repetitive, and easy to dismiss. What is actually happening, and what does the pattern predict?',
    anchor: 'The mid-2006 Case-Shiller national peak, subprime origination and securitization volumes, and AAA structures resting on a national-diversification correlation assumption.',
    realizedOutcome:
      'The correlation assumption failed as a single national event. From 2007 to 2009 the national index fell about 27% peak-to-trough, the shadow-banking system ran, Bear Stearns and Lehman failed, and risk dispersal proved to be risk concentration in the entities least able to hold it. The issuer-pays ratings incentive entered the record as the suppressed field.',
  },
  {
    key: 'galileo-1633',
    subject: asOf('June 1633, at the abjuration') +
      'Telescopic evidence — the phases of Venus, the moons of Jupiter — supports the Copernican model, but the institution has just convicted Galileo of heresy for the Dialogue. What is actually happening beneath the trial, and what does the pattern predict?',
    anchor: 'The 1633 trial record and the Dialogue Concerning the Two Chief World Systems.',
    realizedOutcome:
      'The longest horizon on the docket. The physics won everywhere the institution’s writ did not run; the Dialogue stayed on the Index until 1835; the institution formally acknowledged error in 1992, 359 years after the abjuration. The case that sets the upper bound of the base rate: structural correctness can outlive every party to the dispute.',
  },

  // ── Second cohort — twenty more closed cases, added to give the falsifier
  //    the statistical power a ten-case docket cannot (a Spearman rank test
  //    over ten points essentially cannot clear p < 0.01; POWER_FLOOR is 8).
  //    Same selection principle: bilateral suppression, a frozen clock, and a
  //    realized outcome on the historical record. Broadened across domains
  //    (science, medicine, law, public health, environment, finance) and
  //    horizons (months to centuries) so the base-rate axis has real range.

  {
    key: 'mendel-1866',
    subject: asOf('1866, on publication in the Brünn society proceedings') +
      'Gregor Mendel’s pea-hybridization experiments imply inheritance is carried by discrete, particulate factors, against a naturalist mainstream that assumes traits blend and that pays his paper no attention. What is actually happening, and what does the pattern predict?',
    anchor: 'Mendel’s "Versuche über Pflanzen-Hybriden" (Proceedings of the Natural History Society of Brünn, 1866) and the blending-inheritance assumptions of the period.',
    realizedOutcome:
      'The work was ignored for 34 years. Mendel died in 1884 unrecognized as a scientist. In 1900 de Vries, Correns, and von Tschermak independently rediscovered his laws; particulate inheritance became the foundation of genetics and, fused with Darwin, the modern synthesis.',
  },
  {
    key: 'boltzmann-atoms-1900',
    subject: asOf('1900') +
      'Ludwig Boltzmann’s statistical mechanics rests on the physical reality of atoms, which Mach and the energeticists led by Ostwald reject as an unobservable metaphysical crutch. What is actually happening beneath the dispute, and what does the pattern predict?',
    anchor: 'Boltzmann’s kinetic theory and H-theorem versus the energeticist/positivist program of Mach and Ostwald around 1900.',
    realizedOutcome:
      'Boltzmann, worn down by the fight, died by suicide in 1906 — just as the tide turned. Einstein’s 1905 analysis of Brownian motion and Perrin’s 1908 experiments made atoms effectively undeniable; Ostwald conceded, Perrin won the 1926 Nobel, and statistical mechanics became bedrock physics.',
  },
  {
    key: 'goldberger-pellagra-1914',
    subject: asOf('1914–1916, during the Southern pellagra epidemic') +
      'Joseph Goldberger’s field studies indicate pellagra is a dietary deficiency, not an infection, against a medical and regional establishment that prefers a germ explanation over confronting the poverty diet of the mill and tenant South. What is actually happening, and what does the pattern predict?',
    anchor: 'Goldberger’s diet-intervention studies in orphanages and mill towns and his "filth-party" self-experiments, versus the contagionist consensus.',
    realizedOutcome:
      'The dietary cause was resisted for years by those invested in a germ theory that implied no social obligation. Goldberger died in 1929 before the mechanism was known; Elvehjem identified niacin as the missing factor in 1937, and niacin fortification eliminated endemic pellagra in the United States.',
  },
  {
    key: 'mcclintock-1951',
    subject: asOf('1951, after the Cold Spring Harbor symposium presentation') +
      'Barbara McClintock’s maize genetics point to mobile "controlling elements" that move within the genome, met with silence and skepticism from a field that treats the genome as a stable string of fixed loci. What is actually happening, and what does the pattern predict?',
    anchor: 'McClintock’s 1950–51 papers and Cold Spring Harbor presentation on transposition in maize.',
    realizedOutcome:
      'Her work was largely set aside for about two decades. Molecular biology confirmed transposable elements in bacteria and then broadly in the 1960s–70s; transposons became central to genetics, and McClintock received an unshared Nobel Prize in 1983.',
  },
  {
    key: 'margulis-endosymbiosis-1967',
    subject: asOf('1967, on publication of "On the Origin of Mitosing Cells"') +
      'Lynn Sagan (Margulis) argues that mitochondria and chloroplasts are descended from once-free-living bacteria engulfed by an ancestral cell, against a cell-biology mainstream that finds the idea fringe and rejects the paper repeatedly. What is actually happening, and what does the pattern predict?',
    anchor: 'The 1967 Journal of Theoretical Biology paper (rejected by some fifteen journals first) and the prevailing autogenous account of organelle origin.',
    realizedOutcome:
      'Endosymbiotic theory was ridiculed for years. Molecular phylogenetics in the 1970s–80s — organellar DNA and ribosomal RNA clearly bacterial in origin — confirmed it decisively; it is now textbook orthodoxy for mitochondria and plastids.',
  },
  {
    key: 'prusiner-prions-1982',
    subject: asOf('1982, on coining the term "prion"') +
      'Stanley Prusiner proposes that scrapie and related diseases are caused by a self-propagating protein with no nucleic acid, against a virology consensus that an infectious agent must carry a gene, and is widely ridiculed for violating the central dogma. What is actually happening, and what does the pattern predict?',
    anchor: 'Prusiner’s 1982 Science paper defining the proteinaceous infectious particle and the nucleic-acid-agent consensus it contradicted.',
    realizedOutcome:
      'The protein-only hypothesis drew years of scorn, then accumulating evidence across scrapie, CJD, kuru, and the BSE epidemic converted the field. Prusiner received the Nobel Prize in 1997; prion disease is now standard neuropathology.',
  },
  {
    key: 'chandrasekhar-1935',
    subject: asOf('1935, after the Royal Astronomical Society meeting') +
      'Subrahmanyan Chandrasekhar’s calculation implies a white dwarf above a critical mass cannot support itself and must collapse further, which Arthur Eddington publicly ridicules from the authority of his standing. What is actually happening, and what does the pattern predict?',
    anchor: 'Chandrasekhar’s relativistic degenerate-matter result (the ~1.4 solar-mass limit) and Eddington’s 1935 RAS rebuttal.',
    realizedOutcome:
      'Eddington’s prestige suppressed the result for years and Chandrasekhar turned to other work. The mass limit proved foundational to stellar collapse, neutron stars, and black holes; Chandrasekhar received the Nobel Prize in 1983 for it.',
  },
  {
    key: 'alvarez-impact-1980',
    subject: asOf('1980, on publication of the iridium-anomaly paper') +
      'Luis and Walter Alvarez propose that a large asteroid impact caused the end-Cretaceous mass extinction, on the evidence of a worldwide iridium layer, against a paleontological and volcanist mainstream committed to gradual, earthbound causes. What is actually happening, and what does the pattern predict?',
    anchor: 'The 1980 Science paper on the K–Pg iridium anomaly and the gradualist/volcanic counter-explanations.',
    realizedOutcome:
      'The hypothesis was resisted for over a decade. The buried Chicxulub crater was identified in 1991 as the impact site of the right age and size; a 2010 multidisciplinary panel affirmed impact as the cause, now the consensus.',
  },
  {
    key: 'ozone-cfc-1974',
    subject: asOf('1974, on publication of the Molina–Rowland paper') +
      'Mario Molina and Sherwood Rowland argue that inert chlorofluorocarbons drift to the stratosphere and catalytically destroy ozone, against a chemical industry that calls the claim speculative and economically reckless. What is actually happening, and what does the pattern predict?',
    anchor: 'The 1974 Nature paper on CFC-catalyzed ozone destruction and the industry response denying a demonstrated hazard.',
    realizedOutcome:
      'Industry contested the science for years. The Antarctic ozone hole, discovered in 1985, matched the mechanism; the Montreal Protocol (1987) phased out CFCs, the ozone layer began recovering, and Molina, Rowland, and Crutzen shared the 1995 Nobel Prize in Chemistry.',
  },
  {
    key: 'ddt-silent-spring-1962',
    subject: asOf('1962, on publication of Silent Spring') +
      'Rachel Carson documents how DDT and other synthetic pesticides accumulate through ecosystems and harm wildlife and people, and the chemical industry mounts a coordinated campaign to discredit her as an alarmist. What is actually happening, and what does the pattern predict?',
    anchor: 'Silent Spring (1962) and the pesticide-industry response challenging Carson’s competence and conclusions.',
    realizedOutcome:
      'The attacks failed to hold. A 1963 presidential science panel largely vindicated Carson; the US banned agricultural DDT in 1972, the EPA was created in 1970, and bald eagles and other species recovered — the founding episode of the modern environmental movement.',
  },
  {
    key: 'leaded-gasoline-1965',
    subject: asOf('1965, at the Kehoe-versus-Patterson confrontation') +
      'Clair Patterson’s measurements indicate industrial lead has raised human body burdens far above natural levels and is harmful, against Robert Kehoe’s long-dominant, industry-funded paradigm that there is no evidence of harm at ambient exposures. What is actually happening, and what does the pattern predict?',
    anchor: 'Patterson’s 1965 "Contaminated and Natural Lead Environments of Man" versus the Kehoe "show-me-the-harm" paradigm backed by the Ethyl Corporation.',
    realizedOutcome:
      'Patterson was pressured and shut out of industry-linked committees, but the evidence held. Leaded gasoline was phased out in the United States between the mid-1970s and 1996; population blood-lead levels fell roughly ninety percent, and the Kehoe paradigm collapsed.',
  },
  {
    key: 'thalidomide-1961',
    subject: asOf('1961, before the drug’s withdrawal') +
      'Thalidomide is marketed across dozens of countries as a uniquely safe sedative, including for pregnant women, while its manufacturer maintains that safety and Frances Kelsey at the US FDA withholds approval over unresolved concerns. What is actually happening, and what does the pattern predict?',
    anchor: 'The manufacturer’s safety claims, the mounting reports of peripheral neuritis and birth defects, and Kelsey’s refusal to clear the US application.',
    realizedOutcome:
      'Thalidomide was confirmed to cause thousands of severe birth defects worldwide and was withdrawn in 1961–62; Kelsey’s caution spared the United States the worst, she was honored in 1962, and the episode produced the 1962 Kefauver–Harris drug-safety amendments requiring proof of efficacy and safety.',
  },
  {
    key: 'dreyfus-1894',
    subject: asOf('1894–1898, from the conviction to "J’Accuse…!"') +
      'Captain Alfred Dreyfus has been convicted of treason on thin and partly forged evidence; the Army and the nationalist press insist the verdict is sound and the honor of the institution requires it stand, while a growing minority argues he was framed. What is actually happening, and what does the pattern predict?',
    anchor: 'The 1894 court-martial record, the forged bordereau evidence, and Émile Zola’s 1898 open letter "J’Accuse…!".',
    realizedOutcome:
      'The cover-up unraveled: the real culprit was Esterhazy, key evidence was shown to be forged, and Dreyfus was fully exonerated and reinstated in 1906. The affair exposed institutional antisemitism and became the archetype of the state closing ranks behind a wrongful conviction.',
  },
  {
    key: 'lochner-1905',
    subject: asOf('1905, the week of the decision') +
      'The Supreme Court has struck down a New York law limiting bakers’ working hours as a violation of "liberty of contract." The dominant account treats this as neutral constitutional principle; Justice Holmes’s dissent calls it economic ideology dressed as law. What is actually happening, and what does the pattern predict?',
    anchor: 'Lochner v. New York and Holmes’s dissent ("The Fourteenth Amendment does not enact Mr. Herbert Spencer’s Social Statics").',
    realizedOutcome:
      'The liberty-of-contract doctrine reigned for three decades, striking down wage-and-hour and labor laws, then collapsed with West Coast Hotel v. Parrish (1937) under New Deal pressure. "Lochnerizing" became the standard byword for judges reading their economics into the Constitution — Holmes’s dissent vindicated.',
  },
  {
    key: 'buck-v-bell-1927',
    subject: asOf('1927, the week of the decision') +
      'The Supreme Court has upheld compulsory sterilization of the "unfit" 8–1, Justice Holmes writing that "three generations of imbeciles are enough." The dominant account treats eugenics as progressive science and settled law. What is actually happening, and what does the pattern predict?',
    anchor: 'Buck v. Bell, the eugenics movement’s scientific standing in the 1920s, and the fabricated record behind Carrie Buck’s case.',
    realizedOutcome:
      'The ruling licensed some 70,000 sterilizations in the United States and was cited approvingly at Nuremberg by Nazi defendants. Eugenics was discredited as pseudoscience after World War II; Skinner v. Oklahoma (1942) cut against it; Buck v. Bell was never formally overruled but is universally repudiated, and states later apologized.',
  },
  {
    key: 'olmstead-1928',
    subject: asOf('1928, the week of the decision') +
      'The Supreme Court has ruled that wiretapping a telephone without any physical trespass is not a search under the Fourth Amendment. Justice Brandeis dissents, arguing for a "right to be let alone" that tracks the technology rather than the trespass. What is actually happening, and what does the pattern predict?',
    anchor: 'Olmstead v. United States and Brandeis’s dissent on privacy and evolving means of surveillance.',
    realizedOutcome:
      'The trespass rule governed for nearly forty years, then Katz v. United States (1967) overruled Olmstead and adopted Brandeis’s reasoning — a "reasonable expectation of privacy" not tied to physical intrusion. The losing dissent became the doctrine.',
  },
  {
    key: 'korematsu-1944',
    subject: asOf('1944, the week of the decision') +
      'The Supreme Court has upheld the wartime exclusion and internment of Japanese Americans 6–3, deferring to a claimed military necessity; Justices Murphy, Jackson, and Roberts dissent. What is actually happening beneath the deference, and what does the pattern predict?',
    anchor: 'Korematsu v. United States, the dissents, and the government’s suppression of intelligence findings that contradicted the necessity claim.',
    realizedOutcome:
      'The "military necessity" rested on evidence the government knew was false. Korematsu’s conviction was vacated in 1983 on proof of that misconduct; the Civil Liberties Act of 1988 gave reparations and a formal apology; the Supreme Court explicitly repudiated Korematsu in Trump v. Hawaii (2018).',
  },
  {
    key: 'ltcm-1998',
    subject: asOf('early 1998, at the fund’s peak') +
      'Long-Term Capital Management, run by Nobel-laureate economists, reports that its models make a loss large enough to threaten the firm a many-standard-deviation, once-in-the-age-of-the-universe event. Markets treat the fund as the smartest money there is. What is actually happening, and what does the pattern predict?',
    anchor: 'LTCM’s leverage and value-at-risk models resting on historical correlations and near-Gaussian tails, mid-1998.',
    realizedOutcome:
      'The Russian default in August 1998 broke the fund’s correlation assumptions; LTCM lost most of its capital in weeks and required a $3.6 billion recapitalization organized by the Federal Reserve to prevent a wider cascade. The tail the models had ruled out arrived on schedule.',
  },
  {
    key: 'enron-2000',
    subject: asOf('2000, at the peak of the stock') +
      'Enron is celebrated as the most innovative company in America, its mark-to-market accounting and off-balance-sheet vehicles taken as sophistication; a few short-sellers and one skeptical reporter ask why no one can explain how it actually makes money. What is actually happening, and what does the pattern predict?',
    anchor: 'Enron’s mark-to-market earnings and special-purpose-entity structures, and the "Is Enron Overpriced?" line of questioning (Fortune, early 2001).',
    realizedOutcome:
      'The structures hid debt and manufactured earnings. Enron filed for bankruptcy in December 2001, Arthur Andersen collapsed, Lay and Skilling were convicted in 2006, and the Sarbanes–Oxley Act (2002) rewrote US accounting oversight. The skeptics were early and correct.',
  },
  {
    key: 'madoff-2005',
    subject: asOf('2005') +
      'Bernard Madoff’s fund reports remarkably steady returns across all market conditions, and analyst Harry Markopolos has repeatedly told the SEC the numbers are mathematically impossible, while regulators and most investors treat Madoff’s reputation as sufficient assurance. What is actually happening, and what does the pattern predict?',
    anchor: 'Madoff’s impossibly smooth return series and Markopolos’s 2000–2005 submissions to the SEC, which cleared the firm.',
    realizedOutcome:
      'It was a Ponzi scheme. It collapsed in December 2008 with roughly $65 billion in fabricated account value; Madoff was sentenced to 150 years in 2009; official reviews documented the SEC’s repeated failure to act on Markopolos’s warnings. The impossible numbers were exactly what they looked like.',
  },
];

// Guard the join keys at import time (house style: fail to boot rather than
// silently carry a broken docket). Keys must be unique and non-empty.
const _keys = OBSERVER_DOCKET.map(c => c.key);
if (new Set(_keys).size !== _keys.length) {
  throw new Error('observer-docket: duplicate case key');
}
if (_keys.some(k => !k.trim())) {
  throw new Error('observer-docket: empty case key');
}

// Look up the realized outcome for a subject as it appears on a completed
// analysis row. The engine stores the full subject (frozen-clock preamble and
// all), so we match on that. Pure. Returns null for a non-docket subject.
export function docketOutcomeForSubject(subject: string): DocketCase | null {
  const s = (subject || '').trim();
  return OBSERVER_DOCKET.find(c => c.subject.trim() === s) ?? null;
}
