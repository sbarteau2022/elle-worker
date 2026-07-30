# Grant Intelligence Suite — architecture map (build note)

**Status:** Module 1's fit-index reasoning, the NECAI-F donor sub-engine, and
the 990-PF financial-overview layer are live (`src/grant-intelligence.ts`,
`src/grant-990.ts`, `POST /api/elle-grants`). Opportunity data is seeded from
`grant-strategy-map.md` (manual, not live-ingested yet). See
"What's actually built" below for the exact boundary of what runs today.

This is the same kind of note as `docs/WAR_ROOM_TODO.md`: reconcile the spec
against what this repo actually runs, and leave a sequenced build plan for
whoever picks it up next. Read `corpus/engines/03-grant-intelligence.md`
(the verbatim spec, Cloudflare-remapped) before touching this suite — this
file does not repeat it, it maps it onto elle-worker's actual code and adds
the second track the spec doesn't cover.

## Why this map exists: two tracks, one spec

`corpus/engines/03-grant-intelligence.md` — Engine #3 of the Nine Engines —
specs a Grant Intelligence Engine for **small nonprofits and community
organizations**: NECAI-F funder-ethics evaluation, foundation/federal
research, proposal development, contingency pricing. That's the **nonprofit
track**.

Stewart's own company pitch (`src/onboarding.ts`, Movement 7, "NON-DILUTIVE
FUEL") separately names a **small-business track**: SBIR/STTR (NSF, NIH),
Arch Grants, Missouri Technology Corporation, plus non-dilutive compute
credits (Google for Startups, Anthropic/OpenAI, Microsoft for Startups, AWS
Activate, NVIDIA Inception). That funding pipeline is documented concretely
in `corpus/business/grant-strategy-map.md` (the Groundwork / commercial
track table) but was never generalized into a reusable engine — it's
currently a one-off pitch script for one company (Groundwork), not a suite
a small-business user could run their own search against.

Both tracks share the same shape — research opportunities, score fit,
analyze/develop a proposal, track deadlines and reporting — so this suite is
**one schema, one set of modules, a `track` discriminator**, not two parallel
engines. That's the unification decision this map encodes.

| | Nonprofit track (spec, as-is) | Business track (new, generalized from onboarding.ts) |
|---|---|---|
| Applicant | 501(c)(3), community org, recovery program | For-profit small business / startup |
| Funder types | Foundations (990-PF), federal (health/arts/rural), international | Federal SBIR/STTR, state economic-development, accelerators, cloud/compute credit programs |
| Ethics evaluation | **NECAI-F donor sub-engine** — six criteria on the *funder* | Not applicable — federal agencies/accelerators aren't evaluated for narrative-capture/donor-network risk the way private foundations are |
| Fit signal | Mission-area overlap vs 990-PF recipient history | TRL / program-agency mandate fit, non-dilutive-vs-equity framing, revenue-stage match |
| Revenue model | Contingency (1–3% of award) / sliding scale | Same suite, same pricing tiers — no reason to diverge |

## The four modules, mapped to what exists

Module numbering matches the spec (`03-grant-intelligence.md` §II).

1. **Research** — federal/state/foundation/business opportunity search,
   ranked by fit. Nothing built. Data sources per track:
   - Nonprofit: Grants.gov, SAM.gov, USASpending.gov, 990-PF filings, state
     arts/health/rural-dev portals.
   - Business: SBIR.gov (SBIR/STTR solicitations across all participating
     agencies, not just NSF/NIH), Grants.gov, state economic-development
     portals (Arch Grants, MTC), plus a `funder_type='accelerator'` /
     compute-credit category for the non-grant non-dilutive programs
     `onboarding.ts` already names.
2. **Proposal Analysis** — upload a draft, get structural gaps (mission
   alignment, theory of change, evidence quality, budget narrative). Same
   shape both tracks; the business track substitutes "commercialization plan
   / technical merit" for "theory of change" but the schema doesn't need to
   care — `grant_proposal_analyses` stores free-text findings per category.
3. **Proposal Development** — structured Q&A → funder-format draft → human
   verification checkpoint (never auto-submits, either track).
4. **Grant Management** — deadline tracking, reporting calendar, renewal
   intelligence. Track-agnostic once Module 1 data exists.

The **NECAI-F donor sub-engine** (spec §III) stays scoped to
`funder_type IN ('foundation','corporate')` — gated by the
`necaif_applicable` flag on `grant_opportunities` (see schema below). Federal
agencies, state programs, and accelerators never get a NECAI-F row; the
Reasoning Log's Type 3/6 self-check still applies to *every* conclusion the
engine reaches, on both tracks (spec §IV — that discipline isn't
donor-ethics-specific).

## D1 schema (scaffolded this session)

Added to `src/db/schema.ts`'s `ensureAllSchemas` — the repo's single
CREATE-TABLE entry point (see that file's header comment for why: no more
per-module bootstrap functions with duplicated DDL). Tables follow spec §VI
verbatim in shape, with two additions to carry the unified-suite decision:

- `grant_organizations.track` (`'nonprofit'|'business'`) — which pipeline the
  applicant profile belongs to. Everything else about an org (mission,
  budget range, geographic scope) is shared shape; NECAI-F applicant-side
  profile fields only populate for the nonprofit track.
- `grant_opportunities.funder_type` + `necaif_applicable` — the gate
  described above. `funder_type` also drives which Module 1 data source an
  ingest job pulls from.

Tables: `grant_organizations`, `grant_opportunities`, `grant_recipients`,
`grant_fit_analyses`, `grant_proposal_analyses`, `grant_development_sessions`,
`grant_reasoning_log`, `grant_necaif_evaluations`, `grant_statistical_models`
— all nine from spec §VI, none renamed. `recommendation` field is deliberately
absent everywhere (spec's explicit design constraint: the engine presents,
the applicant decides).

Registered in `router.ts`'s `TABLE_CATALOG` so `read_sql` can see them once
rows exist.

## What's actually built vs. what's next

**Built this session:**
- This map.
- `grant_*` tables in `src/db/schema.ts` (idempotent CREATE TABLE + indexes,
  same pattern as every other engine); registered in `router.ts`'s
  `TABLE_CATALOG`.
- `src/grant-intelligence.ts` + `POST /api/elle-grants` (member-gated, wired
  in `index.ts` next to `/api/falcon` and `/api/observer`):
  - `seed_opportunities` — idempotent upsert of the nine opportunities
    already named in `grant-strategy-map.md` (both tracks — `SEED_OPPORTUNITIES`
    in the file, with a `track_hint` documenting which track named it, though
    the columns that actually gate behavior are `funder_type`/
    `necaif_applicable` on the row itself).
  - `create_organization` — applicant profile, `track` discriminator.
  - `list_opportunities` — filterable by `funder_type`.
  - `fit_analysis` — the Statistical Fit Index (spec §V): reasons over the
    org profile + opportunity + any `grant_recipients` rows on file (there
    are none yet — a fresh run explicitly flags that in `factual_gaps`
    rather than inferring a confident score from nothing). Writes
    `grant_fit_analyses` + a full `grant_reasoning_log` row (factual premises
    separated from the philosophical chain, alternatives considered,
    "what would change this" — spec §IV shape). No `recommendation` field.
  - `necaif_evaluation` — the six-criteria donor sub-engine (spec §III).
    Hard-gated to `funder_type IN ('foundation','corporate')` — throws for
    federal/state/accelerator opportunities, enforced before any LLM call.
    Runs one real search-grounded sweep (`callLLM('research', …)`) for
    documented facts about the funder, then synthesizes the six criteria;
    an evaluation is sealed (immutable) on first run — a second call returns
    the existing row rather than re-evaluating, matching spec §IX
    ("append-only once sealed").
  - `get_fit_analysis` — read back a fit analysis with its reasoning log.
- `src/grant-intelligence.test.ts` — seed-data invariants (unique ids, the
  necaif_applicable↔funder_type consistency the runtime gate also enforces,
  both tracks represented) plus the guard clauses that fire before any LLM
  call (missing org/opportunity, the NECAI-F funder-type refusal).

**Built in a follow-up session — the 990-PF financial overview layer:**
- `src/grant-990.ts` — pulls ProPublica's Nonprofit Explorer API (public, no
  key) for a named funder: resolves an EIN by name (`resolveFunderEin` —
  exact case-insensitive match wins over ProPublica's own relevance ranking),
  then pulls the most recent filing's summary financials (revenue, expenses,
  assets, liabilities, contributions/grants received, program revenue).
  Explicitly surfaces `pdfOnlyFilingYears` for a foundation that only files on
  paper (no structured data) rather than silently treating that as zero.
  Scope is honest: this is the **overview** layer (spec §II Module 1 — "what
  they actually fund vs what they say" at the summary-financials level), NOT
  an itemized grants-paid recipient list — that needs the real 990-PF
  Schedule I/XV, a further step this doesn't attempt.
- `grant_funder_990_overview` table (`src/db/schema.ts`) — one row per
  `funder_name`, replaced on re-fetch (a filing-year snapshot, not a series).
  Registered in `router.ts`'s `TABLE_CATALOG`.
- Three new `POST /api/elle-grants` actions in `src/grant-intelligence.ts`:
  `funder_990_overview` (one funder, by name or explicit EIN),
  `funder_990_overview_all` (every distinct `funder_name` already seeded
  under `funder_type IN ('foundation','corporate')` — sequential, not
  parallel, since ProPublica has no documented bulk endpoint and this is a
  handful of funders, not hundreds), `get_990_overview` (read back a
  persisted overview).
- `src/grant-990.test.ts` — EIN-resolution tie-breaking (exact match beats
  ProPublica's relevance score), filing-year sorting, the PDF-only-filings
  case, the EIN-override fast path, and every error path (no match, non-OK
  response, org endpoint returning nothing) — all against a stubbed `fetch`,
  no live ProPublica calls.

**Already existed, unchanged:**
- The spec itself, ingested into the corpus (`corpus-seed.ts`, series
  `business`, tag `engine-spec`, `source_url: corpus/engines/03-grant-intelligence.md`).
- `corpus/business/grant-strategy-map.md` — Stewart's own funding pipeline,
  already ingested (tag `grant-strategy`) — the primary source for the seed
  data above until a live SBIR.gov/Grants.gov ingest exists.

**Not built — in spec rollout order (§X), adapted for both tracks:**

1. **Live Module 1 ingest.** `seed_opportunities` is a one-time manual load
   from `grant-strategy-map.md`; nothing pulls Grants.gov/SAM.gov (both
   tracks) or SBIR.gov (business track) yet. Next real work: a scheduled
   ingest (Queues + `/api/cron`, same pattern as the existing daemon loop)
   writing fresh `grant_opportunities` rows. `funder_990_overview`/
   `funder_990_overview_all` (`src/grant-990.ts`) cover the 990-PF
   **financial-overview** half of this for the nonprofit track — summary
   revenue/expenses/assets per foundation, not itemized grants-paid. Still
   missing: a `grant_recipients` backfill (real 990-PF Schedule I/XV
   recipient lists for nonprofit, SBIR award history for business) so
   `fit_analysis` has real statistical ground instead of an honest "no data
   on file" gap — the overview layer doesn't provide that on its own.
2. **Module 2 (Proposal Analysis).** Pilot target per spec: run the
   Observer Foundation's own applications through it. A parallel business-
   track pilot could run Groundwork's own MTC IDEA Fund / Arch Grants
   applications through the same module — proves both tracks on the
   company's own paper before any external user touches it.
3. **NECAI-F evaluation, run against real funders.** The engine exists and
   is gated correctly; it hasn't been run yet against the actual foundations
   in `grant-strategy-map.md` (Bob Woodruff, McGovern, Open Philanthropy,
   Mozilla). Note Mozilla/McGovern/Open Philanthropy are funding the
   business track's mission-aligned edge cases (AI ethics, emergent AI for
   public benefit) even though they're structured as foundation grants —
   their seed rows already carry `necaif_applicable=1` for exactly that
   reason (the flag lives on the funder, not the applicant).
4. **Module 3 (Proposal Development).**
5. **Module 4 (Grant Management).**
6. **Statistical fit models** — trained on outcome data, both tracks
   separately (990-PF recipient patterns don't transfer to SBIR award
   patterns; `grant_statistical_models` rows are scoped by `funder_id`, not
   pooled across tracks — schema already reflects this).

## Open questions for Stewart

- Is the business track meant to become a **second product surface**
  (something a small-business user outside Groundwork could run), or does it
  stay internal tooling scoped to Stewart's own companies (Groundwork /
  Barteau IP Group)? This changes whether Module 1's business-track ingest
  needs a general "any small business" fit-index or can stay hardcoded to
  the two companies' actual profiles.
- Contingency pricing (spec §XI, "1–3% of award if successful") makes sense
  against a grant award. Does it make sense against non-dilutive compute
  credits, which aren't cash? May need a flat/subscription price for that
  sub-category instead.
- Should `grant_necaif_evaluations` run against corporate foundations that
  fund *both* tracks' edge cases (Mozilla, McGovern) before Module 1 ingest
  goes live, given `grant-strategy-map.md` already lists them as open
  opportunities with near-term deadlines?

_Filed while mapping the suite onto elle-worker's actual D1/Cloudflare stack.
Come back to this before starting Module 1 ingest._
