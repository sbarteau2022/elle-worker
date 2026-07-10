# Kernel HTTP door — `/mem/*`

A thin HTTP surface over the memory kernel (`src/memory.ts`) so an external
harness (the benchmark package, an eval, another service) can drive
write → recall → assemble without the conversational router or a user login.

## Routes (all `POST`)

| Route | Body | Returns |
|---|---|---|
| `/mem/write` | `{ content, metadata?, compress_invariants?, type?, importance?, tags?, session_id? }` | `{ ok: true, id }` |
| `/mem/recall` | `{ query, top_k? }` | `{ results: [{ id, content, text, summary, score, via, memory_type, created_at }], count }` |
| `/mem/assemble` | `{ query, budget? }` | `{ context, budget }` |

`content` may also be sent as `text`; `query` as `q`; `top_k` as `k`. Each
recall result carries both `content` and `text` (aliases) so either client
convention works.

## Auth — "just the JWT_SECRET"

Sign a JWT with the worker's `JWT_SECRET` (HS256) and send it as
`Authorization: Bearer <token>`. The worker verifies the signature (+ `exp`)
but skips the session-revocation check that user logins require — possession of
`JWT_SECRET` is the authorization. The break-glass service key also opens the
door. See `real_kernel_client.py` for a zero-dependency signer.

```bash
export JWT_SECRET="<same value the worker has>"
export ELLE_KERNEL_URL="http://localhost:8787"   # optional, this is the default
python real_kernel_client.py                       # write + recall smoke test
```

## Running the worker for the benchmark

```bash
# from the elle-worker repo root
npx wrangler dev          # serves on http://localhost:8787
```

`wrangler dev` proxies Workers AI (bge embeddings) and Vectorize to the real
services when you're logged in, so semantic recall works. If you run fully
local (`--local`) and the `elle_memory` table isn't present, apply migrations
first, or recall falls back to the importance-scan backstop (writes still
succeed to D1; recall just won't be semantic). A `401` from `/mem/*` means the
signing secret doesn't match the worker's `JWT_SECRET`; a `connection refused`
means `wrangler dev` isn't running.
