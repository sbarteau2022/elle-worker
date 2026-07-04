# War Room / Duelist — build note (PAUSED, awaiting Elle.law scope)

**Status:** Not started. Deliberately paused. Resume when this session (or the
next) is granted GitHub scope for the **Elle.law** repo — there is a fresh
deep-dive design there that must be read first, and it is the source of truth
for the duel flow, the Autopsy rubric, and the Tutor escalation.

**Do NOT build the duel flow against assumptions.** Read the Elle.law repo's
design docs first, then reconcile with what already exists here.

---

## What already exists (shipped, live)

- **Screwtape register** (`src/mind.ts`, id `screwtape`) — the adversarial
  challenger voice. Declared sparring frame: deploys tactics, leaves them
  recognizable, attacks the argument not the person, always debriefs. This is
  the Duelist's *voice*.
- **The tactical doctrine, in the corpus** (ingested via the `seed_corpus` job):
  - `corpus/law/48-laws-taxonomy.md` — each law → tactical category, fallacy
    analog, deployment context, counter-tactic, **`ethical_valence` (+/0/−)**.
  - `corpus/law/art-of-war-tagging.md` — tagged Sun Tzu passages, cross-mapped
    to the 48 Laws.
  Retrievable by `search_corpus` / `read_sql` today.
- The docs specify the safeguard: `ethical_valence` tagging is the guard against
  the sophist failure mode; the Tutor never teaches negative-valence tactics as
  end-states; the Autopsy scores whether the user recognized the valence of what
  was deployed against them.

## What to build (the structured mode, on top of the register)

A structured duel is more than the Screwtape register talking. Sketch (to be
reconciled with the Elle.law deep-dive):

1. **Duelist** — picks a specific law/passage by `tactical_category` from the
   ingested doctrine, deploys it in a turn, tracks which tactic is live.
2. **Autopsy** — after the exchange, scores whether the user (a) named the
   tactic and (b) recognized its ethical valence; records a defense history.
3. **Tutor** — escalates difficulty based on the user's recognition rate; never
   teaches −valence tactics as end-states.
4. **Surface** — likely `POST /api/elle-law-duel` (a scoped variant of the
   router loop, `screwtape` register, tools limited to `search_corpus` +
   `read_sql` over the doctrine + a duel-state store), plus a workbench tab.
5. **State** — a `law_duels` / `law_defense_log` table (or reuse the existing
   `law_*` tables the worker already references in `router.ts` TABLE_CATALOG —
   `duels`, `duel_turns`, `doctrine_mastery` are already named there; verify
   against the Elle.law schema before creating anything).

## Sequencing (explicit requirement from Stewart)

1. Get Elle.law repo into scope; read the deep-dive design.
2. Build the duel flow and **test it end-to-end in the dev workbench first**
   (a new "War Room" tab in the `Elle` repo, pointed at `elle-worker`).
3. Only after it works in the workbench do we **point it at Elle.law** (wire the
   Elle.law front end / consumer surface to the duel endpoint).

## Open questions to resolve from the Elle.law deep-dive

- Does Elle.law already define the Duelist / Tutor / Autopsy schema? Reuse it.
- Where does duel state live — main D1 (`duels`/`duel_turns`) or an Elle.law DB?
- Is the taxonomy meant to seed an `elle_law_doctrine` table (structured rows)
  in addition to the prose corpus copy already ingested?
- What is the Autopsy scoring rubric, exactly?

_Filed after shipping the Screwtape register + seeding the War Room doctrine.
Come back to this._
