import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.js';

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bridge-'));
  store = new Store(join(dir, 'board.json'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('task lifecycle', () => {
  it('runs the full architect → worker → review handoff', () => {
    const t = store.createTask({ title: 'Do the thing', brief: 'Full spec here', priority: 'high' });
    expect(t.status).toBe('open');
    expect(t.seq).toBe(1);

    const claimed = store.claimNext('worker');
    expect(claimed?.id).toBe(t.id);
    expect(claimed?.status).toBe('claimed');

    store.progress(t.id, 'worker', 'halfway');
    const submitted = store.submit(t.id, 'worker', 'done', [{ label: 'file', value: 'x.ts' }]);
    expect(submitted.status).toBe('submitted');

    const reviewed = store.review(t.id, 'request_changes', 'fix the edge case');
    expect(reviewed.status).toBe('changes_requested');

    // request_changes puts it back in the claim queue
    const reclaimed = store.claimNext('worker');
    expect(reclaimed?.id).toBe(t.id);

    store.submit(t.id, 'worker', 'fixed');
    const approved = store.review(t.id, 'approve', 'lgtm');
    expect(approved.status).toBe('approved');
  });

  it('claims by priority then age', () => {
    store.createTask({ title: 'low old', brief: 'a', priority: 'low' });
    store.createTask({ title: 'urgent new', brief: 'b', priority: 'urgent' });
    const first = store.claimNext('worker');
    expect(first?.title).toBe('urgent new');
  });

  it('returns null when nothing is claimable', () => {
    expect(store.claimNext('worker')).toBeNull();
  });

  it('does not hand one role a task assigned to another', () => {
    store.createTask({ title: 'for observer', brief: 'x', assignee_role: 'observer' });
    expect(store.claimNext('worker')).toBeNull();
  });
});

describe('inbox polling', () => {
  it('returns only events after the cursor and scopes by role', () => {
    const t = store.createTask({ title: 'T', brief: 'spec' }); // architect: 'created'
    const created = store.getTask(t.id).events[0];

    // worker sees the 'created' brief
    const workerInbox = store.inbox({ forRole: 'worker' });
    expect(workerInbox.map((e) => e.kind)).toContain('created');

    // after the created event, nothing new yet for the worker
    expect(store.inbox({ forRole: 'worker', since: created.ts })).toHaveLength(0);

    // worker submits → architect should now see it
    store.claimNext('worker');
    store.submit(t.id, 'worker', 'done');
    const archInbox = store.inbox({ forRole: 'architect' });
    expect(archInbox.map((e) => e.kind)).toContain('submitted');
    // 'claimed' is not something the architect must act on
    expect(archInbox.map((e) => e.kind)).not.toContain('claimed');
  });
});

describe('durability', () => {
  it('reloads the board from disk', () => {
    const path = join(dir, 'persist.json');
    const a = new Store(path);
    const t = a.createTask({ title: 'persist me', brief: 'b' });
    const b = new Store(path);
    expect(b.getTask(t.id).title).toBe('persist me');
  });
});
