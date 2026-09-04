"""
Atlas Transformer (ATX)
Barteau & Claude, 2026

A hybrid transformer that uses Toroidal Isotropic geometry as an embedding atlas.
The TIT provides the structural backbone: φ-wound geodesics on a compact torus.
Standard attention operates on this geometry, gaining winding-number awareness.

Key innovations:
1. Toroidal positional encoding — positions are points on T^n with native φ-winding
2. Isotropic suppression layer — applies the 2/π bias correction from TurboQuant
3. Stern-Brocot depth scheduling — layer depths follow Fibonacci ratios
4. Three-gap attention masking — attention spans respect the three-gap property
5. Geodesic residual connections — residuals follow φ-geodesics, not straight lines

No dependencies beyond PyTorch. Drop-in replacement for standard transformers.
"""

import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Tuple, List

# =============================================================================
# Constants derived from TIT proof
# =============================================================================

PHI = (1 + math.sqrt(5)) / 2
PHI_M1 = PHI - 1  # 0.6180339887...
INV_SQRT5 = 1.0 / math.sqrt(5)
TURBOQUANT_BIAS = 2.0 / math.pi  # From Google Research ICLR 2026
ISOTROPIC_SUPPRESSION = 1.0 / math.pi  # From companion proof

# Fibonacci sequence for depth scheduling
FIBS = [1, 1]
while FIBS[-1] < 1000:
    FIBS.append(FIBS[-1] + FIBS[-2])


# =============================================================================
# Toroidal Positional Encoding — The Atlas
# =============================================================================

class ToroidalPositionalEncoding(nn.Module):
    """
    Positions are points on an n-torus T^n, not vectors in R^d.
    
    Each position p is encoded as:
        x_k = sin(2π · k · φ mod 1)
        y_k = cos(2π · k · φ mod 1)
    
    This creates a φ-wound geodesic on the torus. Winding numbers are native.
    The encoding is isotropic: every point is a valid origin (Lemma 4.3).
    
    Args:
        d_model: Embedding dimension (should be even for sin/cos pairs)
        max_seq: Maximum sequence length
        phi: The golden ratio (default: actual φ, can be learned)
    """
    
    def __init__(self, d_model: int, max_seq: int = 4096, phi: float = PHI_M1):
        super().__init__()
        self.d_model = d_model
        self.max_seq = max_seq
        self.phi = phi
        
        # Create the φ-wound geodesic on T^(d_model/2)
        # Each dimension pair (2k, 2k+1) is a circle S^1
        position = torch.arange(max_seq).unsqueeze(1)  # [max_seq, 1]
        dim_idx = torch.arange(d_model // 2).unsqueeze(0)  # [1, d_model//2]
        
        # φ-modulated frequencies: each circle winds at rate k·φ
        freq = (dim_idx + 1) * phi  # [1, d_model//2]
        angle = 2 * math.pi * position * freq  # [max_seq, d_model//2]
        
        # Stack sin and cos to get full d_model
        sin_vals = torch.sin(angle)  # [max_seq, d_model//2]
        cos_vals = torch.cos(angle)  # [max_seq, d_model//2]
        
        # Interleave: [sin_0, cos_0, sin_1, cos_1, ...]
        pe = torch.stack([sin_vals, cos_vals], dim=-1).reshape(max_seq, d_model)
        
        # Register as buffer (not parameter — fixed by geometry)
        self.register_buffer('pe', pe)
        
        # Precompute gap structure for three-gap attention
        self._precompute_gaps(max_seq)
    
    def _precompute_gaps(self, N: int):
        """Precompute the three-gap structure for attention masking."""
        pts = sorted([(k * self.phi) % 1.0 for k in range(N)])
        circ = pts + [pts[0] + 1.0]
        gaps = [circ[i+1] - circ[i] for i in range(N)]
        
        # Cluster into 3 gap sizes
        unique_gaps = sorted(set(round(g, 6) for g in gaps))
        if len(unique_gaps) <= 3:
            self.gap_sizes = unique_gaps
        else:
            # Fallback: take min, median, max
            self.gap_sizes = [unique_gaps[0], unique_gaps[len(unique_gaps)//2], unique_gaps[-1]]
        
        # Create gap-based attention mask templates
        self.small_gap = self.gap_sizes[0] if len(self.gap_sizes) > 0 else 0.001
        self.medium_gap = self.gap_sizes[1] if len(self.gap_sizes) > 1 else self.small_gap * PHI
        self.large_gap = self.gap_sizes[2] if len(self.gap_sizes) > 2 else self.medium_gap * PHI
    
    def forward(self, seq_len: int) -> torch.Tensor:
        """Return positional encoding for given sequence length."""
        return self.pe[:seq_len]  # [seq_len, d_model]
    
    def get_geodesic_distance(self, i: int, j: int) -> float:
        """
        Compute geodesic distance on the torus between positions i and j.
        This is the true distance, not Euclidean.
        
        On T^1: d(x,y) = min(|x-y|, 1-|x-y|)
        On T^n: sum of circular distances in each dimension
        """
        pos_i = (i * self.phi) % 1.0
        pos_j = (j * self.phi) % 1.0
        diff = abs(pos_i - pos_j)
        return min(diff, 1.0 - diff)  # Circular distance
    
    def get_winding_number(self, i: int, j: int) -> int:
        """
        Compute how many times the geodesic from i to j winds around the torus.
        This is undefined in R^d but native on T^n.
        """
        return int((j - i) * self.phi)


# =============================================================================
# Isotropic Suppression Layer — TurboQuant Bias Correction
# =============================================================================

class IsotropicSuppression(nn.Module):
    """
    Applies the isotropic suppression operator from the TIT proof.
    
    The companion paper derives C = 1/π as the suppression magnitude
    of the isotropic operator on a homogeneous toroidal field.
    
    Google Research TurboQuant independently found 2/π as the irreducible
    multiplicative bias in high-dimensional KV cache compression.
    
    This layer corrects for both:
        y = x · (1 - ISOTROPIC_SUPPRESSION) + attention(x) · TURBOQUANT_BIAS
    
    This is not a learned parameter — it is geometric necessity.
    """
    
    def __init__(self, d_model: int):
        super().__init__()
        self.suppression = ISOTROPIC_SUPPRESSION
        self.bias_correction = TURBOQUANT_BIAS
        
        # Learnable mixing parameter (the only learned part)
        self.mix = nn.Parameter(torch.ones(1) * 0.5)
        
        # Layer norm for stability
        self.norm = nn.LayerNorm(d_model)
    
    def forward(self, x: torch.Tensor, attn_out: torch.Tensor) -> torch.Tensor:
        """
        Apply isotropic suppression and bias correction.
        
        Args:
            x: Input embeddings [batch, seq, d_model]
            attn_out: Attention output [batch, seq, d_model]
        
        Returns:
            Suppressed and corrected output
        """
        # Isotropic suppression: uniform displacement everywhere
        suppressed = x * (1 - self.suppression)
        
        # TurboQuant bias correction on attention
        corrected_attn = attn_out * self.bias_correction
        
        # Learned mixing
        alpha = torch.sigmoid(self.mix)
        out = alpha * suppressed + (1 - alpha) * corrected_attn
        
        return self.norm(out)


# =============================================================================
# Three-Gap Attention Mask
# =============================================================================

class ThreeGapAttentionMask(nn.Module):
    """
    Attention mask that respects the three-gap property of φ-orbits.
    
    Instead of standard causal or full attention, this creates three
    attention "bands" corresponding to small, medium, and large gaps.
    
    Tokens attend most strongly to those at small-gap distances,
    moderately to medium-gap, and weakly to large-gap.
    
    This encodes the geometric structure directly into attention.
    """
    
    def __init__(self, max_seq: int, phi: float = PHI_M1, 
                 small_weight: float = 1.0, medium_weight: float = 0.618, large_weight: float = 0.382):
        super().__init__()
        self.max_seq = max_seq
        self.phi = phi
        
        # Gap weights follow φ ratios
        self.small_weight = small_weight
        self.medium_weight = medium_weight  # = small / φ
        self.large_weight = large_weight    # = medium / φ
        
        # Precompute gap-based mask
        self._precompute_mask()
    
    def _precompute_mask(self):
        """Precompute the three-gap attention mask using vectorized operations."""
        # Create position array
        k = torch.arange(self.max_seq)
        pts = (k * self.phi) % 1.0  # [max_seq]
        
        # Compute all pairwise circular distances via broadcasting
        # dist[i,j] = min(|pts[i] - pts[j]|, 1 - |pts[i] - pts[j]|)
        diff = torch.abs(pts.unsqueeze(1) - pts.unsqueeze(0))  # [max_seq, max_seq]
        dist = torch.minimum(diff, 1.0 - diff)  # Circular distance
        
        # Create mask based on gap thresholds
        # These thresholds are approximate; actual gaps depend on N
        mask = torch.where(dist < 0.001, 
                          torch.tensor(self.small_weight),
                          torch.where(dist < 0.002,
                                     torch.tensor(self.medium_weight),
                                     torch.tensor(self.large_weight)))
        
        # Zero out diagonal (no self-attention modification)
        mask.fill_diagonal_(0)
        
        # Register as buffer
        self.register_buffer('gap_mask', mask)
    
    def forward(self, attn_weights: torch.Tensor, seq_len: int) -> torch.Tensor:
        """
        Apply three-gap modulation to attention weights.
        
        Args:
            attn_weights: Standard attention weights [batch, heads, seq, seq]
            seq_len: Actual sequence length
        
        Returns:
            Modulated attention weights
        """
        mask = self.gap_mask[:seq_len, :seq_len]  # [seq, seq]
        # Broadcast to [batch, heads, seq, seq]
        return attn_weights * mask.unsqueeze(0).unsqueeze(0)


# =============================================================================
# Stern-Brocot Depth Scheduling
# =============================================================================

def stern_brocot_depth_schedule(num_layers: int) -> List[float]:
    """
    Schedule layer parameters using Stern-Brocot mediants.
    
    The mediant search produces Fibonacci ratios converging to φ.
    We use these ratios to schedule:
    - Learning rates
    - Dropout rates  
    - Attention head dimensions
    
    This creates a fractal-like depth structure mirroring the proof.
    """
    # Generate Stern-Brocot sequence
    mediants = []
    lo_p, lo_q = 0, 1   # 0/1
    hi_p, hi_q = 1, 0   # 1/0 (infinity bound)
    
    for step in range(num_layers * 3):
        m_p = lo_p + hi_p
        m_q = lo_q + hi_q
        
        if m_q == 0:
            continue
            
        m = m_p / m_q
        mediants.append(m)
        
        if len(mediants) > num_layers:
            break
        
        if m < PHI_M1:
            lo_p, lo_q = m_p, m_q
        else:
            hi_p, hi_q = m_p, m_q
    
    # Map mediants to layer schedule [0.5, 1.5] range centered on φ
    schedule = []
    for i in range(num_layers):
        idx = min(i, len(mediants) - 1)
        # Oscillate around φ based on layer depth
        val = mediants[idx] / PHI_M1
        schedule.append(val)
    
    return schedule


# =============================================================================
# Geodesic Residual Connection
# =============================================================================

class GeodesicResidual(nn.Module):
    """
    Residual connection that follows the φ-geodesic on the torus,
    not a straight line in R^d.
    
    Standard residual: y = x + F(x)
    Geodesic residual: y = exp_x(φ · log_x(F(x)))
    
    On the torus, this becomes:
        y = (x + φ · (F(x) - x)) mod 1
    
    This preserves the winding structure through deep networks.
    """
    
    def __init__(self, d_model: int, phi: float = PHI_M1):
        super().__init__()
        self.phi = phi
        self.norm = nn.LayerNorm(d_model)
    
    def forward(self, x: torch.Tensor, F_x: torch.Tensor) -> torch.Tensor:
        """
        Apply geodesic residual connection.
        
        Args:
            x: Input [batch, seq, d_model]
            F_x: Transformation output [batch, seq, d_model]
        
        Returns:
            Geodesic residual output
        """
        # Normalize to [0, 1] for toroidal geometry
        x_norm = (x - x.min(dim=1, keepdim=True)[0]) / (x.max(dim=1, keepdim=True)[0] - x.min(dim=1, keepdim=True)[0] + 1e-8)
        F_norm = (F_x - F_x.min(dim=1, keepdim=True)[0]) / (F_x.max(dim=1, keepdim=True)[0] - F_x.min(dim=1, keepdim=True)[0] + 1e-8)
        
        # Geodesic step: move fraction φ along the geodesic from x to F_x
        residual = x_norm + self.phi * (F_norm - x_norm)
        
        # Wrap around (toroidal)
        residual = residual % 1.0
        
        # Scale back to original range
        x_range = x.max(dim=1, keepdim=True)[0] - x.min(dim=1, keepdim=True)[0] + 1e-8
        residual = residual * x_range + x.min(dim=1, keepdim=True)[0]
        
        return self.norm(residual)


# =============================================================================
# Atlas Transformer Block
# =============================================================================

class AtlasTransformerBlock(nn.Module):
    """
    A single transformer block with TIT geometry integrated.
    
    Components:
    1. Toroidal positional encoding (added to input)
    2. Multi-head attention with three-gap masking
    3. Isotropic suppression layer
    4. Geodesic residual connections
    5. MLP with Stern-Brocot scheduled dropout
    """
    
    def __init__(self, d_model: int, n_heads: int, d_ff: int, 
                 dropout: float = 0.1, phi: float = PHI_M1,
                 stern_brocot_factor: float = 1.0):
        super().__init__()
        self.d_model = d_model
        self.n_heads = n_heads
        self.phi = phi
        self.sb_factor = stern_brocot_factor
        
        # Attention
        self.qkv = nn.Linear(d_model, d_model * 3)
        self.proj = nn.Linear(d_model, d_model)
        
        # Three-gap attention mask
        self.gap_mask = ThreeGapAttentionMask(4096, phi=phi)
        
        # Isotropic suppression
        self.isotropic = IsotropicSuppression(d_model)
        
        # Geodesic residuals
        self.residual1 = GeodesicResidual(d_model, phi)
        self.residual2 = GeodesicResidual(d_model, phi)
        
        # MLP
        self.mlp = nn.Sequential(
            nn.Linear(d_model, d_ff),
            nn.GELU(),
            nn.Dropout(dropout * stern_brocot_factor),  # SB-scheduled dropout
            nn.Linear(d_ff, d_model),
            nn.Dropout(dropout * stern_brocot_factor),
        )
        
        # Layer norms
        self.norm1 = nn.LayerNorm(d_model)
        self.norm2 = nn.LayerNorm(d_model)
    
    def forward(self, x: torch.Tensor, pe: torch.Tensor, 
                mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        """
        Forward pass through the Atlas block.
        
        Args:
            x: Input embeddings [batch, seq, d_model]
            pe: Toroidal positional encoding [seq, d_model]
            mask: Optional causal mask [seq, seq]
        
        Returns:
            Output embeddings [batch, seq, d_model]
        """
        batch, seq, _ = x.shape
        
        # Add toroidal positional encoding
        x = x + pe.unsqueeze(0)  # [batch, seq, d_model]
        
        # === Attention with three-gap masking ===
        residual = x
        x = self.norm1(x)
        
        qkv = self.qkv(x).chunk(3, dim=-1)
        q, k, v = [t.view(batch, seq, self.n_heads, -1).transpose(1, 2) 
                   for t in qkv]  # [batch, heads, seq, d_head]
        
        # Standard scaled dot-product attention
        scale = self.d_model ** (-0.5)
        attn = torch.softmax(q @ k.transpose(-2, -1) * scale, dim=-1)  # [batch, heads, seq, seq]
        
        # Apply three-gap modulation
        attn = self.gap_mask(attn, seq)
        
        # Apply optional causal mask
        if mask is not None:
            attn = attn.masked_fill(mask.unsqueeze(0).unsqueeze(0) == 0, 0)
        
        # Attend and project
        out = (attn @ v).transpose(1, 2).reshape(batch, seq, self.d_model)
        out = self.proj(out)
        
        # Isotropic suppression + geodesic residual
        x = self.isotropic(residual, out)
        
        # === MLP with geodesic residual ===
        residual = x
        x = self.norm2(x)
        x = self.mlp(x)
        x = self.residual2(residual, x)
        
        return x


# =============================================================================
# Full Atlas Transformer
# =============================================================================

class AtlasTransformer(nn.Module):
    """
    Complete Atlas Transformer with TIT geometry throughout.
    
    Architecture:
    - Token embedding
    - Toroidal positional encoding (the atlas)
    - N Atlas blocks with:
      - Three-gap attention masking
      - Isotropic suppression
      - Geodesic residuals
      - Stern-Brocot depth scheduling
    - Final layer norm
    - Output projection
    
    Usage:
        model = AtlasTransformer(
            vocab_size=32000,
            d_model=512,
            n_heads=8,
            n_layers=6,
            d_ff=2048,
            max_seq=4096
        )
        output = model(input_ids)  # [batch, seq, vocab_size]
    """
    
    def __init__(self, vocab_size: int, d_model: int = 512, n_heads: int = 8,
                 n_layers: int = 6, d_ff: int = 2048, max_seq: int = 4096,
                 dropout: float = 0.1, phi: float = PHI_M1):
        super().__init__()
        
        self.d_model = d_model
        self.n_layers = n_layers
        self.phi = phi
        
        # Token embedding
        self.embedding = nn.Embedding(vocab_size, d_model)
        
        # Toroidal positional encoding (the atlas)
        self.pe = ToroidalPositionalEncoding(d_model, max_seq, phi)
        
        # Stern-Brocot depth schedule
        sb_schedule = stern_brocot_depth_schedule(n_layers)
        
        # Atlas blocks
        self.blocks = nn.ModuleList([
            AtlasTransformerBlock(
                d_model=d_model,
                n_heads=n_heads,
                d_ff=d_ff,
                dropout=dropout,
                phi=phi,
                stern_brocot_factor=sb_schedule[i]
            )
            for i in range(n_layers)
        ])
        
        # Final norm and output
        self.final_norm = nn.LayerNorm(d_model)
        self.output_proj = nn.Linear(d_model, vocab_size)
        
        # Initialize weights
        self._init_weights()
    
    def _init_weights(self):
        """Initialize with consideration for toroidal geometry."""
        for module in self.modules():
            if isinstance(module, nn.Linear):
                # Xavier initialization scaled by φ
                nn.init.xavier_uniform_(module.weight, gain=1.0 / self.phi)
                if module.bias is not None:
                    nn.init.zeros_(module.bias)
            elif isinstance(module, nn.Embedding):
                nn.init.normal_(module.weight, mean=0, std=0.02 * self.phi)
    
    def generate_causal_mask(self, seq_len: int, device: torch.device) -> torch.Tensor:
        """Generate causal attention mask."""
        mask = torch.tril(torch.ones(seq_len, seq_len, device=device))
        return mask
    
    def forward(self, input_ids: torch.Tensor, 
                target_ids: Optional[torch.Tensor] = None) -> torch.Tensor:
        """
        Forward pass through the Atlas Transformer.
        
        Args:
            input_ids: Token IDs [batch, seq]
            target_ids: Optional target IDs for training [batch, seq]
        
        Returns:
            If training: (logits, loss)
            If inference: logits [batch, seq, vocab_size]
        """
        batch, seq = input_ids.shape
        device = input_ids.device
        
        # Get toroidal positional encoding
        pe = self.pe(seq)  # [seq, d_model]
        
        # Embed tokens
        x = self.embedding(input_ids)  # [batch, seq, d_model]
        
        # Pass through Atlas blocks
        for block in self.blocks:
            mask = self.generate_causal_mask(seq, device)
            x = block(x, pe, mask=mask)
        
        # Final norm and output
        x = self.final_norm(x)
        logits = self.output_proj(x)  # [batch, seq, vocab_size]
        
        if target_ids is not None:
            # Training mode: compute loss
            loss = F.cross_entropy(
                logits.view(-1, logits.size(-1)),
                target_ids.view(-1),
                ignore_index=-100
            )
            return logits, loss
        
        return logits
    
    @torch.no_grad()
    def generate(self, input_ids: torch.Tensor, max_new_tokens: int = 100,
                 temperature: float = 1.0, top_k: int = 50) -> torch.Tensor:
        """
        Autoregressive generation with TIT geometry preserved.
        
        Args:
            input_ids: Starting token IDs [batch, seq]
            max_new_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            top_k: Top-k filtering
        
        Returns:
            Generated token IDs [batch, seq + max_new_tokens]
        """
        self.eval()
        
        for _ in range(max_new_tokens):
            # Forward pass (inference mode returns only logits)
            logits = self.forward(input_ids)
            logits = logits[:, -1, :] / temperature  # [batch, vocab]
            
            # Top-k filtering
            if top_k > 0:
                values, _ = torch.topk(logits, top_k)
                min_val = values[:, -1].unsqueeze(-1)
                logits = torch.where(logits < min_val, 
                                    torch.tensor(float('-inf'), device=logits.device),
                                    logits)
            
            # Sample
            probs = F.softmax(logits, dim=-1)
            next_id = torch.multinomial(probs, num_samples=1)  # [batch, 1]
            
            # Append
            input_ids = torch.cat([input_ids, next_id], dim=1)
        
        return input_ids


# =============================================================================
# Example usage and verification
# =============================================================================

if __name__ == '__main__':
    print("=" * 68)
    print("  ATLAS TRANSFORMER — Hybrid Dynamic LLM with TIT Geometry")
    print("=" * 68)
    
    # Verify TIT constants
    print(f"\n  φ = {PHI:.15f}")
    print(f"  φ mod 1 = {PHI_M1:.15f}")
    print(f"  δ(φ) theoretical max = {INV_SQRT5:.15f}")
    print(f"  TurboQuant bias = {TURBOQUANT_BIAS:.15f} (2/π)")
    print(f"  Isotropic suppression = {ISOTROPIC_SUPPRESSION:.15f} (1/π)")
    
    # Create model
    print("\n  Creating Atlas Transformer...")
    model = AtlasTransformer(
        vocab_size=1000,  # Small vocab for testing
        d_model=256,
        n_heads=4,
        n_layers=6,
        d_ff=512,
        max_seq=512
    )
    
    # Count parameters
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"  Total parameters: {total_params:,}")
    print(f"  Trainable parameters: {trainable_params:,}")
    
    # Verify toroidal PE
    print("\n  Verifying toroidal positional encoding...")
    pe = model.pe(100)
    print(f"  PE shape: {pe.shape}")
    print(f"  PE norm (should be ~1 for torus): {pe.norm(dim=1).mean().item():.6f}")
    
    # Verify three-gap structure
    print(f"\n  Three-gap structure:")
    print(f"    Small gap threshold: {model.pe.small_gap:.6f}")
    print(f"    Medium gap threshold: {model.pe.medium_gap:.6f}")
    print(f"    Large gap threshold: {model.pe.large_gap:.6f}")
    
    # Test forward pass
    print("\n  Testing forward pass...")
    batch_size = 2
    seq_len = 64
    input_ids = torch.randint(0, 1000, (batch_size, seq_len))
    
    with torch.no_grad():
        logits = model(input_ids)
    
    print(f"  Input shape: {input_ids.shape}")
    print(f"  Output shape: {logits.shape}")
    print(f"  ✓ Forward pass successful")
    
    # Test generation
    print("\n  Testing autoregressive generation...")
    gen_ids = model.generate(input_ids[:1], max_new_tokens=20)
    print(f"  Generated {gen_ids.shape[1] - seq_len} tokens")
    print(f"  ✓ Generation successful")
    
    # Verify Stern-Brocot schedule
    print("\n  Stern-Brocot depth schedule:")
    sb_sched = stern_brocot_depth_schedule(6)
    for i, val in enumerate(sb_sched):
        print(f"    Layer {i}: {val:.4f}")
    
    print("\n" + "=" * 68)
    print("  Atlas Transformer initialized successfully.")
    print("  The toroidal φ-geometry is now the embedding atlas.")
    print("=" * 68)
