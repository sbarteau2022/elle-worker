#!/usr/bin/env node
// Regenerate a brief batch's posted-text embedding cache.
//
//   node research/seam-wire/embed-briefs.mjs research/seam-wire/briefs/gemini-batch-16.jsonl
//
// These caches are NOT in git — 31-37 MB each, and reproducible in ~35 s from the resident model.
// The posted text is exactly what the coordinator saw on the board (routing-diagnose.cjs:44):
//   `${title}\n${brief.trim()}\n\nSelf-check before you finish: ${verify.trim()}`
// The reduction is RAW concatenation of the seven layer taps, matching local-embed.cjs reduceLayers
// — it does NOT normalise per tap. Normalising per tap yields vectors that are silently
// incomparable to every cached batch; verify any change here by re-embedding a cached brief and
// requiring cosine 1.000000 against its stored vector.
import fs from 'node:fs';

const URL   = process.env.ELLE_OLLAMA_URL || 'http://127.0.0.1:11437';
const MODEL = process.env.ELLE_EMBED_LAYER_MODEL || 'qwen3.8:27b';
const file  = process.argv[2];
if (!file) { console.error('usage: embed-briefs.mjs <batch.jsonl>'); process.exit(1); }

const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const out = {};
const t0 = Date.now();

for (const [i, r] of rows.entries()) {
  const text = `${r.title}\n${r.brief.trim()}\n\nSelf-check before you finish: ${(r.verify || '').trim()}`;
  const res = await fetch(`${URL}/api/embed/layers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: [text] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${URL} — is mlx-serve up? (upstream:"" is normal)`);
  const d = await res.json();
  out[r.title] = d.embeddings[0].flat();          // RAW concatenation, 7 x 5120 = 35840
  if ((i + 1) % 24 === 0 || i + 1 === rows.length) {
    process.stderr.write(`  ${i + 1}/${rows.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
}

const dest = `${file}.posted.emb.json`;
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`${dest}: ${Object.keys(out).length} vectors, dim ${Object.values(out)[0].length}`);
