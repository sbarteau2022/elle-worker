#!/usr/bin/env python3
"""
extract_gemini_tensors.py
─────────────────────────
Runs the full GSM8K train set through the Gemini API using your
$300 free Google Cloud credits.  Extracts embeddings from multiple
Gemini models and caches them as 21-dim hyperbolic torus vectors.

Uses raw HTTP + gcloud access token.  No pip install needed.

Estimated cost: < $1 total for all models × all examples.
"""

import json, os, sys, time, pathlib, subprocess, math, urllib.request, urllib.error

# ── CONFIG ────────────────────────────────────────────────────────
DATASET   = "/Users/stewartbarteau/Desktop/hybrid-HNPA-active-inference-LLM/benchmarks/gsm8k/train.jsonl"
OUT_DIR   = "/Users/stewartbarteau/Desktop/elle-worker/research/cloud-distillation"
MAP_DIM   = 21   # hyperbolic torus target dimension

# Models to use as teachers (all free-tier eligible on Gemini API)
TEACHERS = [
    {"name": "gemini-flash",   "model": "models/gemini-2.0-flash"},
    {"name": "gemini-pro",     "model": "models/gemini-1.5-pro"},
    {"name": "gemini-flash15", "model": "models/gemini-1.5-flash"},
]

MAX_RPS = 4      # requests per second (stay under quota)
PROJECT = "gen-lang-client-0528829889"
# ── END CONFIG ────────────────────────────────────────────────────


def get_access_token():
    """Get a fresh gcloud access token."""
    result = subprocess.run(
        ["gcloud", "auth", "application-default", "print-access-token"],
        capture_output=True, text=True
    )
    token = result.stdout.strip()
    if not token or token.startswith("ERROR"):
        print("ERROR: Could not get access token. Run: gcloud auth application-default login")
        sys.exit(1)
    return token


def gemini_embed(prompt: str, model: str, token: str) -> list:
    """
    Call Gemini embedContent endpoint.
    Returns a list of floats (the raw embedding vector).
    """
    url = f"https://generativelanguage.googleapis.com/v1/{model}:embedContent"
    payload = json.dumps({
        "content": {"parts": [{"text": prompt}]}
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read())
            return body["embedding"]["values"]
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 2 ** attempt * 5
                print(f"    Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            elif e.code == 401:
                # Token may have expired, refresh
                token = get_access_token()
                req.remove_header("Authorization")
                req.add_header("Authorization", f"Bearer {token}")
                continue
            else:
                err_body = e.read().decode() if hasattr(e, 'read') else str(e)
                print(f"    HTTP {e.code}: {err_body[:200]}")
                raise
        except Exception as e:
            if attempt < 2:
                time.sleep(2)
                continue
            raise
    return []


def gemini_generate_with_logprobs(prompt: str, model: str, token: str, max_tokens: int = 96) -> dict:
    """
    Call Gemini generateContent with responseLogprobs enabled.
    Returns the completion text + per-token log-probabilities.
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/{model}:generateContent"
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "responseLogprobs": True,
            "topLogprobs": 1,
        }
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read())
            candidate = body.get("candidates", [{}])[0]
            content = candidate.get("content", {})
            text = ""
            for part in content.get("parts", []):
                text += part.get("text", "")

            # Extract log-probs if available
            logprobs = []
            lp_result = candidate.get("logprobsResult", {})
            for tok_entry in lp_result.get("chosenCandidates", []):
                logprobs.append(tok_entry.get("logProbability", 0.0))

            return {"text": text, "logprobs": logprobs}
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 2 ** attempt * 5
                print(f"    Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            elif e.code == 401:
                token = get_access_token()
                req.remove_header("Authorization")
                req.add_header("Authorization", f"Bearer {token}")
                continue
            else:
                err_body = e.read().decode() if hasattr(e, 'read') else str(e)
                print(f"    HTTP {e.code}: {err_body[:200]}")
                if attempt < 2:
                    time.sleep(2)
                    continue
                raise
        except Exception as e:
            if attempt < 2:
                time.sleep(2)
                continue
            raise
    return {"text": "", "logprobs": []}


def project_to_torus(vec: list, target_dim: int = 21) -> list:
    """
    Project a high-dim embedding vector onto the 21-dim hyperbolic torus.
    Uses stride-based averaging + cos/sin normalization to enforce
    the torus constraint.
    """
    d = len(vec)
    if d <= target_dim:
        out = vec + [0.0] * (target_dim - d)
    else:
        out = []
        chunk_size = d / target_dim
        for i in range(target_dim):
            start = int(i * chunk_size)
            end = int((i + 1) * chunk_size)
            chunk = vec[start:end]
            out.append(sum(chunk) / max(len(chunk), 1))

    # Enforce cos/sin unit-circle pairs (torus phases)
    for phase_idx in range(0, target_dim - 1, 2):
        norm = math.sqrt(out[phase_idx] ** 2 + out[phase_idx + 1] ** 2)
        if norm > 1e-8:
            out[phase_idx] /= norm
            out[phase_idx + 1] /= norm
    return out


def logprobs_to_torus(logprobs: list, target_dim: int = 21) -> list:
    """
    Convert a per-token log-probability sequence into a 21-dim
    torus vector.  Uses the surprisal (negative log-prob) as
    phase angles.
    """
    if not logprobs:
        return [0.0] * target_dim

    # Pad or truncate to at least target_dim values
    surprisals = [-lp for lp in logprobs]
    while len(surprisals) < target_dim:
        surprisals.append(0.0)

    # Take the first target_dim surprisals, convert to phase angles
    out = []
    for i in range(0, target_dim - 1, 2):
        angle = surprisals[i] if i < len(surprisals) else 0.0
        out.append(math.cos(angle))
        out.append(math.sin(angle))
    if len(out) < target_dim:
        out.append(surprisals[-1] if surprisals else 0.0)
    return out[:target_dim]


# ── MAIN ──────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("Gemini Teacher Tensor Extraction")
    print(f"Dataset: {DATASET}")
    print(f"Teachers: {[t['name'] for t in TEACHERS]}")
    print(f"Output: {OUT_DIR}/")
    print("=" * 60)

    # Load dataset
    examples = []
    with open(DATASET) as f:
        for line in f:
            if line.strip():
                examples.append(json.loads(line))
    print(f"\nLoaded {len(examples)} examples")

    token = get_access_token()
    out_dir = pathlib.Path(OUT_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    sleep_interval = 1.0 / MAX_RPS
    all_records = []

    # ── Phase 1: Embeddings from each teacher ─────────────────────
    for t_idx, teacher in enumerate(TEACHERS):
        model = teacher["model"]
        name = teacher["name"]
        embed_model = model  # For embedding, use the same model ID

        # Check if this model supports embedContent; if not, skip to logprobs
        print(f"\n{'─' * 60}")
        print(f"Teacher {t_idx+1}/{len(TEACHERS)}: {name} ({model})")
        print(f"{'─' * 60}")

        cache_file = out_dir / f"teacher_{name}_embeddings.jsonl"
        if cache_file.exists():
            print(f"  ⏭  Cache exists: {cache_file} — skipping")
            continue

        records = []
        errors = 0

        with cache_file.open("w") as fout:
            for i, ex in enumerate(examples):
                prompt = ex.get("question") or ex.get("prompt", "")
                ex_id = ex.get("id") or ex.get("question_id") or str(i)

                try:
                    # Try embedding first
                    raw = gemini_embed(prompt, embed_model, token)
                    v = project_to_torus(raw, MAP_DIM)
                    method = "embed"
                except Exception as e:
                    # Fall back to generateContent with logprobs
                    try:
                        result = gemini_generate_with_logprobs(prompt, model, token)
                        v = logprobs_to_torus(result["logprobs"], MAP_DIM)
                        method = "logprobs"
                    except Exception as e2:
                        v = [0.0] * MAP_DIM
                        method = "fallback"
                        errors += 1

                record = {"id": ex_id, "teacher": name, "v": v, "method": method}
                fout.write(json.dumps(record) + "\n")
                records.append(record)

                if (i + 1) % 100 == 0 or i == 0:
                    print(f"  [{name}] {i+1}/{len(examples)} done (errors: {errors})")

                time.sleep(sleep_interval)

                # Refresh token every 1000 requests
                if (i + 1) % 1000 == 0:
                    token = get_access_token()

        print(f"  ✅ {name}: {len(records)} cached → {cache_file}")
        print(f"     Errors: {errors}")

    # ── Phase 2: Merge into unified teacher_embeddings.jsonl ──────
    print(f"\n{'=' * 60}")
    print("Merging teacher caches...")

    # Load all per-teacher caches
    teacher_data = {}  # name → {id → v}
    for teacher in TEACHERS:
        name = teacher["name"]
        cache_file = out_dir / f"teacher_{name}_embeddings.jsonl"
        if not cache_file.exists():
            print(f"  WARNING: {cache_file} missing, skipping")
            continue
        teacher_data[name] = {}
        with cache_file.open() as f:
            for line in f:
                rec = json.loads(line)
                teacher_data[name][rec["id"]] = rec["v"]

    # Write merged file
    merged_file = out_dir / "teacher_embeddings.jsonl"
    with merged_file.open("w") as fout:
        for i, ex in enumerate(examples):
            ex_id = ex.get("id") or ex.get("question_id") or str(i)
            embeds = []
            for teacher in TEACHERS:
                name = teacher["name"]
                if name in teacher_data and ex_id in teacher_data[name]:
                    embeds.append(teacher_data[name][ex_id])
                else:
                    embeds.append([0.0] * MAP_DIM)
            fout.write(json.dumps({"id": ex_id, "embeds": embeds}) + "\n")

    print(f"✅ Merged → {merged_file}")
    print(f"   {len(examples)} examples × {len(TEACHERS)} teachers")
    print(f"   Each embedding: {MAP_DIM}-dim (hyperbolic torus)")
    print(f"\n{'=' * 60}")
    print("DONE.  Ready for DORA training.")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
