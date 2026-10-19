import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clock, DEFAULT_JUMP_PRESETS, DEFAULT_JUMP_SECONDS, jumpLabel, parseJump } from './jump';

test('parseJump reads the forms the remote accepts', () => {
  assert.equal(parseJump('45'), 45);
  assert.equal(parseJump('45s'), 45);
  assert.equal(parseJump('2m'), 120);
  assert.equal(parseJump('2 min'), 120);
  assert.equal(parseJump('1:30'), 90);
  assert.equal(parseJump('1:02:05'), 3725);
  assert.equal(parseJump('1h'), 3600);
  assert.equal(parseJump('1,5m'), 90);
  assert.equal(parseJump('2 ore'), 7200);
});

test('parseJump refuses nonsense, zero and more than a day', () => {
  for (const bad of ['', 'abc', '0', '0:00', '-5', '25h', '1:2:3:4', '25:00:00', '0h0m']) assert.equal(parseJump(bad), null, bad);
});

test('parseJump combines hours, minutes and seconds', () => {
  assert.equal(parseJump('1h30m30s'), 5430);
  assert.equal(parseJump('1h 30m 30s'), 5430);
  assert.equal(parseJump('1h30m'), 5400);
  assert.equal(parseJump('1h 30m'), 5400);
  assert.equal(parseJump('90m'), 5400);
  assert.equal(parseJump('1m30s'), 90);
  assert.equal(parseJump('1m 30'), 90);
  assert.equal(parseJump('2h5s'), 7205);
  assert.equal(parseJump('30s1m'), 90, 'any order');
  assert.equal(parseJump('1.5h'), 5400);
  assert.equal(parseJump('2 ore 5 minuti'), 7500);
  assert.equal(parseJump('1 ora 30 minuti 10 secondi'), 5410);
  assert.equal(parseJump('1:30:30'), 5430, 'clock form: h:mm:ss');
  assert.equal(parseJump('24h'), 86_400);
});

test('a number with no unit takes the next smaller one, only at the end', () => {
  assert.equal(parseJump('1h30'), 5400);
  assert.equal(parseJump('1h30m30'), 5430);
  assert.equal(parseJump('1m30'), 90);
  assert.equal(parseJump('45'), 45);
  for (const bad of ['30s5', '4 5', '1 30m', '1h30 5']) assert.equal(parseJump(bad), null, bad);
});

test('parseJump refuses a unit twice, an unknown unit, and a unit alone', () => {
  for (const bad of ['1m1m', '1h1h', '5 meters', '1x', 'h', 'm30', '1h30x', '1h 1m 1s 1s']) assert.equal(parseJump(bad), null, bad);
});

test('what a label says reads back as the same amount', () => {
  for (const s of [10, 59, 60, 90, 300, 3599, 3600, 3660, 5400, 5430, 7205, 86_400]) {
    const label = jumpLabel(s);
    assert.equal(parseJump(label), s, `${s} → "${label}"`);
  }
});

test('the default amounts are the ones every app starts with', () => {
  assert.deepEqual(DEFAULT_JUMP_PRESETS.map(jumpLabel), ['10s', '15s', '1m', '1m30s', '5m', '10m']);
  assert.ok(DEFAULT_JUMP_PRESETS.includes(DEFAULT_JUMP_SECONDS));
  assert.ok(DEFAULT_JUMP_PRESETS.every((s) => parseJump(String(s)) === s));
});

test('jumpLabel and clock', () => {
  assert.equal(jumpLabel(10), '10s');
  assert.equal(jumpLabel(60), '1m');
  assert.equal(jumpLabel(90), '1m30s');
  assert.equal(jumpLabel(300), '5m');
  assert.equal(jumpLabel(3600), '1h');
  assert.equal(jumpLabel(5400), '1h30m');
  assert.equal(jumpLabel(3660), '1h1m');
  assert.equal(jumpLabel(5430), '1h30m30s');
  assert.equal(jumpLabel(3601), '1h1s');
  assert.equal(jumpLabel(7200), '2h');
  assert.equal(jumpLabel(3599), '59m59s');
  assert.equal(jumpLabel(600), '10m');
  assert.equal(clock(75), '1:15');
  assert.equal(clock(3725), '1:02:05');
});
