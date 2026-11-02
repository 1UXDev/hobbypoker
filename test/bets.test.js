import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quickBets} from '../public/bets.js';

test('unopened street presets use half pot, pot and disable 2x absent bet', () => {
  const bets = quickBets({current: 0, minRaise: 20, pot: 100}, {bet: 0, chips: 1000});
  assert.deepEqual(bets.map(b => b.amount), [50, 100, 20]);
  assert.deepEqual(bets.map(b => b.disabled), [false, false, true]);
});
test('pot-sized raises include the call and represent total street targets', () => {
  const bets = quickBets({current: 40, minRaise: 20, pot: 100}, {bet: 10, chips: 990});
  assert.deepEqual(bets.map(b => b.amount), [105, 170, 80]);
});
test('presets clamp to full minimum raise and stack, disabling short raises', () => {
  assert.deepEqual(quickBets({current: 20, minRaise: 20, pot: 30}, {bet: 10, chips: 990}).map(b => b.amount), [40, 60, 40]);
  assert.deepEqual(quickBets({current: 50, minRaise: 30, pot: 500}, {bet: 20, chips: 80}).map(b => b.amount), [100, 100, 100]);
  assert.ok(quickBets({current: 100, minRaise: 50, pot: 500}, {bet: 20, chips: 60}).every(b => b.disabled));
});
