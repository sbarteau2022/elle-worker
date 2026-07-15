// ============================================================
// THE MIND MAP PIPELINE — src/mindmap-pipeline.ts
//
// The end-to-end runnable function, open end to outflow: raw bimodal input
// (a transcript with real timestamps — e.g. a YouTube video's captions) passes
// THROUGH the held witness architecture and comes out as both graphs, measured:
//
//   INTAKE      raw segments {t0,t1,text} — the open end
//   WITNESS     the security gate: scanBuffer + size caps; hostile input is
//               refused with the finding named (the Witness holding the door)
//   DERIVATION  the 21-side: root → sections → segments, sequential causal
//               chain — the deep hierarchy, built as real MemEdges
//   RECOGNITION the 19-side: deterministic token-overlap (Jaccard) between
//               DISTANT segments closes loops across branches — real assoc
//               edges, the small-world shortcut layer
//   BIMODAL     two channels from the SAME input: semantic novelty (what the
//               words do) and temporal rate (what the clock does — words/sec
//               from the actual timestamps, a genuinely world-coupled channel).
//               harmonicCoherence(novelty, rate) = κ; groundingGate keeps
//               consistency ≠ correspondence with the temporal channel as the
//               external reference.
//   COHERENCE   coherenceReport over the union — the measured payoff of the
//               recognition layer on THIS input (path_len_gain etc.)
//   REGULATE    the free-energy regulator run on the measured coherences —
//               the invariants, held
//   OUTFLOW     the summary + the full REPLAY TRACE: every node, every edge,
//               every measure, in order, so a UI can replay intake → outflow
//               step by step. The trace IS the replay mode.
//
// Pure and deterministic: same segments in → byte-identical trace out (no
// Date.now/random in the core). The YouTube caption fetch lives in a separate
// impure helper (fetchYouTubeSegments) so the core stays testable.
//
// HONEST SCOPE: "bimodal" here is two real, independent channels of one
// recording — content dynamics and delivery timing. It is not audio DSP and
// not a claim of understanding; the LLM is nowhere in this pipeline. Every
// measure is the same tested machinery the rest of the build uses.
// ============================================================

import type { MemEdge } from './graph';
import { coherenceReport, type CoherenceReport } from './coherence-layer';
import { harmonicCoherence, groundingGate, type GroundingVerdict } from './harmonic-coherence';
import { regulate } from './regulator';
import { scanBuffer, type FileFinding } from './security-network';

export interface Segment { t0: number; t1: number; text: string }

export interface TraceEvent {
  i: number;
  stage: 'intake' | 'witness' | 'derivation' | 'recognition' | 'bimodal' | 'coherence' | 'regulate' | 'outflow';
  type: string;
  data: Record<string, unknown>;
}

export interface MindMapResult {
  ok: boolean;
  refused?: { reason: string; findings: FileFinding[] };
  title: string;
  nodes: { id: string; kind: 'root' | 'section' | 'segment'; label: string; t0?: number }[];
  edges: MemEdge[];
  kappa: number;
  grounding: GroundingVerdict;
  coherence?: CoherenceReport;
  regulator?: { converged: boolean; F0: number; F_final: number };
  trace: TraceEvent[];
}

const MAX_SEGMENTS = 400;
const MAX_TEXT = 200_000;
const SECTION_SIZE = 6;         // segments per section node in the derivation tree
const RECOG_MIN_GAP = 3;        // recognition only between DISTANT segments
const RECOG_THRESHOLD = 0.22;   // Jaccard overlap that counts as "recognized"

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter((w) => w.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

// The end-to-end function. Pure: no clock, no randomness, no network.
export function runMindMap(title: string, segments: Segment[]): MindMapResult {
  const trace: TraceEvent[] = [];
  let step = 0;
  const emit = (stage: TraceEvent['stage'], type: string, data: Record<string, unknown>) =>
    trace.push({ i: step++, stage, type, data });

  // ── INTAKE ──
  const segs = segments.slice(0, MAX_SEGMENTS).filter((s) => s && typeof s.text === 'string' && s.text.trim());
  emit('intake', 'received', { title, segments: segs.length, truncated: segments.length > MAX_SEGMENTS });

  // ── WITNESS — the gate the input passes THROUGH, not around ──
  const fullText = segs.map((s) => s.text).join('\n');
  const findings = scanBuffer(new TextEncoder().encode(fullText.slice(0, 65536)), `${title || 'upload'}.txt`);
  const oversize = fullText.length > MAX_TEXT;
  emit('witness', 'scanned', { findings: findings.length, oversize });
  const critical = findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  if (critical.length || oversize || segs.length === 0) {
    const reason = oversize ? 'input exceeds size cap' : segs.length === 0 ? 'no usable segments' : 'witness findings on content';
    emit('witness', 'refused', { reason });
    emit('outflow', 'done', { ok: false });
    return {
      ok: false, refused: { reason, findings: critical }, title,
      nodes: [], edges: [], kappa: 0, grounding: 'incoherent', trace,
    };
  }
  emit('witness', 'passed', {});

  // ── DERIVATION — the deep hierarchy (root → sections → segments → chain) ──
  const nodes: MindMapResult['nodes'] = [{ id: 'root', kind: 'root', label: title || 'untitled' }];
  const edges: MemEdge[] = [];
  const E = (src: string, dst: string, kind: MemEdge['kind'], weight = 1) => {
    edges.push({ src, dst, kind, weight });
    emit(kind === 'assoc' ? 'recognition' : 'derivation', 'edge', { src, dst, kind, weight: Number(weight.toFixed(3)) });
  };
  const toks: Set<string>[] = [];
  for (let i = 0; i < segs.length; i++) {
    const sec = Math.floor(i / SECTION_SIZE);
    const secId = `sec${sec}`;
    if (i % SECTION_SIZE === 0) {
      nodes.push({ id: secId, kind: 'section', label: `section ${sec + 1}` });
      emit('derivation', 'node', { id: secId, kind: 'section' });
      E('root', secId, 'about');
    }
    const id = `s${i}`;
    nodes.push({ id, kind: 'segment', label: segs[i].text.slice(0, 60), t0: segs[i].t0 });
    emit('derivation', 'node', { id, kind: 'segment', t0: segs[i].t0 });
    E(secId, id, 'derived');
    if (i > 0) E(`s${i - 1}`, id, 'causal');
    toks.push(tokens(segs[i].text));
  }

  // ── RECOGNITION — distant callbacks close loops (the flower side) ──
  let recogCount = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + RECOG_MIN_GAP; j < segs.length; j++) {
      const sim = jaccard(toks[i], toks[j]);
      if (sim >= RECOG_THRESHOLD) { E(`s${i}`, `s${j}`, 'assoc', Number(sim.toFixed(3))); recogCount++; }
    }
  }
  emit('recognition', 'summary', { recognition_edges: recogCount });

  // ── BIMODAL — content channel vs the clock channel, κ + the grounding gate ──
  const novelty: number[] = [0];
  for (let i = 1; i < segs.length; i++) novelty.push(1 - jaccard(toks[i - 1], toks[i]));
  const rate = segs.map((s) => {
    const dur = Math.max(0.5, (s.t1 ?? s.t0 + 1) - s.t0);
    return s.text.split(/\s+/).filter(Boolean).length / dur;
  });
  const kappa = segs.length >= 4 ? harmonicCoherence(novelty, rate) : 0;
  const grounding = segs.length >= 4
    ? groundingGate(novelty, novelty.slice(1).concat(novelty[novelty.length - 1]), rate).verdict
    : ('incoherent' as GroundingVerdict);
  emit('bimodal', 'channels', {
    kappa: Number(kappa.toFixed(4)), grounding,
    note: 'semantic novelty vs words-per-second from real timestamps — the temporal channel is world-coupled (the video clock), so κ here is content↔delivery lock, not self-agreement',
  });

  // ── COHERENCE — the measured payoff of the recognition layer on THIS input ──
  const coherence = coherenceReport(edges);
  emit('coherence', 'report', {
    path_len_gain: coherence.path_len_gain, reach_gain: coherence.reach_gain,
    is_small_world_shortcut: coherence.is_small_world_shortcut,
    hierarchy_edges: coherence.hierarchy_edges, coherence_edges: coherence.coherence_edges,
  });

  // ── REGULATE — the invariants held over the measured state ──
  const c = {
    structural: coherence.full.reachable_fraction,
    relational: coherence.full.within_2_fraction,
    harmonic: kappa,
  };
  const reg = regulate(c, { perturb: 0 });
  emit('regulate', 'converged', { start: c, F0: reg.F0, F_final: reg.final.F, converged: reg.converged });

  // ── OUTFLOW ──
  emit('outflow', 'done', {
    ok: true, nodes: nodes.length, edges: edges.length,
    recognition_edges: recogCount, kappa: Number(kappa.toFixed(4)), grounding,
    path_len_gain: coherence.path_len_gain,
  });

  return {
    ok: true, title, nodes, edges, kappa: Number(kappa.toFixed(6)), grounding,
    coherence, regulator: { converged: reg.converged, F0: reg.F0, F_final: reg.final.F }, trace,
  };
}

// ── YouTube captions → segments (impure helper, kept out of the core) ──
// Parses the timedtext XML YouTube serves for videos with captions. Fails loud
// when a video has none — no silent empty result.
export function parseTimedText(xml: string): Segment[] {
  const out: Segment[] = [];
  const re = /<text start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const t0 = parseFloat(m[1]);
    const dur = m[2] ? parseFloat(m[2]) : 2;
    const text = m[3]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
    if (text) out.push({ t0, t1: t0 + dur, text });
  }
  return out;
}

export function youtubeVideoId(url: string): string | null {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export async function fetchYouTubeSegments(videoId: string): Promise<Segment[]> {
  const res = await fetch(`https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=en`);
  if (!res.ok) throw new Error(`timedtext fetch failed (${res.status}) — video may have no public captions`);
  const xml = await res.text();
  const segs = parseTimedText(xml);
  if (!segs.length) throw new Error('no captions found for this video (timedtext empty)');
  return segs;
}
