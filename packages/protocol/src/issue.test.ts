import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issueUrl, ISSUES_NEW, MAX_ENCODED_BODY } from './issue';

const report = (log: string) => ({
  app: 'controller',
  version: '0.8.0',
  details: ['Android 14 (API 34), Test Phone', 'Language it'],
  log,
});

const bodyOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get('body') ?? '');

test('the link points at the project and names the app and version in the title', () => {
  const url = issueUrl(report('a line'));
  assert.ok(url.startsWith(`${ISSUES_NEW}?`));
  assert.equal(new URL(url).searchParams.get('title'), '[controller 0.8.0] ');
});

test('details and the newest log lines are in the body, in English whatever the app language', () => {
  const body = bodyOf(issueUrl(report('first\nsecond')));
  assert.match(body, /\*\*What happened\?\*\*/);
  assert.match(body, /- Android 14 \(API 34\), Test Phone/);
  assert.match(body, /first\nsecond/);
});

test('a long log is cut to its newest lines and the link still fits', () => {
  const log = Array.from({ length: 500 }, (_, i) => `10-24 12:00:00.${String(i).padStart(3, '0')} I/x: line ${i} ${'y'.repeat(80)}`).join('\n');
  const url = issueUrl(report(log));
  const body = bodyOf(url);
  assert.ok(encodeURIComponent(body).length <= MAX_ENCODED_BODY);
  assert.ok(url.length < 8000);
  assert.match(body, /line 499 /);
  assert.ok(!body.includes('line 0 '));
  assert.match(body, /of 500 lines/);
});

test('a log that cannot fit at all points at the clipboard instead', () => {
  const body = bodyOf(issueUrl({ ...report('x'.repeat(10)), details: ['d'.repeat(MAX_ENCODED_BODY)] }));
  assert.match(body, /clipboard/);
  assert.ok(!body.includes('```'));
});
