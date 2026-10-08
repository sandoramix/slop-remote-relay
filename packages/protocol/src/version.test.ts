import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checksumFor, compareVersions, CONTROLLER_APK_PATTERN, findAsset, isCheckDue, parseRelease, releaseSummary } from './version';

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

describe('findAsset', () => {
  it('picks the controller APK, not the unsigned iOS build or the receiver', () => {
    const assets = ['relay-controller-0.3.0-unsigned.ipa', 'relay-receiver-0.3.0.apk', 'relay-controller-0.3.0.apk'].map(
      (name) => ({ name, url: `https://x/${name}`, size: 1 }),
    );
    assert.equal(findAsset(assets, CONTROLLER_APK_PATTERN)?.name, 'relay-controller-0.3.0.apk');
    assert.equal(findAsset(assets.slice(0, 2), CONTROLLER_APK_PATTERN), null);
  });
});

describe('checksumFor', () => {
  const h1 = 'a'.repeat(64);
  const h2 = 'B'.repeat(64);
  const sums = `${h1}  relay-receiver-0.3.0.apk\r\n${h2} *relay-controller-0.3.0.apk\n`;
  it('finds a file in sha256sum output, text or binary mode', () => {
    assert.equal(checksumFor(sums, 'relay-controller-0.3.0.apk'), 'b'.repeat(64));
    assert.equal(checksumFor(sums, 'relay-receiver-0.3.0.apk'), h1);
  });
  it('returns null for a file that is not listed', () => {
    assert.equal(checksumFor(sums, 'relay-controller-0.3.0-unsigned.ipa'), null);
  });
});

describe('isCheckDue', () => {
  const h = 3_600_000;
  it('is due when never checked or when the interval has passed', () => {
    assert.equal(isCheckDue(0, 1000 * h, 12 * h), true);
    assert.equal(isCheckDue(100 * h, 112 * h, 12 * h), true);
  });
  it('is not due inside the interval, and is due if the clock went backwards', () => {
    assert.equal(isCheckDue(100 * h, 111 * h, 12 * h), false);
    assert.equal(isCheckDue(100 * h, 50 * h, 12 * h), true);
  });
});
