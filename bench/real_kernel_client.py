"""
real_kernel_client.py — HTTP client for the Elle memory kernel.

Talks to the /mem/write, /mem/recall (and /mem/assemble) routes exposed by
elle-worker (src/index.ts). Authentication is a JWT the client SIGNS ITSELF
with JWT_SECRET — the same shared secret the worker signs sessions with. No
login, no PyJWT dependency (HS256 is done here with hmac/hashlib), so the only
thing the harness needs is the same JWT_SECRET the worker has.

Drop this into the benchmark package and construct RealKernelClient(); the
OurKernelAdapter it already uses calls .mem_write / .mem_recall /
.assemble_context, all implemented below with matching signatures.

    export JWT_SECRET="<same value as the worker's JWT_SECRET>"
    export ELLE_KERNEL_URL="http://localhost:8787"   # optional; this is default
"""

import os
import json
import time
import hmac
import base64
import hashlib
from typing import List, Dict, Optional

import requests


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _sign_jwt(secret: str, ttl_seconds: int = 3600) -> str:
    """HS256 JWT, base64url without padding — byte-for-byte compatible with the
    worker's signJWT / verifyJWT (src/index.ts)."""
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {"scope": "kernel", "iat": now, "exp": now + ttl_seconds}
    segments = [
        _b64url(json.dumps(header, separators=(",", ":")).encode()),
        _b64url(json.dumps(payload, separators=(",", ":")).encode()),
    ]
    signing_input = ".".join(segments).encode("ascii")
    sig = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    segments.append(_b64url(sig))
    return ".".join(segments)


class RealKernelClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        jwt_secret: Optional[str] = None,
        timeout: float = 30.0,
    ):
        self.base_url = (base_url or os.environ.get("ELLE_KERNEL_URL", "http://localhost:8787")).rstrip("/")
        self.jwt_secret = jwt_secret or os.environ.get("JWT_SECRET")
        if not self.jwt_secret:
            raise RuntimeError("JWT_SECRET not set — export the same secret the worker uses")
        self.timeout = timeout

    # ── auth ──────────────────────────────────────────────────────────────
    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {_sign_jwt(self.jwt_secret)}",
            "Content-Type": "application/json",
        }

    def _post(self, path: str, payload: Dict) -> Dict:
        r = requests.post(
            f"{self.base_url}{path}",
            headers=self._headers(),
            json=payload,
            timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    # ── kernel surface ────────────────────────────────────────────────────
    def mem_write(
        self,
        content: str,
        metadata: Optional[Dict] = None,
        compress_invariants: bool = True,
    ) -> Dict:
        return self._post(
            "/mem/write",
            {
                "content": content,
                "metadata": metadata or {},
                "compress_invariants": bool(compress_invariants),
            },
        )

    def mem_recall(self, query: str, top_k: int = 10) -> List[Dict]:
        resp = self._post("/mem/recall", {"query": query, "top_k": int(top_k)})
        # Server returns {"results": [...]}. Be tolerant if a bare list is ever
        # returned instead.
        if isinstance(resp, dict):
            return resp.get("results", [])
        return resp or []

    def assemble_context(self, recalled: List[Dict], budget: Optional[int] = None) -> str:
        """Client-side assembly over an already-recalled list (matches the
        adapter's call: it passes the recalled items, not a query). Concatenates
        each item's text up to the char budget."""
        budget = budget or 1600
        out, used = [], 0
        for m in recalled:
            text = (m.get("content") or m.get("text") or m.get("summary") or "").strip()
            if not text:
                continue
            if used + len(text) > budget:
                text = text[: max(0, budget - used)]
            out.append(text)
            used += len(text)
            if used >= budget:
                break
        return "\n---\n".join(out)


if __name__ == "__main__":
    # Smoke test: write two memories, recall one.
    k = RealKernelClient()
    print("write:", k.mem_write("The espresso machine at the Tin Mill is a La Marzocco.", {"session_id": "smoke", "role": "user"}))
    print("write:", k.mem_write("Stewart prefers the cortado in the morning.", {"session_id": "smoke", "role": "user"}))
    hits = k.mem_recall("what coffee does Stewart like", top_k=5)
    print(f"recall: {len(hits)} hits")
    for h in hits:
        print("  -", round(h.get("score", 0), 3), (h.get("content") or "")[:80])
    print("assembled:\n", k.assemble_context(hits, budget=400))
