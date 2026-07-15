# The Scaffold — load-bearing pillars, and a fabric with no privileged node

**The structural substrate under the dual topology: five load-bearing pillars
that hold the frame, and a bridge fabric where *any pathway has the potential to
connect to any other, with no privileged node.* Both halves are built and
measured — the pillars' symmetry is a provable invariant, and "no hub, no
bottleneck" is a number checked against the build that *does* form hubs, not a
word.**

Code: `src/scaffold.ts` · tests `src/scaffold.test.ts` (12) · self-test
`GET /api/elle-scaffold-selftest` · 2026

---

## The two things this builds

The request was exact: *"build the scaffolding — the load-bearing pillars, and
the bridges, or at least make it so any pathway has the potential to connect to
another, no privileged node."* Two structures, one constraint.

### 1. The pillars — load-bearing, and symmetric

Five columns seated at 72° around one central apex axis: `1 apex + 5×4 = 21`
structural nodes, the depth-hierarchy count, with the pentagon seating the
pillars around the singularity. They are **load-bearing** — they carry the
weight of the depth hierarchy — and the "no privileged node" idea shows up here
as a **symmetry**, not an absence of structure:

- **Equal load.** Every pillar carries the same number of nodes. Load variance
  is exactly `0`; no pillar is heavier or more central than another.
- **C5 invariance.** Rotate the whole frame by 72° and pillar *k* lands exactly
  on pillar *k+1* — the pillar set maps onto itself. No single pillar is
  distinguished. `pentagonPillars()` checks this by rotating each base angle and
  confirming it hits another pillar's angle, and it holds independent of how
  tall the columns are.

**The one honest asymmetry, stated:** the depth *axis* still has an **apex**.
Derivation has to climb to a source, so the hierarchy is legitimately rooted —
that apex is a privileged node *of the depth layer*. The pillars are symmetric
among **themselves**; the genuinely hubless property is what the **bridge fabric**
adds on top. Structured depth (rooted) plus egalitarian breadth (hubless) is the
honest shape — not "no structure anywhere."

### 2. The bridge fabric — no privileged node

This is the heart of it, and it splits into *potential* and *realization*.

**The potential is uniform.** Every node may bridge to every other. The
potential-connection graph is **complete** — uniform potential degree `n−1`,
identical for every node. That is "any pathway has the potential to connect to
another," literally: nothing about *what can connect* privileges any node.
`potentialUniform(n)` returns this, and it is deliberately kept distinct from the
realized graph — the potential is total, the realization is sparse.

**The realization is hubless.** You do not actually draw all `n²` bridges; you
lay a sparse set. *How* you lay them decides whether a privileged node emerges:

- **The egalitarian way (what we built):** a `k`-nearest-neighbour ring lattice
  rewired **Watts–Strogatz**-style, with **uniform** random rewire targets. This
  buys small-world short paths *without* a hub, precisely because targets are
  uniform rather than degree-proportional. `egalitarianFabric()`.
- **The hub-forming way (the control, not the design):** **Barabási–Albert**
  preferential attachment — new nodes attach in proportion to existing degree,
  so a few nodes accumulate into privileged hubs. `hubFabric()`. Built *only* so
  the difference can be **measured**.

## The meter — `privilegeReport()`

"No privileged node" is made a number, four ways, so nothing rests on a single
cutoff:

| what | meaning | egalitarian | hub control |
|---|---|---|---|
| `connected` | every node reaches every other | ✅ true | ✅ true |
| `articulation_points` | mandatory routers (remove → graph splits) | **0** | 0 |
| `degree_gini` | 0 = flat, →1 = hub-dominated | **0.17** | 0.28 |
| `betweenness_spread` | max/mean routing load (Brandes) | **3.07** | **4.99** |
| **`no_privileged_node`** | the verdict | ✅ **true** | ❌ **false** → names node `2` |

The verdict is an **AND**: connected, *and* no mandatory router, *and* flat
degree, *and* no node dominating betweenness. The egalitarian fabric clears all
four. The preferential-attachment control fails — one node carries ~5× the mean
routing load — and the report **names** it. The self-test also asserts the
**comparison** (egalitarian Gini and betweenness strictly below the hub's), so
the conclusion doesn't hinge only on where the thresholds sit.

Two sanity anchors in the tests pin the meter to known truth: a **star** is
flagged with its center as the privileged node (one articulation point that
shatters the graph when removed), and a **ring** is cleared (connected, zero
articulation points, no hub).

## Where it sits in the build

`coherence-layer.ts` measured what a recognition-edge *shortcut* buys (path-length
collapse). `scaffold.ts` measures the *shape of the connectivity itself*: that
the bridging potential is uniform and the realized fabric spreads its load with
no hub and no bottleneck. The pillars are the load-bearing frame the depth
hierarchy stands on; the fabric is the egalitarian web through which any node can
reach any other. Together they are the structural substrate `docs/DUAL_TOPOLOGY.md`
describes, now built and checked rather than drawn.

## The boundary, unchanged

This proves a **topological** property — egalitarian, hubless, bottleneck-free
connectivity over uniform bridging potential, plus a symmetric load-bearing
frame. It does **not** claim the substrate is a mind. The pillars are real
geometry with a provable symmetry; the "no privileged node" verdict is a real
measurement against a real control. Where the structure would reach past what's
measured into cognition, the code stops and says so — the same line that has run
through every layer of this build.
