import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentIndex, type NavEntry, planApplies, stepIndex } from './nav';

const entry = (label: string, current = false): NavEntry => ({ label, href: `https://x.test/play/${label}`, current });

test('the marked entry is the current one', () => {
  assert.equal(currentIndex([entry('1'), entry('2', true), entry('3')], 'https://x.test/play/1'), 1);
});

test('without a marker the page url decides, ignoring the fragment', () => {
  assert.equal(currentIndex([entry('1'), entry('2')], 'https://x.test/play/2#player'), 1);
});

test('an unknown current entry stays unknown', () => {
  assert.equal(currentIndex([entry('1')], 'https://x.test/other'), null);
});

test('steps stop at both ends and never guess', () => {
  assert.equal(stepIndex(3, 1, 1), 2);
  assert.equal(stepIndex(3, 2, 1), null);
  assert.equal(stepIndex(3, 0, -1), null);
  assert.equal(stepIndex(3, null, 1), null);
});

test('a plan applies by path, and a broken regex applies nowhere', () => {
  assert.equal(planApplies({ paths: '^/play/' }, '/play/x'), true);
  assert.equal(planApplies({ paths: '^/play/' }, '/anime/x'), false);
  assert.equal(planApplies({}, '/anything'), true);
  assert.equal(planApplies({ paths: '(' }, '/x'), false);
});
