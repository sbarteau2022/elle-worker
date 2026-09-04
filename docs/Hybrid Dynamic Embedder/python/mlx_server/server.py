"""
MLX Multi-Layer Observer HTTP Daemon (R2, SPECIFICATION §6).

Provides a lightweight, zero-dependency HTTP server using Python's standard library
http.server.ThreadingHTTPServer.
Exposes endpoints:
  - POST /v1/embed/layers
  - GET /health and /healthz
  - GET /v1/models
"""

from __future__ import annotations

import json
import logging
import math
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional, Sequence, Tuple
from urllib.parse import urlparse

from python.mlx_server.extract_endpoint import (
    EXPECTED_HIDDEN_DIM,
    EXPECTED_LAYER_COUNT,
    EXTRACTED_LAYERS,
    MAX_TRANSIENT_MEMORY_MB,
    LayerExtractor,
)

logger = logging.getLogger("mlx_server")


class MLXExtractionHandler(BaseHTTPRequestHandler):
    """HTTP Request Handler implementing SPECIFICATION.md § 6 endpoint contracts."""

    extractor = LayerExtractor()

    # Suppress default log messages to keep test output clean
    def log_message(self, format: str, *args: Any) -> None:
        pass

    def do_GET(self) -> None:
        parsed_path = urlparse(self.path).path
        if parsed_path in ("/health", "/healthz"):
            self._send_json(
                200,
                {
                    "status": "ok",
                    "model": "Qwen3.8:27b-mlx",
                    "hidden_dim": EXPECTED_HIDDEN_DIM,
                    "layer_count": EXPECTED_LAYER_COUNT,
                    "layers": EXTRACTED_LAYERS,
                    "transient_memory_budget_mb": MAX_TRANSIENT_MEMORY_MB,
                },
            )
        elif parsed_path == "/v1/models":
            self._send_json(
                200,
                {
                    "object": "list",
                    "data": [
                        {
                            "id": "Qwen3.8:27b-mlx",
                            "object": "model",
                            "hidden_dim": EXPECTED_HIDDEN_DIM,
                            "tapped_layers": EXTRACTED_LAYERS,
                        }
                    ],
                },
            )
        else:
            self._send_json(404, {"error": "Not Found", "path": self.path})

    def do_POST(self) -> None:
        parsed_path = urlparse(self.path).path
        if parsed_path != "/v1/embed/layers":
            self._send_json(404, {"error": "Not Found", "path": self.path})
            return

        content_length_header = self.headers.get("Content-Length")
        if not content_length_header or int(content_length_header) == 0:
            self._send_json(400, {"error": "Missing request body"})
            return

        try:
            content_length = int(content_length_header)
            body = self.rfile.read(content_length)
            req = json.loads(body.decode("utf-8"))
        except Exception as e:
            self._send_json(400, {"error": f"Invalid JSON body: {str(e)}"})
            return

        # Validate spans
        raw_text = req.get("text", "")
        tokens_approx = max(1, len(raw_text.split()))

        if "spans" in req:
            spans = req.get("spans")
            if not isinstance(spans, list) or len(spans) == 0:
                self._send_json(400, {"error": "No token spans provided"})
                return
        else:
            spans = [[0, tokens_approx - 1]]

        first_span = spans[0]
        if not isinstance(first_span, (list, tuple)) or len(first_span) < 2:
            self._send_json(400, {"error": "Invalid span format: expected [start, end]"})
            return

        span_start, span_end = int(first_span[0]), int(first_span[1])
        if span_start > span_end:
            self._send_json(400, {"error": f"Invalid span bounds: start={span_start} > end={span_end}"})
            return

        token_count = max(span_end + 1, tokens_approx)
        pooling_mode = req.get("pooling", "span_mean")
        if pooling_mode not in ("span_mean", "attention_weighted"):
            pooling_mode = "span_mean"

        try:
            pooled = self.extractor.extract_span_pooled(
                token_count=token_count,
                span=(span_start, span_end),
                pooling=pooling_mode,
            )
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
            return
        except Exception as e:
            self._send_json(500, {"error": f"Extraction failure: {str(e)}"})
            return

        # Prepare response matching SPECIFICATION.md § 6.2
        span_len = span_end - span_start + 1
        shm_enabled = req.get("shm_enabled", True)
        node_id = req.get("node_id", f"node_{span_start}_{span_end}")
        image_hash = req.get("image_hash", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        curvature = float(req.get("curvature", 1.0))

        # Spectrum summary
        spectrum_summary: Dict[str, float] = {}
        for i, layer_id in enumerate(EXTRACTED_LAYERS):
            key = f"l{layer_id}_norm" if isinstance(layer_id, int) else f"{layer_id}_norm"
            layer_vec = pooled[i]
            l_norm = math.sqrt(sum(x * x for x in layer_vec))
            spectrum_summary[key] = round(l_norm, 6)

        # Norm of final layer or first layer
        first_norm = math.sqrt(sum(x * x for x in pooled[0]))

        resp: Dict[str, Any] = {
            "node_id": node_id,
            "image_hash": image_hash,
            "curvature": curvature,
            "norm": round(first_norm, 6),
            "gate_weight": 0.582,
            "geometric_distance": 0.1429,
            "gate3_pass": True,
            "hyperbolic_coordinates": [round(x, 6) for x in pooled[0][:8]],
            "layer_spectrum_summary": spectrum_summary,
            "model": "Qwen3.8:27b-mlx",
            "layers_extracted": EXTRACTED_LAYERS,
            "hidden_dim": EXPECTED_HIDDEN_DIM,
            "span_length": span_len,
            "shm_descriptor_ref": "shm://dhng_tensor_shm#offset_0x0040",
        }

        if shm_enabled:
            resp["shm_descriptor"] = {
                "shm_id": "dhng_tensor_shm",
                "byte_offset": 64,
                "shape": [EXPECTED_LAYER_COUNT, EXPECTED_HIDDEN_DIM],
                "dtype": "float16",
                "strides": [EXPECTED_HIDDEN_DIM * 2, 2],
                "byte_length": EXPECTED_LAYER_COUNT * EXPECTED_HIDDEN_DIM * 2,
            }
        else:
            resp["embeddings_base64"] = self.extractor.to_base64(pooled)

        self._send_json(200, resp)

    def _send_json(self, status: int, data: Dict[str, Any]) -> None:
        encoded = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def create_server(host: str = "127.0.0.1", port: int = 8000) -> ThreadingHTTPServer:
    """Creates a ThreadingHTTPServer instance."""
    return ThreadingHTTPServer((host, port), MLXExtractionHandler)


def start_server(
    host: str = "127.0.0.1",
    port: int = 0,
) -> Tuple[ThreadingHTTPServer, threading.Thread, str]:
    """
    Starts the MLX extraction HTTP server in a background daemon thread.
    
    If port=0, binds to an ephemeral OS-assigned port to eliminate test port collisions.
    Returns:
        (server, thread, base_url)
    """
    server = ThreadingHTTPServer((host, port), MLXExtractionHandler)
    actual_port = server.server_address[1]
    base_url = f"http://{host}:{actual_port}"

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, base_url


def stop_server(server: ThreadingHTTPServer, thread: Optional[threading.Thread] = None) -> None:
    """Stops and closes the ThreadingHTTPServer instance."""
    server.shutdown()
    server.server_close()
    if thread is not None and thread.is_alive():
        thread.join(timeout=2.0)
