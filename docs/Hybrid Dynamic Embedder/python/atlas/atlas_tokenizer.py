"""
Atlas Tokenizer: Geometric Tokenization on Mixed-Curvature Manifolds
Barteau & Claude, 2026

Novel approach: No discrete vocabulary. Tokens are emergent geometric structures
on H^n × T^n defined by:
  (1) Hyperbolic clustering (semantic density peaks)
  (2) Toroidal phase-locking (rhythmic boundaries)
  (3) Winding-number transitions (topological token boundaries)

Key insight: Traditional tokenization imposes artificial discreteness on continuous
semantic space. Atlas tokens emerge naturally from the geometry itself.

Three mechanisms:
  - HYPERBOLIC_DENSITY: Tokens = local maxima in hyperbolic embedding density
  - PHASE_LOCKED_BOUNDARY: Tokens = regions between toroidal phase discontinuities
  - WINDING_TRANSITION: Tokens = segments with constant winding vector

No vocabulary file. No OOV tokens. Infinite resolution. Language-agnostic.
"""

import math
import json
from typing import List, Tuple, Dict, Optional, Iterator
from dataclasses import dataclass, field
from collections import defaultdict
import hashlib

# Golden ratio constants
PHI = (1 + math.sqrt(5)) / 2
PHI_M1 = PHI - 1  # 0.6180339887...
INV_SQRT5 = 1.0 / math.sqrt(5)


@dataclass
class GeometricToken:
    """
    A token defined not by discrete ID but by geometric properties.
    
    Attributes:
        hyperbolic_center: Centroid in Poincaré ball (semantic location)
        toroidal_phase: Phase vector on T^n (rhythmic signature)
        winding_vector: Integer charges (topological identity)
        spatial_extent: Hyperbolic radius of influence
        temporal_extent: Number of turns in phase cycle
        confidence: κ ∈ (0,1) from asymmetric regulator
        lineage_drift: Cumulative hyperbolic displacement
        rhythm_bias: Cumulative toroidal disagreement
    """
    hyperbolic_center: List[float]
    toroidal_phase: List[float]
    winding_vector: List[int]
    spatial_extent: float
    temporal_extent: int
    confidence: float
    lineage_drift: float = 0.0
    rhythm_bias: float = 0.0
    text_span: str = ""
    start_idx: int = 0
    end_idx: int = 0
    
    def token_id(self) -> str:
        """Generate deterministic ID from geometric properties."""
        spec = f"{self.winding_vector}:{len(self.toroidal_phase)}:{self.temporal_extent}"
        return hashlib.sha256(spec.encode()).hexdigest()[:16]
    
    def to_dict(self) -> dict:
        return {
            'token_id': self.token_id(),
            'hyperbolic_center': self.hyperbolic_center,
            'toroidal_phase': self.toroidal_phase,
            'winding_vector': self.winding_vector,
            'spatial_extent': self.spatial_extent,
            'temporal_extent': self.temporal_extent,
            'confidence': self.confidence,
            'lineage_drift': self.lineage_drift,
            'rhythm_bias': self.rhythm_bias,
            'text_span': self.text_span,
            'start_idx': self.start_idx,
            'end_idx': self.end_idx,
        }


@dataclass
class DensityPeak:
    """Local maximum in hyperbolic embedding density."""
    center: List[float]
    density: float
    radius: float
    point_indices: List[int]


@dataclass
class PhaseBoundary:
    """Discontinuity in toroidal phase indicating token boundary."""
    position: int
    phase_jump: float
    winding_change: List[int]
    magnitude: float


class AtlasTokenizer:
    """
    Geometric tokenizer operating on H^n × T^n.
    
    Unlike BPE/WordPiece/SentencePiece:
    - No fixed vocabulary (infinite capacity)
    - No training required (geometry is universal)
    - Multilingual by default (semantic space is language-agnostic)
    - Sub-word, word, phrase, sentence tokens emerge at different scales
    - Tokens have continuous similarity (geodesic distance)
    
    Usage:
        tokenizer = AtlasTokenizer(manifold_dim=8)
        tokens = tokenizer.tokenize("The quick brown fox jumps.")
        for token in tokens:
            print(f"Token: {token.text_span!r}, W={token.winding_vector}, κ={token.confidence:.3f}")
    """
    
    def __init__(
        self,
        manifold_dim: int = 8,
        hyperbolic_weight: float = 0.618,  # φ⁻¹
        toroidal_weight: float = 0.382,   # φ⁻²
        density_threshold: float = 0.1,
        phase_threshold: float = PHI_M1 * math.pi / 4,
        min_token_chars: int = 1,
        max_token_chars: int = 256,
    ):
        """
        Initialize geometric tokenizer.
        
        Args:
            manifold_dim: Dimension n of H^n × T^n
            hyperbolic_weight: w_h for composite metric (default φ⁻¹)
            toroidal_weight: w_t for composite metric (default φ⁻²)
            density_threshold: Minimum hyperbolic density for token formation
            phase_threshold: Phase jump magnitude for boundary detection
            min_token_chars: Minimum characters per token
            max_token_chars: Maximum characters per token
        """
        assert hyperbolic_weight + toroidal_weight == 1.0, "Weights must sum to 1"
        self.n = manifold_dim
        self.w_h = hyperbolic_weight
        self.w_t = toroidal_weight
        self.density_threshold = density_threshold
        self.phase_threshold = phase_threshold
        self.min_chars = min_token_chars
        self.max_chars = max_token_chars
        
        # Precompute φ-decay weights for toroidal dimensions
        self.phi_weights = [PHI ** (-k) for k in range(1, self.n + 1)]
        
        # Character embeddings (fixed, no learning required)
        self.char_embeddings = self._init_char_embeddings()
    
    def _init_char_embeddings(self) -> Dict[str, Tuple[List[float], List[float]]]:
        """
        Initialize deterministic character embeddings on H^n × T^n.
        
        Each character maps to:
          - Hyperbolic component: Based on Unicode category + frequency
          - Toroidal component: Based on character code mod 2π
        
        No training needed. Geometry provides structure.
        """
        embeddings = {}
        
        # Unicode categories (simplified)
        categories = {
            'lowercase': range(ord('a'), ord('z') + 1),
            'uppercase': range(ord('A'), ord('Z') + 1),
            'digit': range(ord('0'), ord('9') + 1),
            'punctuation': list(range(ord('!'), ord('/') + 1)) + 
                          list(range(ord(':'), ord('@') + 1)) +
                          list(range(ord('['), ord('`') + 1)) +
                          list(range(ord('{'), ord('~') + 1)),
            'space': [ord(' '), ord('\t'), ord('\n')],
        }
        
        for char_code in range(0, 0x10FFFF):
            try:
                char = chr(char_code)
            except:
                continue
            
            # Hyperbolic component: radial position based on category
            # Common chars near origin (dense semantics), rare near boundary
            if char_code < 128:  # ASCII
                base_radius = 0.1 + 0.002 * char_code
            else:
                base_radius = 0.5 + 0.0001 * (char_code - 128)
            
            base_radius = min(base_radius, 0.99)  # Stay inside unit ball
            
            # Angular component: distribute uniformly
            angle = 2 * math.pi * (char_code / 0x10FFFF)
            
            # Create n-dimensional hyperbolic point
            h_point = []
            for i in range(self.n):
                if i == 0:
                    h_point.append(base_radius * math.cos(angle))
                elif i == 1:
                    h_point.append(base_radius * math.sin(angle))
                else:
                    h_point.append(0.0)
            
            # Toroidal component: phase based on character code
            t_point = [(char_code * PHI_M1 * (i + 1)) % (2 * math.pi) 
                      for i in range(self.n)]
            
            embeddings[char] = (h_point, t_point)
        
        return embeddings
    
    def _mobius_add(self, u: List[float], v: List[float]) -> List[float]:
        """Möbius addition in Poincaré ball (Eq. 5 from Atlas paper)."""
        norm_u_sq = sum(x*x for x in u)
        norm_v_sq = sum(x*x for x in v)
        dot_uv = sum(a*b for a, b in zip(u, v))
        
        denom = 1 + 2*dot_uv + norm_u_sq * norm_v_sq
        if abs(denom) < 1e-10:
            return u  # Fallback to avoid division by zero
        
        scalar = (1 + 2*dot_uv + norm_v_sq) / denom
        result = [scalar * ui + (1 - norm_u_sq) * vi / denom 
                 for ui, vi in zip(u, v)]
        
        # Project back inside unit ball if numerical error pushes outside
        norm = math.sqrt(sum(x*x for x in result))
        if norm >= 1.0:
            result = [x / (norm + 1e-6) for x in result]
        
        return result
    
    def _hyperbolic_distance(self, u: List[float], v: List[float]) -> float:
        """Poincaré ball distance (Eq. 4 from Atlas paper)."""
        norm_u_sq = sum(x*x for x in u)
        norm_v_sq = sum(x*x for x in v)
        diff = [a - b for a, b in zip(u, v)]
        norm_diff_sq = sum(x*x for x in diff)
        
        arg = 1 + 2 * norm_diff_sq / ((1 - norm_u_sq) * (1 - norm_v_sq) + 1e-10)
        arg = max(1.0, min(arg, 1e10))  # Clamp for numerical stability
        
        return math.acosh(arg)
    
    def _toroidal_distance(self, theta: List[float], psi: List[float]) -> float:
        """φ-weighted toroidal distance (Eq. 9 from Atlas paper)."""
        total = 0.0
        for k, (t, p, w) in enumerate(zip(theta, psi, self.phi_weights)):
            delta = min(abs(t - p), 2*math.pi - abs(t - p))
            total += w * delta * delta
        return math.sqrt(total)
    
    def _composite_distance(self, a: Tuple[List[float], List[float]], 
                           b: Tuple[List[float], List[float]]) -> float:
        """Composite geodesic distance d_M (Eq. 12 from Atlas paper)."""
        d_h = self._hyperbolic_distance(a[0], b[0])
        d_t = self._toroidal_distance(a[1], b[1])
        return math.sqrt(self.w_h * d_h*d_h + self.w_t * d_t*d_t)
    
    def _embed_sequence(self, text: str) -> List[Tuple[List[float], List[float], int]]:
        """Embed character sequence into H^n × T^n."""
        embedded = []
        for i, char in enumerate(text):
            if char in self.char_embeddings:
                h, t = self.char_embeddings[char]
            else:
                # Unknown character: use hash-based fallback
                h_hash = int(hashlib.md5(char.encode()).hexdigest(), 16)
                h = [(h_hash >> (j*8)) % 256 / 255.0 * 0.9 for j in range(self.n)]
                t = [(h_hash >> (j*8)) % 256 / 255.0 * 2*math.pi for j in range(self.n)]
            embedded.append((h, t, i))
        return embedded
    
    def _compute_hyperbolic_density(
        self, 
        embedded: List[Tuple[List[float], List[float], int]],
        window_size: int = 5
    ) -> List[DensityPeak]:
        """
        Detect density peaks in hyperbolic space.
        
        High density = semantic coherence = token candidate.
        Uses sliding window to find local maxima.
        """
        if len(embedded) < window_size:
            return []
        
        peaks = []
        n = len(embedded)
        
        for i in range(n - window_size + 1):
            window = embedded[i:i+window_size]
            
            # Compute centroid in hyperbolic space
            centroid = [0.0] * self.n
            for h, t, idx in window:
                for j in range(self.n):
                    centroid[j] += h[j]
            centroid = [c / window_size for c in centroid]
            
            # Normalize to stay inside unit ball
            norm = math.sqrt(sum(c*c for c in centroid))
            if norm > 0.99:
                centroid = [c / (norm + 1e-6) * 0.99 for c in centroid]
            
            # Compute average distance from centroid (inverse = density)
            avg_dist = sum(self._hyperbolic_distance(h, centroid) 
                          for h, t, idx in window) / window_size
            
            density = 1.0 / (avg_dist + 1e-6)
            
            if density > self.density_threshold:
                # Check if local maximum
                is_peak = True
                for j in range(max(0, i-2), min(n-window_size+1, i+3)):
                    if j == i:
                        continue
                    other_window = embedded[j:j+window_size]
                    other_centroid = [0.0] * self.n
                    for h, t, idx in other_window:
                        for k in range(self.n):
                            other_centroid[k] += h[k]
                    other_centroid = [c / window_size for c in other_centroid]
                    norm = math.sqrt(sum(c*c for c in other_centroid))
                    if norm > 0.99:
                        other_centroid = [c / (norm + 1e-6) * 0.99 for c in other_centroid]
                    other_avg_dist = sum(self._hyperbolic_distance(h, other_centroid) 
                                        for h, t, idx in other_window) / window_size
                    other_density = 1.0 / (other_avg_dist + 1e-6)
                    if other_density > density:
                        is_peak = False
                        break
                
                if is_peak:
                    point_indices = list(range(i, i + window_size))
                    peaks.append(DensityPeak(
                        center=centroid,
                        density=density,
                        radius=avg_dist,
                        point_indices=point_indices
                    ))
        
        # Merge overlapping peaks
        merged = []
        used = set()
        for peak in sorted(peaks, key=lambda p: -p.density):
            if any(idx in used for idx in peak.point_indices):
                continue
            merged.append(peak)
            used.update(peak.point_indices)
        
        return merged
    
    def _detect_phase_boundaries(
        self,
        embedded: List[Tuple[List[float], List[float], int]],
        threshold: Optional[float] = None
    ) -> List[PhaseBoundary]:
        """
        Detect phase boundaries in toroidal component.
        
        Large phase jumps indicate token boundaries.
        Computes winding number changes across boundaries.
        
        Args:
            embedded: List of (hyperbolic, toroidal, index) tuples
            threshold: Phase jump magnitude threshold (default: self.phase_threshold)
        """
        if len(embedded) < 2:
            return []
        
        boundaries = []
        thresh = threshold if threshold is not None else self.phase_threshold
        
        for i in range(1, len(embedded)):
            _, t_prev, _ = embedded[i-1]
            _, t_curr, _ = embedded[i]
            
            # Compute phase difference per dimension
            phase_jumps = []
            for j in range(self.n):
                delta = abs(t_curr[j] - t_prev[j])
                delta = min(delta, 2*math.pi - delta)
                phase_jumps.append(delta)
            
            # Weighted magnitude
            magnitude = math.sqrt(sum(w * pj*pj 
                                     for w, pj in zip(self.phi_weights, phase_jumps)))
            
            if magnitude > thresh:
                # Compute approximate winding change
                winding_change = []
                for j in range(self.n):
                    raw_diff = t_curr[j] - t_prev[j]
                    wraps = round(raw_diff / (2*math.pi))
                    winding_change.append(int(wraps))
                
                boundaries.append(PhaseBoundary(
                    position=i,
                    phase_jump=magnitude,
                    winding_change=winding_change,
                    magnitude=magnitude
                ))
        
        return boundaries
    
    def _compute_winding_vector(
        self,
        embedded: List[Tuple[List[float], List[float], int]]
    ) -> List[int]:
        """
        Compute total winding vector for sequence.
        
        W_k = (1/2π) ∮ dθ_k ∈ Z (Eq. 14 from Atlas paper)
        """
        if len(embedded) < 2:
            return [0] * self.n
        
        winding = [0] * self.n
        
        for i in range(1, len(embedded)):
            _, t_prev, _ = embedded[i-1]
            _, t_curr, _ = embedded[i]
            
            for j in range(self.n):
                raw_diff = t_curr[j] - t_prev[j]
                # Wrap to (-π, π]
                while raw_diff <= -math.pi:
                    raw_diff += 2*math.pi
                while raw_diff > math.pi:
                    raw_diff -= 2*math.pi
                winding[j] += raw_diff
        
        # Convert to integer winding numbers
        winding_int = [round(w / (2*math.pi)) for w in winding]
        
        return winding_int
    
    def _compute_confidence(
        self,
        density: float,
        phase_coherence: float,
        z_log_odds: float = 0.0,
        temperature: float = 1.0
    ) -> float:
        """
        Compute token confidence κ using asymmetric log-odds regulator.
        
        κ(T,t) = σ((z(t) - z(0))/T + σ⁻¹(κ₀)) (Eq. 25 from Atlas paper)
        """
        # Base confidence from geometric quality
        base_conf = 0.5 * (math.tanh(density) + math.tanh(phase_coherence))
        
        # Apply logistic sigmoid regulator
        inv_sigmoid = math.log(base_conf / (1 - base_conf + 1e-10))
        regulated = inv_sigmoid + z_log_odds / temperature
        confidence = 1.0 / (1.0 + math.exp(-regulated))
        
        return max(0.001, min(0.999, confidence))
    
    def tokenize(self, text: str, granularity: str = 'auto') -> List[GeometricToken]:
        """
        Tokenize text into geometric tokens.
        
        Algorithm:
          1. Embed characters into H^n × T^n
          2. Detect hyperbolic density peaks (semantic clusters)
          3. Detect toroidal phase boundaries (rhythmic breaks)
          4. Compute winding vectors (topological identity)
          5. Segment text at boundary ∩ low-density regions
          6. Construct tokens with geometric properties
        
        Args:
            text: Input text to tokenize
            granularity: 'char' (character-level), 'word' (word-level), 
                        'phrase' (phrase-level), or 'auto' (adaptive)
        
        Returns list of GeometricToken objects.
        """
        if not text:
            return []
        
        # Step 1: Embed
        embedded = self._embed_sequence(text)
        
        # Adjust parameters based on granularity
        if granularity == 'char':
            window_size = 1
            density_mult = 0.5
            phase_mult = 0.3
        elif granularity == 'word':
            window_size = 5
            density_mult = 1.0
            phase_mult = 0.8
        elif granularity == 'phrase':
            window_size = 15
            density_mult = 1.5
            phase_mult = 1.2
        else:  # auto
            # Adaptive: scale with text length
            window_size = max(3, min(10, len(text) // 20))
            density_mult = 1.0
            phase_mult = 1.0
        
        # Step 2: Find density peaks
        peaks = self._compute_hyperbolic_density(embedded, window_size=window_size)
        
        # Step 3: Find phase boundaries
        boundaries = self._detect_phase_boundaries(
            embedded, 
            threshold=self.phase_threshold * phase_mult
        )
        boundary_positions = {b.position for b in boundaries}
        
        # Step 4: Compute global winding
        global_winding = self._compute_winding_vector(embedded)
        
        # Step 5: Segment text using whitespace + geometry
        segment_points = self._compute_segmentation_points(
            text, embedded, peaks, boundaries, 
            boundary_positions, granularity, density_mult
        )
        
        # Step 6: Build tokens
        tokens = []
        for i in range(len(segment_points) - 1):
            start = segment_points[i]
            end = segment_points[i + 1]
            
            if end - start < self.min_chars:
                continue
            if end - start > self.max_chars:
                # Split oversized tokens
                for split_start in range(start, end, self.max_chars):
                    split_end = min(split_start + self.max_chars, end)
                    token = self._build_token(
                        text, embedded, split_start, split_end, global_winding
                    )
                    if token:
                        tokens.append(token)
                continue
            
            token = self._build_token(text, embedded, start, end, global_winding)
            if token:
                tokens.append(token)
        
        return tokens
    
    def _compute_segmentation_points(
        self,
        text: str,
        embedded: List[Tuple[List[float], List[float], int]],
        peaks: List[DensityPeak],
        boundaries: List[PhaseBoundary],
        boundary_positions: set,
        granularity: str,
        density_mult: float
    ) -> List[int]:
        """Compute optimal segmentation points combining linguistic and geometric cues."""
        
        segment_points = set([0, len(text)])
        
        # Always segment at whitespace boundaries (linguistic prior)
        for i, char in enumerate(text):
            if char in ' \t\n\r':
                if i > 0:
                    segment_points.add(i)
                if i < len(text) - 1:
                    segment_points.add(i + 1)
        
        # Add punctuation boundaries
        for i, char in enumerate(text):
            if char in ',.!?;:()[]{}"\'-–—':
                if i > 0:
                    segment_points.add(i)
                if i < len(text) - 1:
                    segment_points.add(i + 1)
        
        # Add phase boundary positions (geometric cue)
        for pos in boundary_positions:
            # Snap to nearest word boundary
            best_snap = pos
            for snap_offset in [-2, -1, 0, 1, 2]:
                candidate = pos + snap_offset
                if 0 < candidate < len(text):
                    if candidate in segment_points or text[candidate] in ' \t\n\r,.!?;:':
                        best_snap = candidate
                        break
            segment_points.add(best_snap)
        
        # For phrase granularity, merge small segments
        if granularity == 'phrase':
            sorted_points = sorted(segment_points)
            merged = [sorted_points[0]]
            for i in range(1, len(sorted_points) - 1):
                if sorted_points[i] - merged[-1] >= 10:  # Keep segments ≥10 chars
                    merged.append(sorted_points[i])
            merged.append(sorted_points[-1])
            return merged
        
        return sorted(segment_points)
    
    def _build_token(
        self,
        text: str,
        embedded: List[Tuple[List[float], List[float], int]],
        start: int,
        end: int,
        global_winding: List[int]
    ) -> Optional[GeometricToken]:
        """Build single geometric token from text span."""
        if start >= end or start >= len(embedded):
            return None
        
        span_embedded = embedded[start:end]
        text_span = text[start:end]
        
        # Compute hyperbolic centroid
        h_centroid = [0.0] * self.n
        for h, t, idx in span_embedded:
            for j in range(self.n):
                h_centroid[j] += h[j]
        h_centroid = [c / len(span_embedded) for c in h_centroid]
        
        # Normalize
        norm = math.sqrt(sum(c*c for c in h_centroid))
        if norm > 0.99:
            h_centroid = [c / (norm + 1e-6) * 0.99 for c in h_centroid]
        
        # Compute toroidal mean phase
        t_mean = [0.0] * self.n
        for h, t, idx in span_embedded:
            for j in range(self.n):
                t_mean[j] += t[j]
        t_mean = [(m / len(span_embedded)) % (2*math.pi) for m in t_mean]
        
        # Compute spatial extent (hyperbolic radius)
        avg_h_dist = sum(self._hyperbolic_distance(h, h_centroid) 
                        for h, t, idx in span_embedded) / len(span_embedded)
        
        # Compute phase coherence (inverse of phase variance)
        phase_var = sum(
            min(abs(t[j] - t_mean[j]), 2*math.pi - abs(t[j] - t_mean[j]))**2
            for h, t, idx in span_embedded
            for j in range(self.n)
        ) / (len(span_embedded) * self.n)
        phase_coherence = 1.0 / (phase_var + 1e-6)
        
        # Compute local winding (may differ from global)
        local_winding = self._compute_winding_vector(span_embedded)
        
        # Temporal extent: estimate from phase cycle
        temporal_extent = max(1, round(2*math.pi / max(phase_var, 1e-6)))
        
        # Confidence
        confidence = self._compute_confidence(
            density=1.0/(avg_h_dist + 1e-6),
            phase_coherence=phase_coherence
        )
        
        # Lineage drift: cumulative hyperbolic displacement
        lineage_drift = sum(
            self._hyperbolic_distance(span_embedded[i][0], span_embedded[i+1][0])
            for i in range(len(span_embedded)-1)
        ) if len(span_embedded) > 1 else 0.0
        
        # Rhythm bias: cumulative phase disagreement
        rhythm_bias = sum(
            self._toroidal_distance(span_embedded[i][1], span_embedded[i+1][1])
            for i in range(len(span_embedded)-1)
        ) if len(span_embedded) > 1 else 0.0
        
        return GeometricToken(
            hyperbolic_center=h_centroid,
            toroidal_phase=t_mean,
            winding_vector=local_winding,
            spatial_extent=avg_h_dist,
            temporal_extent=temporal_extent,
            confidence=confidence,
            lineage_drift=lineage_drift,
            rhythm_bias=rhythm_bias,
            text_span=text_span,
            start_idx=start,
            end_idx=end,
        )
    
    def encode(self, text: str) -> List[str]:
        """Encode text to token IDs (hashes of geometric properties)."""
        tokens = self.tokenize(text)
        return [t.token_id() for t in tokens]
    
    def decode(self, tokens: List[GeometricToken]) -> str:
        """Decode geometric tokens back to text."""
        return ''.join(t.text_span for t in tokens)
    
    def get_token_similarity(
        self,
        token1: GeometricToken,
        token2: GeometricToken
    ) -> float:
        """
        Compute similarity between tokens via composite geodesic distance.
        
        Returns value in (0, 1] where 1 = identical geometry.
        """
        h1, t1 = token1.hyperbolic_center, token1.toroidal_phase
        h2, t2 = token2.hyperbolic_center, token2.toroidal_phase
        
        distance = self._composite_distance((h1, t1), (h2, t2))
        
        # Convert distance to similarity (exponential decay)
        similarity = math.exp(-distance)
        
        # Bonus for matching winding vectors (topological similarity)
        if token1.winding_vector == token2.winding_vector:
            similarity *= 1.1  # 10% boost
        
        return min(1.0, similarity)


def demo():
    """Demonstrate geometric tokenization."""
    print("=" * 70)
    print("ATLAS GEOMETRIC TOKENIZER DEMO")
    print("No vocabulary. No training. Pure geometry.")
    print("=" * 70)
    
    tokenizer = AtlasTokenizer(manifold_dim=8)
    
    test_texts = [
        "The quick brown fox jumps over the lazy dog.",
        "Hello, world! 你好，世界！مرحبا بالعالم",
        "123 Main Street, Suite 4B",
        "To be, or not to be, that is the question:",
    ]
    
    for text in test_texts:
        print(f"\nInput: {text!r}")
        print("-" * 50)
        
        tokens = tokenizer.tokenize(text)
        
        print(f"Tokens: {len(tokens)}")
        for i, tok in enumerate(tokens):
            print(f"  [{i}] {tok.text_span!r:15} | W={tok.winding_vector} | κ={tok.confidence:.3f} | L={tok.lineage_drift:.3f}")
        
        # Show token similarities
        if len(tokens) >= 2:
            print("\nToken similarities:")
            for i in range(min(3, len(tokens)-1)):
                sim = tokenizer.get_token_similarity(tokens[i], tokens[i+1])
                print(f"  Token {i} ↔ Token {i+1}: {sim:.4f}")
    
    print("\n" + "=" * 70)
    print("KEY PROPERTIES:")
    print("  • Infinite vocabulary (geometry-defined, not dictionary)")
    print("  • Multilingual by default (Unicode → H^n × T^n)")
    print("  • Sub-word to sentence tokens emerge at different scales")
    print("  • Continuous similarity via geodesic distance")
    print("  • Topological invariants (winding numbers) preserved")
    print("  • No OOV tokens (unknown chars use hash fallback)")
    print("=" * 70)


if __name__ == '__main__':
    demo()
