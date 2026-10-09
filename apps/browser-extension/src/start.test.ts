import assert from 'node:assert/strict';
import { test } from 'node:test';
import sites from './sites.json';
import {
  DEFAULT_START_WAIT_MS,
  isPlayerFrame,
  needsPlayer,
  popupTabs,
  type StartPlan,
  startedFrames,
  startPlanFor,
  startWaitMs,
} from './start';

const plan: StartPlan = { paths: '^/play/', click: '#cover', player: '^https://x\\.test/api/player' };

test('a start plan applies by path, and only with a control to click', () => {
  assert.equal(startPlanFor(plan, 'https://x.test/play/ep-1'), plan);
  assert.equal(startPlanFor(plan, 'https://x.test/anime/ep-1'), null);
  assert.equal(startPlanFor(undefined, 'https://x.test/play/ep-1'), null);
  assert.equal(startPlanFor({ click: '' }, 'https://x.test/play/ep-1'), null);
  assert.equal(startPlanFor(plan, 'not a url'), null);
});

test('only playback and entering fullscreen start a player', () => {
  for (const op of ['playback.playPause', 'playback.seek', 'playback.seekTo', 'fullscreen.enter']) assert.equal(needsPlayer(op), true, op);
  for (const op of ['nav.step', 'nav.goto', 'device.status', 'fullscreen.exit']) assert.equal(needsPlayer(op), false, op);
});

test('the player frame is recognised by its url, a broken regex recognises nothing', () => {
  assert.equal(isPlayerFrame(plan, 'https://x.test/api/player?id=1'), true);
  assert.equal(isPlayerFrame(plan, 'https://ads.test/banner'), false);
  assert.equal(isPlayerFrame({ click: '#c', player: '(' }, 'https://x.test/api/player'), false);
  assert.equal(isPlayerFrame(null, 'https://x.test/api/player'), false);
});

test('an ad already playing is not the player appearing', () => {
  const ad = { frameId: 3, url: 'https://ads.test/banner', hasMedia: true };
  const player = { frameId: 7, url: 'https://x.test/api/player?id=1', hasMedia: true };
  const top = { frameId: 0, url: 'https://x.test/play/ep-1', hasMedia: false };
  assert.deepEqual(startedFrames(plan, new Set([3]), [top, ad]), []);
  assert.deepEqual(startedFrames(plan, new Set([3]), [top, ad, player]), [player]);
  // Without a player regex, a frame that gained media is the player.
  const plain: StartPlan = { click: '#cover' };
  const fresh = { frameId: 9, url: 'https://cdn.test/embed', hasMedia: true };
  assert.deepEqual(startedFrames(plain, new Set([3]), [top, ad, fresh]), [fresh]);
});

test('popups are new tabs opened by the page, nothing else', () => {
  const before = new Set([1, 2]);
  assert.deepEqual(popupTabs(before, [{ id: 1 }, { id: 2 }, { id: 5, openerTabId: 2 }, { id: 6 }, { id: 7, openerTabId: 1 }], 2), [5]);
});

test('the wait is bounded', () => {
  assert.equal(startWaitMs({ click: '#c' }), DEFAULT_START_WAIT_MS);
  assert.equal(startWaitMs({ click: '#c', waitMs: 10 ** 9 }), 15_000);
  assert.equal(startWaitMs({ click: '#c', waitMs: -5 }), 0);
});

test('the shipped animeworld plan is well formed', () => {
  const aw = (sites as unknown as Record<string, { start?: StartPlan }>)['animeworld.ac']?.start;
  assert.ok(startPlanFor(aw, 'https://www.animeworld.ac/play/chainsmoker-cat-ita.quc1Q/HL20PjNyUr'));
  assert.equal(isPlayerFrame(aw, 'https://www.animeworld.ac/api/episode/serverPlayerAnimeWorld?id=HL20PjNyUr'), true);
  assert.equal(isPlayerFrame(aw, 'https://ad.a-ads.com/2445450/?size=300x250'), false);
});
