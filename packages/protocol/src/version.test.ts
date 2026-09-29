import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, parseRelease, releaseSummary } from './version';

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
    assert.ok(compareVersions('v1.2.3', '1.2.4') < 0);
    assert.equal(compareVersions('v0.2.1', '0.2.1'), 0);
    assert.equal(compareVersions('1.2', '1.2.0'), 0);
  });

  it('puts a pre-release below the release', () => {
    assert.ok(compareVersions('0.3.0-beta.1', '0.3.0') < 0);
    assert.ok(compareVersions('0.3.0', '0.3.0-beta.1') > 0);
    assert.ok(compareVersions('0.3.0-beta.1', '0.2.9') > 0);
  });
});

describe('parseRelease', () => {
  it('flags breaking and security releases as important', () => {
    const base = { tag_name: 'v0.3.0', html_url: 'u', published_at: 'd' };
    assert.equal(parseRelease({ ...base, body: '- **BREAKING** new protocol' }).important, true);
    assert.equal(parseRelease({ ...base, body: 'Fixes a security issue' }).important, true);
    assert.equal(parseRelease({ ...base, body: '- faster seek' }).important, false);
    assert.equal(parseRelease(base).version, '0.3.0');
  });
});

describe('releaseSummary', () => {
  it('uses only the highlights when there are some, without markdown', () => {
    const notes = "## Highlights\n\n- **iPhone** remote\n- image `x/y` renamed\n\n## What's changed\n\n- **x:** y (abc1234)\n\n## Downloads\n\n- not this";
    assert.deepEqual(releaseSummary(notes), ['iPhone remote', 'image x/y renamed']);
  });

  it('falls back to the changelog, without commit hashes', () => {
    const notes = "## What's changed\n\n### Fixes\n\n- **x:** y (abc1234)\n\n## Downloads\n\n- not this";
    assert.deepEqual(releaseSummary(notes), ['x: y']);
  });

  it('joins a bullet that wraps onto indented lines', () => {
    const notes = '## Highlights\n\n- **Store zip.** Releases now\n  include it.\n- Two\n\n  not a continuation';
    assert.deepEqual(releaseSummary(notes), ['Store zip. Releases now include it.', 'Two']);
  });
});
