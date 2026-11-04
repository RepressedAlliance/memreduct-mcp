// The hook's decisions, without touching memory or Mem Reduct. npm run test:policy
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, describe, isHeavy, isMemoryError } from '../src/policy.js';

const MIN = 60000;
const base = { totalMB: 16000, now: 100 * MIN, session: 's1', state: {} };
const run = (over) => decide({ ...base, event: 'PostToolBatch', availMB: 8000, ...over });

test('plenty of memory: nothing happens', () => {
  assert.equal(run({}).action, 'none');
  assert.equal(run({ event: 'PreToolUse', toolName: 'Agent' }).action, 'none');
});

test('before heavy work below 25%: clean', () => {
  const r = run({ event: 'PreToolUse', toolName: 'Agent', availMB: 3500 });
  assert.deepEqual([r.action, r.kind], ['clean', 'before-job']);
});

test('light tool below 25%: no clean', () => {
  assert.equal(run({ event: 'PreToolUse', toolName: 'Bash', toolInput: { command: 'ls' }, availMB: 3500 }).action, 'none');
});

test('what counts as heavy', () => {
  assert.ok(isHeavy('Workflow'));
  assert.ok(isHeavy('mcp__resource-care__start_process'));
  assert.ok(isHeavy('Bash', { command: 'sleep 1', run_in_background: true }));
  assert.ok(isHeavy('Bash', { command: '"/c/Program Files/Blender Foundation/blender.exe" -b x' }));
  assert.ok(isHeavy('PowerShell', { command: 'npm run build' }));
  assert.ok(!isHeavy('Bash', { command: 'git status' }));
  assert.ok(!isHeavy('Read', { file_path: 'blender.txt' }));
});

test('recent clean and still short: says it did not hold, does not clean again', () => {
  const state = { lastClean: base.now - 2 * MIN };
  const r = run({ event: 'PreToolUse', toolName: 'Agent', availMB: 1500, state });
  assert.deepEqual([r.action, r.kind], ['remind', 'did-not-hold']);
  assert.equal(run({ availMB: 500, state }).kind, 'did-not-hold');
});

test('recent clean, between warn and need: stays quiet', () => {
  assert.equal(run({ event: 'PreToolUse', toolName: 'Agent', availMB: 3000, state: { lastClean: base.now - MIN } }).action, 'none');
});

test('critical at any step: clean', () => {
  const r = run({ availMB: 800 });
  assert.deepEqual([r.action, r.kind], ['clean', 'critical']);
});

test('a brief dip is ignored; a dip that lasts reminds once per session', () => {
  const first = run({ availMB: 2000 });
  assert.equal(first.action, 'none');
  const later = run({ availMB: 2000, now: base.now + 40000, state: first.state });
  assert.deepEqual([later.action, later.kind], ['remind', 'low']);
  const soon = run({ availMB: 2000, now: base.now + 2 * MIN, state: later.state });
  assert.equal(soon.action, 'none');
  const other = run({ availMB: 2000, now: base.now + 2 * MIN, session: 's2', state: later.state });
  assert.equal(other.action, 'remind');
});

test('a low reading from long ago does not count toward the debounce', () => {
  const r = run({ availMB: 2000, state: { lowSince: base.now - 60 * MIN, lastLowAt: base.now - 30 * MIN } });
  assert.equal(r.action, 'none');
});

test('still low: reminds again after 15 minutes', () => {
  const state = { lowSince: base.now - 20 * MIN, lastLowAt: base.now - MIN, sessions: { s1: { lastWarn: base.now - 16 * MIN } } };
  assert.equal(run({ availMB: 2000, state }).action, 'remind');
  state.sessions.s1.lastWarn = base.now - 5 * MIN;
  assert.equal(run({ availMB: 2000, state }).action, 'none');
});

test('after recovering above 25%, reminds again right away', () => {
  const low = { lowSince: base.now - 5 * MIN, lastLowAt: base.now - MIN, sessions: { s1: { lastWarn: base.now - 2 * MIN } } };
  const up = run({ availMB: 5000, state: low });
  assert.equal(up.action, 'none');
  assert.equal(up.state.lowSince, undefined);
  const dip = run({ availMB: 2000, now: base.now + MIN, state: up.state });
  const stays = run({ availMB: 2000, now: base.now + 2 * MIN, state: dip.state });
  assert.equal(stays.action, 'remind');
});

test('steady memory writes no state', () => {
  const r1 = run({});
  assert.notEqual(r1.state, base.state);
  const r2 = run({ state: r1.state });
  assert.equal(r2.state, r1.state);
});

test('out-of-memory failure: clean, or say it did not hold', () => {
  const r = run({ event: 'PostToolUseFailure', toolName: 'Bash', error: 'Exit code 1\nMemoryError' });
  assert.deepEqual([r.action, r.kind], ['clean', 'after-oom']);
  const again = run({ event: 'PostToolUseFailure', toolName: 'Bash', error: 'std::bad_alloc', state: { lastClean: base.now - MIN } });
  assert.deepEqual([again.action, again.kind], ['remind', 'oom-did-not-hold']);
  assert.equal(run({ event: 'PostToolUseFailure', toolName: 'Bash', error: 'Exit code 1\nNot found' }).action, 'none');
});

test('GPU memory errors are not system RAM', () => {
  assert.ok(!isMemoryError('RuntimeError: CUDA out of memory'));
  assert.ok(!isMemoryError('NVIDIA Cg C9008 out of memory'));
  assert.ok(isMemoryError('JavaScript heap out of memory'));
  assert.ok(isMemoryError('The paging file is too small for this operation'));
});

test('a clean that gained nothing says so', () => {
  const text = describe('no-gain', { beforeMB: 1900, afterMB: 800, totalMB: 16000 });
  assert.match(text, /in active use/);
  assert.doesNotMatch(text, /cleaned RAM/);
});
