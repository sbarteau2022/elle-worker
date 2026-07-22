import { describe, it, expect } from 'vitest';
import { assertCorpusScope, EMBEDDING_DIMS, RERANK_STRATEGY } from './config';

describe('assertCorpusScope', () => {
  it('accepts corpus_public', () => {
    expect(() => assertCorpusScope('corpus_public')).not.toThrow();
  });

  it('rejects any user scope — there is no per-user corpus data yet', () => {
    expect(() => assertCorpusScope('user:abc123')).toThrow(/only serves the public corpus/);
  });
});

describe('retrieval constants', () => {
  it('embedding dims match the confirmed bge-large-en-v1.5 contract', () => {
    expect(EMBEDDING_DIMS).toBe(1024);
  });

  it('reranker defaults to the llm fallback until Workers AI availability is confirmed', () => {
    expect(RERANK_STRATEGY).toBe('llm');
  });
});
