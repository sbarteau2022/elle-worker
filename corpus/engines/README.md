# Engine specs — corpus/engines/

The Observer Foundation's "Nine Engines" architecture, one spec per file, ingested as
retrievable corpus so Elle cites the axes / tiers / schemas exactly instead of reconstructing
them. This is the template for the incoming engines.

## Adding the next engine (the pattern)

1. Extract the spec `.docx` to markdown: strip tags, unescape entities, collapse blank runs
   (same one-liner used for the others).
2. Name it `corpus/engines/NN-slug.md` (NN = the engine number from the Big Picture table).
3. Prepend the H1 title, then the **Cloudflare-native stack mapping block** (copy it verbatim
   from any sibling file). The architecture stays verbatim — only the storage/deploy layer is
   remapped. Never leave a raw Supabase/Vercel/Railway instruction as the operative stack.
4. Add a `CORPUS_SEEDS` entry in `src/corpus-seed.ts`: import the `.md` as a Text module,
   `series: 'business'`, `tag: 'engine-spec'`, a one-paragraph abstract naming the engine's
   axes/tiers so semantic search finds it.
5. `tsc --noEmit`, `vitest run`, PR. After merge+deploy run the `seed_corpus` cron once
   (idempotent — only the new file ingests).

## The nine engines

| # | Engine | File | Status in spec |
|---|--------|------|----------------|
| 1 | Observer | _(incoming — the corpus itself)_ | running |
| 2 | Millennium Falcon | `02-millennium-falcon.md` | operational · 16-axis |
| 3 | Grant Intelligence | `03-grant-intelligence.md` | building |
| 4 | Education Intelligence | `04-education-intelligence.md` | architecture decided |
| 5 | Hospitality (Groundwork) | `05-hospitality-groundwork.md` | v0.4 live |
| 6 | Mental Health (Harmonizer) | `06-harmonizer-mental-health.md` | v3 live |
| 7 | IP Intelligence | `07-ip-intelligence.md` | architecture decided |
| 8 | Plenum | `08-plenum.md` | v2 architecture |
| 9 | Convergence | `09-convergence.md` | named, built at month 12 |

A runnable Plenum reference implementation (`PlenumEngine.jsx`, browser artifact calling
the Anthropic API directly) exists but is **not** ingested — when built for real it routes
through the Worker, not the browser. Kept as a build reference, not corpus doctrine.

The Cloudflare-native stack every engine targets: **D1** (`elle-corpus`) for schemas ·
**Vectorize** for indexes · **KV** for session/field state · **R2** for blobs · **Workers**
for API + cron (`/api/cron`) · **Pages/static assets** for frontends · **Workers AI** for
embeddings · **Queues** for ingest. Anthropic API for intelligence, sovereign Qwen when ready.
