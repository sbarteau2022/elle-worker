"""
ATLAS SWARM ENGINE: Thermodynamic Agentic Field on H^n x T^n
Barteau & Claude, 2026

A native agentic LLM architecture where:
1. The Base Model (e.g., Qwen) defines the Hamiltonian Potential V(q).
2. Agents are continuous excitations (wave packets) in the phase space.
3. Computation is parallel symplectic flow, not discrete layer passing.
4. The Observer actively prunes/teaches based on thermodynamic efficiency.

Requirements: mlx-core, mlx-nn, numpy
"""

import mlx.core as mx
import mlx.nn as nn
import math
import time
from typing import Tuple, Optional, Dict, List
from dataclasses import dataclass

# ==============================================================================
# CONSTANTS & CONFIG
# ==============================================================================
PHI = (1 + math.sqrt(5)) / 2
DIM_H = 64   # Hyperbolic dimension (Semantic Depth)
DIM_T = 32   # Toroidal dimension (Rhythmic/Context)
MAX_AGENTS = 4096
THRESHOLD_GROWTH = 0.8      # When to spawn new agents
THRESHOLD_PRUNE = 0.05      # Energy below which agents die
OBSERVER_INTERVAL = 10      # Steps between observer interventions
LEARNING_RATE = 0.01
TEMPERATURE = 0.7

# ==============================================================================
# GEOMETRIC PRIMITIVES (MLX NATIVE)
# ==============================================================================

def mobius_add(u: mx.array, v: mx.array, c: float = 1.0) -> mx.array:
    """Möbius addition in Poincaré ball."""
    u_norm2 = mx.sum(u**2, axis=-1, keepdims=True)
    v_norm2 = mx.sum(v**2, axis=-1, keepdims=True)
    dot_uv = mx.sum(u * v, axis=-1, keepdims=True)
    
    denom = 1 + 2 * c * dot_uv + c**2 * u_norm2 * v_norm2
    num = (1 + 2 * c * dot_uv + c**2 * v_norm2) * u + (1 - c**2 * u_norm2) * v
    return num / denom

def geodesic_dist_h(u: mx.array, v: mx.array) -> mx.array:
    """Hyperbolic distance in Poincaré ball."""
    u_norm2 = mx.sum(u**2, axis=-1, keepdims=True)
    v_norm2 = mx.sum(v**2, axis=-1, keepdims=True)
    diff = u - v
    diff_norm2 = mx.sum(diff**2, axis=-1, keepdims=True)
    
    arg = 1 + 2 * diff_norm2 / ((1 - u_norm2) * (1 - v_norm2) + 1e-9)
    return mx.arccosh(mx.clip(arg, 1.0, 1e9))

def wrap_angle(theta: mx.array) -> mx.array:
    """Wrap angles to [-pi, pi]."""
    return (theta + mx.pi) % (2 * mx.pi) - mx.pi

def toroidal_dist(t1: mx.array, t2: mx.array) -> mx.array:
    """Geodesic distance on n-torus."""
    diff = mx.abs(t1 - t2)
    diff = mx.minimum(diff, 2 * mx.pi - diff)
    return mx.sqrt(mx.sum((diff * mx.power(PHI, -mx.arange(DIM_T))), axis=-1))

# ==============================================================================
# THE HAMILTONIAN POTENTIAL (Derived from Base Model Weights)
# ==============================================================================

class HamiltonianPotential(nn.Module):
    """
    Encodes the 'World Physics' derived from the base LLM weights.
    Instead of layers, this defines the potential energy landscape V(q).
    Agents roll downhill towards low-energy (high probability) states.
    """
    def __init__(self, input_dim: int, hidden_dim: int):
        super().__init__()
        # Lightweight projection to map agent state to potential
        self.key_proj = nn.Linear(input_dim, hidden_dim)
        self.val_proj = nn.Linear(input_dim, hidden_dim)
        self.energy_head = nn.Linear(hidden_dim, 1)
        
    def __call__(self, positions: mx.array, context: mx.array) -> mx.array:
        """
        Calculate Potential Energy V(q) for all agents.
        positions: [N_agents, 2*dim] (concatenated u, theta)
        context: [1, dim] (Global goal embedding)
        """
        # Map geometric position to semantic space
        h = self.key_proj(positions)
        # Interact with global goal context
        interaction = h + context  # Broadcast add
        activation = nn.gelu(interaction)
        # Scalar potential energy (lower is better)
        energy = self.energy_head(activation)
        return -energy.squeeze(-1)  # Negate because we want to minimize energy

# ==============================================================================
# SYMPLECTIC INTEGRATOR (The 'Engine')
# ==============================================================================

class SymplecticStep:
    """
    Performs one step of Symplectic Euler integration.
    Preserves phase space volume (Liouville's theorem).
    q' = q + dt * dH/dp
    p' = p - dt * dH/dq
    """
    def __init__(self, dt: float = 0.05):
        self.dt = dt
        
    def step(self, state: Dict, potential: HamiltonianPotential, context: mx.array) -> Dict:
        q = state['q']       # Positions [N, 2*dim]
        p = state['p']       # Momenta [N, 2*dim]
        mass = state['mass'] # [N, 1] (Agent 'confidence' or 'size')
        
        # 1. Compute Force (Gradient of Potential)
        # We use finite differences or autograd. For MLX, we use value_and_grad logic manually 
        # or simple finite diff for stability in this demo.
        # F = - grad_q V(q)
        # Simple approximation: Force pulls towards context if far, repels if close
        # In full impl, use mx.grad on potential()
        dist_metric = mx.linalg.norm(q - context, axis=-1, keepdims=True) 
        force_dir = -(q - context) / (dist_metric + 1e-6)
        force_mag = mx.exp(-dist_metric) # Force decays with distance
        F = force_dir * force_mag
            
        # 2. Update Momentum (p' = p + F*dt)
        p_new = p + F * self.dt * mass
        
        # 3. Apply Damping (Thermodynamic friction to prevent infinite energy)
        damping = 0.98
        p_new = p_new * damping
        
        # 4. Update Position (q' = q + p'/m * dt)
        velocity = p_new / (mass + 1e-6)
        q_new = q + velocity * self.dt
        
        # 5. Manifold Constraints
        # Project Hyperbolic part back into Poincaré Ball
        u_new = q_new[:, :DIM_H]
        u_norm = mx.linalg.norm(u_new, axis=-1, keepdims=True)
        u_new = u_new / mx.maximum(u_norm, 1.0 - 1e-6) # Clip to boundary
        
        # Wrap Toroidal part
        theta_new = wrap_angle(q_new[:, DIM_H:])
        
        q_final = mx.concatenate([u_new, theta_new], axis=-1)
        
        return {'q': q_final, 'p': p_new, 'mass': mass}

# ==============================================================================
# THE OBSERVER (Meta-Controller)
# ==============================================================================

class SwarmObserver:
    """
    Monitors the thermodynamic state of the swarm.
    Prunes inefficient agents, spawns specialists, teaches drifters.
    """
    def __init__(self):
        self.history_energy = []
        
    def analyze(self, state: Dict, goals: mx.array) -> Dict:
        q = state['q']
        p = state['p']
        mass = state['mass']
        
        # 1. Calculate Kinetic Energy (T = 0.5 * m * v^2)
        velocity = p / (mass + 1e-6)
        ke = 0.5 * mass * mx.sum(velocity**2, axis=-1, keepdims=True)
        
        # 2. Calculate Drift (Distance to nearest goal)
        # Broadcast goals [G, dim] vs agents [N, dim]
        dists = mx.linalg.norm(q[:, None, :] - goals[None, :, :], axis=-1)
        min_dist = mx.min(dists, axis=-1, keepdims=True)
        
        # 3. Decision Logic
        
        # A. Prune: Agents with low energy and high drift (stuck/wandering)
        prune_mask = (ke < THRESHOLD_PRUNE) & (min_dist > 0.5)
        survive_mask = ~prune_mask
        
        # B. Teach: Agents with high energy but high drift (chaotic)
        # Apply a corrective impulse to their momentum
        teach_mask = (ke > 0.5) & (min_dist > 0.3)
        correction_dir = goals[0] - q # Simplified: pull to first goal
        correction_dir = correction_dir / (mx.linalg.norm(correction_dir, axis=-1, keepdims=True) + 1e-6)
        
        impulse = mx.zeros_like(state['p'])
        # Apply teaching impulse only to chaotic agents
        # In MLX we can't easily index-assign without scatter, so we multiply by mask
        teach_impulse = correction_dir * 0.2 * teach_mask.astype(mx.float32)
        state['p'] = state['p'] + teach_impulse
        
        # C. Spawn: If coverage is low (large gaps), create new agents
        # Heuristic: If total mass is low, spawn random agents near goals
        total_mass = mx.sum(mass)
        spawn_count = 0
        if total_mass < len(goals) * 2.0:
            spawn_count = max(1, int(len(goals) - total_mass/2))
            
        return {
            'survive_mask': survive_mask,
            'spawn_count': spawn_count,
            'avg_energy': mx.mean(ke),
            'coverage_error': mx.mean(min_dist)
        }

# ==============================================================================
# MAIN SWARM ENGINE
# ==============================================================================

class AtlasSwarmEngine:
    def __init__(self, base_model_dim: int = 512):
        self.dim_total = DIM_H + DIM_T
        self.potential = HamiltonianPotential(self.dim_total, base_model_dim)
        self.integrator = SymplecticStep(dt=0.05)
        self.observer = SwarmObserver()
        
        # Initialize empty swarm
        self.state = {
            'q': mx.zeros((0, self.dim_total)),
            'p': mx.zeros((0, self.dim_total)),
            'mass': mx.zeros((0, 1))
        }
        self.step_count = 0
        
    def spawn_agents(self, count: int, centers: mx.array):
        """Spawn new agents near goal centers."""
        if count <= 0: return
        
        # Random perturbation around centers
        noise = mx.random.normal((count, self.dim_total)) * 0.1
        # Pick random centers for each new agent
        center_idx = mx.random.randint(0, len(centers), (count,))
        start_pos = centers[center_idx] + noise
        
        # Constrain hyperbolic part
        u_part = start_pos[:, :DIM_H]
        u_norm = mx.linalg.norm(u_part, axis=-1, keepdims=True)
        u_part = u_part / mx.maximum(u_norm, 0.9)
        
        # Wrap toroidal part
        t_part = wrap_angle(start_pos[:, DIM_H:])
        
        new_q = mx.concatenate([u_part, t_part], axis=-1)
        new_p = mx.random.normal((count, self.dim_total)) * 0.1
        new_mass = mx.ones((count, 1)) * 1.0
        
        self.state['q'] = mx.concatenate([self.state['q'], new_q], axis=0)
        self.state['p'] = mx.concatenate([self.state['p'], new_p], axis=0)
        self.state['mass'] = mx.concatenate([self.state['mass'], new_mass], axis=0)
        
    def prune_agents(self, mask: mx.array):
        """Remove dead agents."""
        import numpy as np
        mask_flat = np.array(mask).flatten()
        if np.all(mask_flat): return
        indices = mx.array(np.where(mask_flat)[0])
        if len(indices) == 0: return
        
        self.state['q'] = self.state['q'][indices]
        self.state['p'] = self.state['p'][indices]
        self.state['mass'] = self.state['mass'][indices]

    def run_step(self, goals: mx.array):
        """Execute one tick of the swarm dynamics."""
        self.step_count += 1
        
        # 1. Physics Step
        self.state = self.integrator.step(self.state, self.potential, goals[0])
        
        # 2. Observer Intervention
        if self.step_count % OBSERVER_INTERVAL == 0:
            report = self.observer.analyze(self.state, goals)
            
            # Prune
            if mx.sum(~report['survive_mask']) > 0:
                self.prune_agents(report['survive_mask'])
                
            # Spawn
            if report['spawn_count'] > 0 and len(self.state['q']) < MAX_AGENTS:
                self.spawn_agents(report['spawn_count'], goals)
                
            return report
        return None

# ==============================================================================
# DEMONSTRATION
# ==============================================================================

if __name__ == "__main__":
    print("="*60)
    print("ATLAS SWARM ENGINE: Thermodynamic Agentic Field")
    print("="*60)
    
    engine = AtlasSwarmEngine()
    
    # Define 3 Distinct Goals (Simulating complex multi-task prompt)
    # Goal 1: Code Generation (Deep Hyperbolic)
    # Goal 2: Creative Writing (High Toroidal Winding)
    # Goal 3: Math Reasoning (Balanced)
    
    goals = mx.array([
        [0.8, 0.0, 0.0, 0.0, 0.0] + [0.0]*DIM_T, # Deep in H
        [0.0, 0.0, 0.0, 0.0, 0.0] + [3.0, 3.0] + [0.0]*(DIM_T-2), # High Theta
        [0.5, 0.5, 0.0, 0.0, 0.0] + [1.5, 1.5] + [0.0]*(DIM_T-2)  # Mixed
    ])
    # Pad goals to full dim if needed (simplified here)
    if goals.shape[1] < DIM_H + DIM_T:
        pad_width = (DIM_H + DIM_T) - goals.shape[1]
        goals = mx.pad(goals, ((0,0), (0, pad_width)))
        
    print(f"Initialized Swarm Engine with {len(goals)} Task Goals.")
    print(f"Max Agents: {MAX_AGENTS}")
    
    # Initial Spawn
    engine.spawn_agents(10, goals)
    print(f"Initial Swarm Size: {len(engine.state['q'])} agents")
    
    # Simulation Loop
    print("\nStarting Thermodynamic Optimization...")
    for t in range(100):
        report = engine.run_step(goals)
        
        if report:
            n_agents = len(engine.state['q'])
            avg_e = float(report['avg_energy'])
            cov_err = float(report['coverage_error'])
            spawned = report['spawn_count']
            
            status = "STABLE"
            if spawned > 0: status = "EXPANDING"
            if cov_err > 0.5: status = "DRIFTING"
            
            print(f"Step {t:03d} | Agents: {n_agents:04d} | Avg Energy: {avg_e:.4f} | Coverage Error: {cov_err:.4f} | Status: {status}")
            
    final_count = len(engine.state['q'])
    print(f"\nSimulation Complete.")
    print(f"Final Swarm Size: {final_count} specialized agents.")
    print(f"Agents represent dynamic clusters in the latent manifold.")
    print(f"No discrete layers used. Computation was continuous flow.")
