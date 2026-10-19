import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  actionFor,
  addPreset,
  addToRun,
  fraction,
  landing,
  neighbours,
  STYLES,
  wantsHint,
  boundTo,
  chips,
  comboFromEvent,
  comboProblem,
  DEFAULT_BINDINGS,
  DEFAULT_PANEL,
  formatCombo,
  hostOff,
  jumpCommand,
  type KeyLike,
  normalizePanel,
  parseCombo,
  removePreset,
  setHostOff,
  siteKeys,
  stepAmount,
} from './panel';
import { jumpLabel } from '@relay/protocol';
import sites from './sites.json';

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  code,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

test('a jump is the same command the phone sends', () => {
  assert.deepEqual(jumpCommand(1, 30), { op: 'playback.seek', deltaMs: 30_000 });
  assert.deepEqual(jumpCommand(-1, 90), { op: 'playback.seek', deltaMs: -90_000 });
});

test('settings survive anything storage hands back', () => {
  assert.deepEqual(normalizePanel(undefined), DEFAULT_PANEL);
  assert.deepEqual(normalizePanel('junk'), DEFAULT_PANEL);
  const p = normalizePanel({
    overlay: 'sideways',
    keys: false,
    presets: [60, 10, 10, -3, 'x', 1.5, 999_999],
    selected: 'many',
    bindings: { back: 'Alt+Shift+KeyJ', forward: 'nonsense', overlay: 42 },
    offHosts: ['a.test', 7, ''],
  });
  assert.equal(p.overlay, 'hover');
  assert.equal(p.keys, false);
  assert.deepEqual(p.presets, [10, 60]);
  assert.equal(p.selected, DEFAULT_PANEL.selected);
  assert.equal(p.bindings.back, 'Alt+Shift+KeyJ');
  assert.equal(p.bindings.forward, DEFAULT_BINDINGS.forward);
  assert.equal(p.bindings.overlay, DEFAULT_BINDINGS.overlay);
  assert.deepEqual(p.offHosts, ['a.test']);
  assert.deepEqual(normalizePanel({ presets: [] }).presets, DEFAULT_PANEL.presets);
});

test('presets: sorted, unique, never empty', () => {
  assert.deepEqual(addPreset([10, 60], 30), [10, 30, 60]);
  assert.deepEqual(addPreset([10, 60], 60), [10, 60]);
  assert.deepEqual(addPreset([10], 0), [10]);
  assert.deepEqual(removePreset([10, 30], 10), [30]);
  assert.deepEqual(removePreset([30], 30), [30]);
  assert.deepEqual(chips({ presets: [10, 60], selected: 45 }), [10, 45, 60]);
});

test('stepping the amount wraps, and steps from an unsaved amount', () => {
  assert.equal(stepAmount([10, 30, 60], 30, 1), 60);
  assert.equal(stepAmount([10, 30, 60], 60, 1), 10);
  assert.equal(stepAmount([10, 30, 60], 10, -1), 60);
  assert.equal(stepAmount([10, 60], 45, 1), 60);
  assert.equal(stepAmount([10, 60], 45, -1), 10);
});

test('hosts: subdomains follow their site', () => {
  assert.equal(hostOff(['youtube.com'], 'www.youtube.com'), true);
  assert.equal(hostOff(['youtube.com'], 'notyoutube.com'), false);
  assert.deepEqual(setHostOff(['b.test'], 'a.test', true), ['a.test', 'b.test']);
  assert.deepEqual(setHostOff(['a.test', 'b.test'], 'a.test', false), ['b.test']);
});

test('combinations: from an event, back to a string, and canonical only', () => {
  assert.equal(comboFromEvent(key('ArrowLeft', { altKey: true, shiftKey: true })), 'Alt+Shift+ArrowLeft');
  assert.equal(comboFromEvent(key('KeyS', { metaKey: true, ctrlKey: true })), 'Ctrl+Meta+KeyS');
  assert.equal(comboFromEvent(key('ShiftLeft', { shiftKey: true })), null);
  assert.equal(comboFromEvent(key('AltRight', { altKey: true })), null);
  assert.ok(parseCombo('Alt+Shift+ArrowLeft'));
  assert.equal(parseCombo('Shift+Alt+ArrowLeft'), null, 'modifiers out of order');
  assert.equal(parseCombo('Alt+Shift'), null);
  assert.equal(parseCombo('Hyper+KeyA'), null);
  assert.equal(parseCombo(''), null);
});

test('a combination is read back as typed', () => {
  assert.equal(formatCombo('Alt+Shift+ArrowLeft'), 'Alt + Shift + ←');
  assert.equal(formatCombo('Alt+Shift+KeyS'), 'Alt + Shift + S');
  assert.equal(formatCombo('Ctrl+Alt+Digit1'), 'Ctrl + Alt + 1');
  assert.equal(formatCombo('Alt+Shift+ArrowRight', true), '⌥ + ⇧ + →');
});

test('which combinations are poor choices', () => {
  assert.equal(comboProblem('KeyJ'), 'needsModifier');
  assert.equal(comboProblem('Shift+KeyJ'), 'needsModifier');
  assert.equal(comboProblem('Ctrl+Alt+KeyJ'), 'altGr');
  assert.equal(comboProblem('Ctrl+KeyW'), 'browser');
  assert.equal(comboProblem('Alt+ArrowLeft'), 'browser');
  assert.equal(comboProblem('Alt+Shift+ArrowLeft'), null);
  assert.equal(comboProblem('Ctrl+Alt+Meta+KeyJ'), null);
  for (const c of Object.values(DEFAULT_BINDINGS)) assert.equal(comboProblem(c), null, c);
});

test('the defaults are distinct and clear of every site shortcut we list', () => {
  const bound = Object.values(DEFAULT_BINDINGS);
  assert.equal(new Set(bound).size, bound.length);
  for (const host of Object.keys(sites).filter((d) => !d.startsWith('_'))) {
    for (const c of siteKeys(sites as Record<string, { keys?: string[] }>, host)) {
      assert.ok(parseCombo(c), `${host}: ${c} is not a canonical combination`);
      assert.ok(!bound.includes(c), `${host} already uses ${c}`);
    }
  }
});

test('siteKeys follows subdomains and ignores comments', () => {
  const s = { 'twitch.tv': { keys: ['Alt+KeyT'] }, _comment: { keys: ['Alt+KeyZ'] } };
  assert.deepEqual(siteKeys(s, 'www.twitch.tv'), ['Alt+KeyT']);
  assert.deepEqual(siteKeys(s, 'example.com'), []);
});

test('a key press means an action only when its combination is bound and shortcuts are on', () => {
  assert.equal(actionFor(DEFAULT_PANEL, key('ArrowLeft', { altKey: true, shiftKey: true })), 'back');
  assert.equal(actionFor(DEFAULT_PANEL, key('ArrowLeft', { altKey: true })), null);
  assert.equal(actionFor(DEFAULT_PANEL, key('ArrowLeft')), null, 'a bare arrow belongs to the site');
  assert.equal(actionFor({ ...DEFAULT_PANEL, keys: false }, key('ArrowLeft', { altKey: true, shiftKey: true })), null);
  assert.equal(boundTo(DEFAULT_BINDINGS, 'Alt+Shift+KeyS'), 'overlay');
  assert.equal(boundTo(DEFAULT_BINDINGS, 'Alt+Shift+KeyS', 'overlay'), null);
});

test('the style falls back to the edge pills, and the hint counters to zero', () => {
  assert.equal(DEFAULT_PANEL.style, 'pills');
  assert.equal(normalizePanel({ style: 'gesture' }).style, 'gesture');
  assert.equal(normalizePanel({ style: 'neon' }).style, 'pills');
  assert.deepEqual(normalizePanel({ hints: { shown: -2, done: 'yes' } }).hints, { shown: 0, done: false });
  assert.deepEqual(normalizePanel({ hints: { shown: 2, done: true } }).hints, { shown: 2, done: true });
  assert.equal(STYLES.length, 4);
});

test('a picker shows the amounts either side and does not wrap', () => {
  assert.deepEqual(neighbours({ presets: [10, 30, 60], selected: 30 }), { lower: 10, higher: 60 });
  assert.deepEqual(neighbours({ presets: [10, 30, 60], selected: 10 }), { lower: null, higher: 30 });
  assert.deepEqual(neighbours({ presets: [10, 30, 60], selected: 60 }), { lower: 30, higher: null });
  assert.deepEqual(neighbours({ presets: [10, 60], selected: 45 }), { lower: 10, higher: 60 });
});

test('the tip is shown at most three times, and never once the feature has been used', () => {
  assert.equal(wantsHint({ hints: { shown: 0, done: false } }), true);
  assert.equal(wantsHint({ hints: { shown: 2, done: false } }), true);
  assert.equal(wantsHint({ hints: { shown: 3, done: false } }), false);
  assert.equal(wantsHint({ hints: { shown: 0, done: true } }), false);
});

test('quick jumps in one direction add up; a pause or a turn starts over', () => {
  const a = addToRun(null, 1, 30, 1000, 1200);
  assert.deepEqual(a, { dir: 1, seconds: 30, at: 1000, fresh: true });
  const b = addToRun(a, 1, 30, 1900, 1200);
  assert.deepEqual(b, { dir: 1, seconds: 60, at: 1900, fresh: false });
  assert.equal(addToRun(b, -1, 30, 2000, 1200).seconds, 30);
  assert.equal(addToRun(b, 1, 30, 3500, 1200).fresh, true);
});

test('position along a video and where a jump lands', () => {
  assert.equal(fraction(30_000, 120_000), 0.25);
  assert.equal(fraction(-5, 100), 0);
  assert.equal(fraction(500, 100), 1);
  assert.equal(fraction(null, 100), null);
  assert.equal(fraction(10, 0), null);
  assert.equal(landing(10_000, 30_000, 100_000), 40_000);
  assert.equal(landing(10_000, -30_000, 100_000), 0);
  assert.equal(landing(90_000, 30_000, 100_000), 99_750);
  assert.equal(landing(10_000, 30_000, null), 40_000);
});

test('the default amounts: 10s, 15s, 1m, 1m30s, 5m, 10m, starting at 10s', () => {
  assert.deepEqual(DEFAULT_PANEL.presets.map(jumpLabel), ['10s', '15s', '1m', '1m30s', '5m', '10m']);
  assert.equal(DEFAULT_PANEL.selected, 10);
  assert.deepEqual(chips(DEFAULT_PANEL), DEFAULT_PANEL.presets);
  assert.deepEqual(normalizePanel({}).presets, DEFAULT_PANEL.presets);
});
