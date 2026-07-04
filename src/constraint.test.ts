import { describe, it, expect } from 'vitest';
import { parseConstraint } from './constraint';

describe('parseConstraint', () => {
  it('parses a clean object', () => {
    const r = parseConstraint('{"bottleneck":"no test data","confidence":0.8,"missing_information":["schema"],"suggested_next_action":"seed a fixture"}');
    expect(r).not.toBeNull();
    expect(r!.bottleneck).toBe('no test data');
    expect(r!.confidence).toBe(0.8);
    expect(r!.missing_information).toEqual(['schema']);
    expect(r!.suggested_next_action).toBe('seed a fixture');
  });

  it('extracts the object from prose and code fences', () => {
    const raw = 'Here is my analysis:\n```json\n{"bottleneck":"the API is rate limited","confidence":0.6,"missing_information":[],"suggested_next_action":"add backoff"}\n```\nThat is the binding constraint.';
    const r = parseConstraint(raw);
    expect(r).not.toBeNull();
    expect(r!.bottleneck).toBe('the API is rate limited');
    expect(r!.missing_information).toEqual([]);
  });

  it('clamps confidence into 0..1 and defaults when non-numeric', () => {
    expect(parseConstraint('{"bottleneck":"x","confidence":5}')!.confidence).toBe(1);
    expect(parseConstraint('{"bottleneck":"x","confidence":-2}')!.confidence).toBe(0);
    expect(parseConstraint('{"bottleneck":"x","confidence":"high"}')!.confidence).toBe(0.5);
  });

  it('coerces a non-array missing_information to empty and caps at 8', () => {
    expect(parseConstraint('{"bottleneck":"x","missing_information":"nope"}')!.missing_information).toEqual([]);
    const many = JSON.stringify({ bottleneck: 'x', missing_information: Array.from({ length: 20 }, (_, i) => `m${i}`) });
    expect(parseConstraint(many)!.missing_information.length).toBe(8);
  });

  it('supplies a placeholder when no next action is given', () => {
    expect(parseConstraint('{"bottleneck":"x"}')!.suggested_next_action).toBe('(none suggested)');
  });

  it('returns null when there is no usable object or no bottleneck', () => {
    expect(parseConstraint('sorry, I cannot help')).toBeNull();
    expect(parseConstraint('{"confidence":0.9}')).toBeNull();
    expect(parseConstraint('{"bottleneck":"   "}')).toBeNull();
    expect(parseConstraint('')).toBeNull();
    expect(parseConstraint(null)).toBeNull();
  });
});
