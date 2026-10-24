import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scrub } from './log';

test('the pair code, its secret and its room never survive scrubbing', () => {
  const secrets = ['cielo-lento-42', 'a1b2c3d4e5f6'];
  const line = '01-02 03:04:05.006 I/offscreen: room a1b2c3d4e5f6 for cielo-lento-42, again cielo-lento-42';
  const out = scrub(line, secrets);
  assert.ok(!out.includes('cielo-lento-42'));
  assert.ok(!out.includes('a1b2c3d4e5f6'));
  assert.equal(out.split('‹hidden›').length - 1, 3);
});

test('nothing to hide leaves a line alone', () => {
  assert.equal(scrub('plain line', []), 'plain line');
});

test('lines sort by time because the stamp has a fixed width', () => {
  const lines = ['10-24 21:30:08.411 D/a: later', '10-24 09:05:01.002 D/b: earlier'];
  assert.deepEqual([...lines].sort().map((l) => l.split(': ')[1]), ['earlier', 'later']);
});
