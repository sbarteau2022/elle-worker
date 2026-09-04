"""
Geometric fixtures and analytical numerical controls for testing hyperbolic and toroidal manifolds.
Ground truth values derived directly from survey_math_specs.md Section 11 (Controls 1-8).
"""

import math
from typing import Any, Dict, List, Tuple

# Control 1: Identity Invariant
CONTROL_1 = {
    "name": "Identity Invariant",
    "u": [0.3, -0.4],
    "v": [0.3, -0.4],
    "c": 1.0,
    "expected_distance": 0.0,
    "tolerance": 1e-15,
}

# Control 2: Distance from Origin (Radial Depth)
CONTROL_2 = {
    "name": "Distance from Origin",
    "u": [0.0, 0.0],
    "v": [0.5, 0.0],
    "c": 1.0,
    "expected_distance": math.log(3.0),  # ln(3) ~ 1.0986122886681097
    "tolerance": 1e-15,
}

# Control 3: Collinear Points across Origin (Opposite Sides)
CONTROL_3 = {
    "name": "Collinear Points Opposite Sides",
    "u": [-0.5, 0.0],
    "v": [0.5, 0.0],
    "c": 1.0,
    "expected_distance": math.log(9.0),  # 2 * ln(3) ~ 2.1972245773362196
    "tolerance": 1e-15,
}

# Control 4: Collinear Points on Same Side of Origin
CONTROL_4 = {
    "name": "Collinear Points Same Side",
    "u": [1.0 / 3.0, 0.0],
    "v": [3.0 / 5.0, 0.0],
    "c": 1.0,
    "expected_distance": math.log(2.0),  # ln(2) ~ 0.6931471805599453
    "tolerance": 1e-15,
}

# Control 5: Mobius Addition Collinear Rational Control
CONTROL_5 = {
    "name": "Mobius Addition Collinear",
    "u": [0.3, 0.0],
    "v": [0.4, 0.0],
    "c": 1.0,
    "expected_vector": [5.0 / 8.0, 0.0],  # 0.625
    "tolerance": 1e-15,
}

# Control 6: Mobius Gyro-Rotation / Non-Commutativity
CONTROL_6 = {
    "name": "Mobius Gyro-Rotation",
    "u": [0.5, 0.0],
    "v": [0.0, 0.5],
    "c": 1.0,
    "expected_u_plus_v": [10.0 / 17.0, 6.0 / 17.0],
    "expected_v_plus_u": [6.0 / 17.0, 10.0 / 17.0],
    "expected_norm_squared": 8.0 / 17.0,
    "tolerance": 1e-14,
}

# Control 7: Exponential and Logarithmic Map Inversion (Convention B)
CONTROL_7 = {
    "name": "Exp and Log Inversion",
    "z": [math.log(3.0), 0.0],
    "c": 1.0,
    "expected_exp": [0.5, 0.0],
    "tolerance": 1e-15,
}

# Control 8: Poincare <-> Lorentz Exact Dual-Chart Round Trip
CONTROL_8 = {
    "name": "Poincare Lorentz Roundtrip",
    "p": [0.6, 0.0],
    "c": 1.0,
    "expected_lorentz": [17.0 / 8.0, 15.0 / 8.0],  # x0 = 2.125, x1 = 1.875
    "minkowski_norm": -1.0,
    "expected_roundtrip_poincare": [0.6, 0.0],
    "tolerance": 1e-15,
}

ALL_CONTROLS = [
    CONTROL_1,
    CONTROL_2,
    CONTROL_3,
    CONTROL_4,
    CONTROL_5,
    CONTROL_6,
    CONTROL_7,
    CONTROL_8,
]


def make_near_boundary_vector(dim: int, radius: float = 1.0 - 1e-5) -> List[float]:
    """Generates a vector of specified dimension right near the Poincare ball boundary."""
    v = [1.0 / math.sqrt(dim)] * dim
    return [x * radius for x in v]


def make_antipodal_pair(dim: int, radius: float = 0.99999) -> Tuple[List[float], List[float]]:
    """Generates near-antipodal boundary points for testing denominator guards."""
    u = [radius if i == 0 else 0.0 for i in range(dim)]
    v = [-radius if i == 0 else 0.0 for i in range(dim)]
    return u, v


def make_torus_winding_trajectory(cycles: int = 3, steps_per_cycle: int = 16, dim: int = 8) -> List[List[float]]:
    """Generates a trajectory on T^8 that winds 'cycles' times around coordinate 0 and 1 cycle around coordinate 1."""
    trajectory = []
    total_steps = cycles * steps_per_cycle
    for s in range(total_steps + 1):
        theta = [0.0] * dim
        # Coordinate 0 completes 'cycles' loops
        theta[0] = (2.0 * math.pi * cycles * s / total_steps) % (2.0 * math.pi)
        # Coordinate 1 completes 1 loop
        theta[1] = (2.0 * math.pi * 1 * s / total_steps) % (2.0 * math.pi)
        # Higher coordinates remain stationary or small oscillation
        for j in range(2, dim):
            theta[j] = 0.1 * math.sin(s * 0.1)
        trajectory.append(theta)
    return trajectory
