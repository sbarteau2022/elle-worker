// ============================================================
// THE OBSERVER DOCKET — src/observer-docket.ts
//
// The canonical run-queue for the Five-Axis engine (observer.ts): ten CLOSED
// historical/scientific cases, each frozen at the moment before its resolution,
// each with the realized outcome on the historical record. Prose ground:
// corpus/observer/run-queue-docket.md (seeded into the retrievable corpus).
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
