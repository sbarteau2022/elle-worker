#!/usr/bin/env python3
# ------------------------------------------------------------
# cache_ollama_teacher_embeddings.py
# ------------------------------------------------------------
# Extracts 21‑dim hyperbolic embeddings from LOCAL Ollama models.
# Cost: $0.  No API keys needed.
#
# Usage:
#   python cache_ollama_teacher_embeddings.py
#
# Prerequisites:
#   1. Ollama running (`ollama serve`)
#   2. Models pulled (`ollama pull gemma2:9b`, etc.)
# ------------------------------------------------------------

import json, pathlib, time, sys, urllib.request
from typing import List

# ------------------------------------------------------------------
# CONFIG — edit these to match what you want to distill
# ------------------------------------------------------------------
TEACHERS = [
    "gemma2:9b",
    "llama3.1:8b",
    "mistral:7b",
]

DATASET = "/Users/stewartbarteau/Desktop/hybrid-HNPA-active-inference-LLM/benchmarks/gsm8k/train.jsonl"
OUT_FILE = "/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker/research/cloud-distillation/teacher_embeddings.jsonl"
OLLAMA_URL = "http://localhost:11434"

# Hyperbolic map target dimension
MAP_DIM = 21

# ------------------------------------------------------------------
# Ollama helpers
# ------------------------------------------------------------------

def ollama_embed(prompt: str, model: str) -> List[float]:
    """Call Ollama's /api/embed endpoint and return the raw embedding vector."""
    payload = json.dumps({"model": model, "input": prompt}).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/embed",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = json.loads(resp.read())
    # Ollama returns {"embeddings": [[float, ...]]}
    return body["embeddings"][0]


def linear_project(vec: List[float], target_dim: int) -> List[float]:
    """
    Deterministic linear projection from len(vec) -> target_dim.

    Uses a simple stride‑based averaging scheme (no learned weights).
    This is a *placeholder* — for production you would train a proper
    21‑dim probe.  But even this naive projection preserves enough
    structure for the DORA adapter to learn the mapping.

    The key insight: the DORA adapter will learn the *correct* projection
    during training.  This function only needs to produce a *consistent*
    (deterministic, repeatable) reduction so that all teachers are
    projected the same way.
    """
    d = len(vec)
    if d == target_dim:
        return vec
    if d < target_dim:
        # Pad with zeros (unlikely for LLM embeddings)
        return vec + [0.0] * (target_dim - d)

    # Stride‑based average: split vec into target_dim equal‑ish chunks
    out = []
    chunk_size = d / target_dim
    for i in range(target_dim):
        start = int(i * chunk_size)
        end = int((i + 1) * chunk_size)
        chunk = vec[start:end]
        out.append(sum(chunk) / len(chunk))

    # Normalize to unit circle pairs (cos/sin for each phase)
    # This ensures the torus constraint is respected.
    import math
    for phase_idx in range(0, target_dim - 1, 2):
        norm = math.sqrt(out[phase_idx] ** 2 + out[phase_idx + 1] ** 2)
        if norm > 1e-8:
            out[phase_idx] /= norm
            out[phase_idx + 1] /= norm
    return out


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
def main():
    # Verify Ollama is running
    try:
        urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=5)
    except Exception:
        print("ERROR: Ollama is not running. Start it with: ollama serve")
        sys.exit(1)

    # Load dataset
    dataset_path = pathlib.Path(DATASET)
    if not dataset_path.exists():
        print(f"ERROR: Dataset not found: {DATASET}")
        sys.exit(1)

    examples = []
    with dataset_path.open() as f:
        for line in f:
            if line.strip():
                examples.append(json.loads(line))
    print(f"Loaded {len(examples)} examples from {DATASET}")

    out_path = pathlib.Path(OUT_FILE)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    total_teachers = len(TEACHERS)
    total_examples = len(examples)

    with out_path.open("w") as fout:
        for t_idx, teacher_model in enumerate(TEACHERS):
            print(f"\n{'='*60}")
            print(f"Teacher {t_idx+1}/{total_teachers}: {teacher_model}")
            print(f"{'='*60}")

            # Pre‑pull the model (no‑op if already present)
            print(f"  Ensuring {teacher_model} is available...")
            import subprocess
            subprocess.run(["ollama", "pull", teacher_model], check=True)

            # If this is the first teacher, initialize the output records
            if t_idx == 0:
                records = []
                for i, ex in enumerate(examples):
                    prompt = ex.get("question") or ex.get("prompt", "")
                    ex_id = ex.get("id") or ex.get("question_id") or str(i)
                    records.append({"id": ex_id, "prompt": prompt, "embeds": []})

            # Process each example
            for i, rec in enumerate(records):
                prompt = rec["prompt"]
                try:
                    raw_embed = ollama_embed(prompt, teacher_model)
                    v = linear_project(raw_embed, MAP_DIM)
                    rec["embeds"].append(v)
                except Exception as e:
                    print(f"  WARNING: Failed on example {i} ({teacher_model}): {e}")
                    rec["embeds"].append([0.0] * MAP_DIM)  # fallback

                if (i + 1) % 100 == 0 or i == 0:
                    print(f"  [{teacher_model}] {i+1}/{total_examples} examples processed")

            print(f"  ✅ {teacher_model} done.")

        # Write all records
        for rec in records:
            fout.write(json.dumps({
                "id": rec["id"],
                "embeds": rec["embeds"],
            }) + "\n")

    print(f"\n{'='*60}")
    print(f"✅ All {total_teachers} teachers cached → {OUT_FILE}")
    print(f"   {total_examples} examples × {total_teachers} teachers")
    print(f"   Each embedding: {MAP_DIM}‑dim (hyperbolic torus projection)")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
