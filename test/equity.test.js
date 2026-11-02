import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimateEquity} from '../equity.js';

const c = (v, s) => ({v, s});
function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test('a private royal flush has 100% river equity against seven opponents', () => {
  const equity = estimateEquity({
    cards:[c(14,0),c(13,0)], board:[c(12,0),c(11,0),c(10,0),c(3,1),c(2,2)],
    opponents:7, samples:40,
  }, seeded(42));
  assert.equal(equity, 1);
});

test('a royal flush on the board splits equally among all players', () => {
  for (const opponents of [1, 3, 7]) {
    const equity = estimateEquity({
      cards:[c(2,1),c(3,1)], board:[c(14,0),c(13,0),c(12,0),c(11,0),c(10,0)],
      opponents, samples:40,
    }, seeded(9));
    assert.ok(Math.abs(equity - 1/(opponents+1)) < 1e-12);
  }
});

test('losing sampled runouts have zero equity', () => {
  // With constant zero, the remaining deck draws 2♠ then A♣ to the opponent.
  // Hero has a straight; villain's 2♠ completes the board's spade flush.
  const equity = estimateEquity({
    cards:[c(2,1),c(3,1)], board:[c(4,0),c(5,0),c(6,0),c(7,0),c(9,1)],
    opponents:1, samples:5,
  }, () => 0);
  assert.equal(equity, 0);
});

test('preflop sampling is deterministic with a seed and leaves inputs unchanged', () => {
  const input = {cards:[c(14,0),c(14,1)], board:[], opponents:1, samples:160};
  const before = JSON.stringify(input);
  const equity = estimateEquity(input, seeded(123));
  assert.equal(equity, estimateEquity(input, seeded(123)));
  assert.ok(equity > .65 && equity < .97, `AA equity was ${equity}`);
  assert.equal(JSON.stringify(input), before);
});

test('no remaining opponents means the entire pot share', () => {
  assert.equal(estimateEquity({cards:[c(2,0),c(3,1)], board:[], opponents:0}), 1);
});

test('rejects duplicate cards and unbounded or malformed inputs', () => {
  const base = {cards:[c(14,0),c(13,0)], board:[], opponents:1, samples:10};
  for (const invalid of [
    {cards:[c(14,0),c(14,0)]}, {cards:[c(1,0),c(13,0)]},
    {cards:[c(14,4),c(13,0)]}, {cards:[null,c(13,0)]},
    {board:[c(14,0),c(2,1),c(3,1)]}, {board:[c(2,0)]},
    {opponents:-1}, {opponents:8}, {opponents:NaN}, {opponents:1.5},
    {samples:0}, {samples:5001}, {samples:Infinity}, {samples:2.5},
  ]) assert.throws(() => estimateEquity({...base,...invalid}));
  for (const invalid of [-.1, 1, NaN, Infinity]) {
    assert.throws(() => estimateEquity(base, () => invalid));
  }
});
