#!/usr/bin/env python
# ------------------------------------------------------------
# cache_cloud_teacher_embeddings.py
# ------------------------------------------------------------
# Pulls 21‑dim hyperbolic embeddings from a set of cloud‑hosted
# LLM teachers (OpenAI, Google Gemini, Anthropic, etc.) and writes a
# JSON‑L cache that can be consumed by the DORA training script.
# ------------------------------------------------------------

import os, json, time, pathlib, tqdm, yaml, base64
from typing import List, Dict

# ------------------------------------------------------------------
# Helper: a tiny 21‑dim linear probe (teacher‑specific).  In practice
# you would train this probe on a small validation set (e.g. 200 GSM8K
# examples) and freeze the weights.  Here we ship a placeholder that
# simply applies a random linear map – the user must replace it with
# a trained checkpoint (see the README).
# ------------------------------------------------------------------
import torch

def load_probe(probe_path: str) -> torch.nn.Linear:
    """Load a saved 21‑dim linear head.
    Expected file format: a torch state dict with a single weight matrix
    of shape (21, hidden_dim) and optional bias.  For cloud providers that
    already return a vector (e.g. OpenAI embeddings), the probe can be an
    identity (i.e. a linear layer with weight = eye and bias = 0).
    """
    if not os.path.exists(probe_path):
        raise FileNotFoundError(f"Probe file not found: {probe_path}")
    state = torch.load(probe_path, map_location="cpu")
    weight = state["weight"]
    bias = state.get("bias")
    layer = torch.nn.Linear(weight.shape[1], weight.shape[0], bias is not None)
    layer.weight.data.copy_(weight)
    if bias is not None:
        layer.bias.data.copy_(bias)
    layer.eval()
    return layer

# ------------------------------------------------------------------
# Provider wrappers – each returns a vector of shape (hidden_dim,).
# We keep the implementations minimal; users should install the
# corresponding SDKs (openai, google‑generativeai, anthropic) and set the
# appropriate environment variables as described in CLOUD_CONFIG.yaml.
# ------------------------------------------------------------------

def openai_embedding(prompt: str, model: str, api_key: str) -> List[float]:
    import openai
    openai.api_key = api_key
    resp = openai.Embedding.create(model=model, input=prompt)
    return resp["data"][0]["embedding"]

def gemini_embedding(prompt: str, model: str, api_key: str) -> List[float]:
    import google.generativeai as genai
    genai.configure(api_key=api_key)
    model_obj = genai.GenerativeModel(model_name=model)
    embed = model_obj.embed_content(content=prompt)
    return embed.values

def anthropic_embedding(prompt: str, model: str, api_key: str) -> List[float]:
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    resp = client.embeddings.create(model=model, input=prompt)
    return resp.embedding

PROVIDERS = {
    "openai": openai_embedding,
    "gemini": gemini_embedding,
    "anthropic": anthropic_embedding,
}

# ------------------------------------------------------------------
# Main routine
# ------------------------------------------------------------------
def main():
    cfg_path = pathlib.Path(__file__).parent / "CLOUD_CONFIG.yaml"
    if not cfg_path.exists():
        raise FileNotFoundError("CLOUD_CONFIG.yaml not found – create it according to the template in the README.")
    cfg = yaml.safe_load(cfg_path.read_text())

    dataset_path = cfg["dataset"]
    out_path = pathlib.Path(cfg["output"])
    out_path.parent.mkdir(parents=True, exist_ok=True)

    probes: Dict[str, torch.nn.Linear] = {}
    for teacher in cfg["teachers"]:
        if teacher.get("probe_path"):
            probes[teacher["name"]] = load_probe(teacher["probe_path"])
        else:
            probes[teacher["name"]] = None

    sleep_interval = 1.0 / cfg.get("max_rps", 1.0)

    with out_path.open("w") as fout:
        for line in tqdm.tqdm(open(dataset_path)):
            obj = json.loads(line)
            prompt = obj.get("question") or obj.get("prompt", "")
            ex_id = obj.get("id") or obj.get("question_id") or str(hash(prompt))
            teacher_vectors = []
            for teacher in cfg["teachers"]:
                name = teacher["name"]
                provider = teacher["provider"]
                model_id = teacher["model_id"]
                api_key = os.getenv(teacher["api_key_env"]) or teacher.get("api_key")
                embed = PROVIDERS[provider](prompt, model_id, api_key)
                embed_tensor = torch.tensor(embed, dtype=torch.float32).unsqueeze(0)
                probe = probes[name]
                if probe is not None:
                    v = probe(embed_tensor).squeeze(0).tolist()
                else:
                    if embed_tensor.shape[1] != 21:
                        raise ValueError(f"Provider {provider} returned {embed_tensor.shape[1]} dims – a 21‑dim probe is required.")
                    v = embed_tensor.squeeze(0).tolist()
                teacher_vectors.append(v)
                time.sleep(sleep_interval)
            fout.write(json.dumps({"id": ex_id, "embeds": teacher_vectors}) + "\n")

if __name__ == "__main__":
    main()
