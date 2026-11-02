import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bestFiveCards, replacementSlots} from '../public/winner-overlay.js';
import {rank, handName} from '../poker.js';

const card = (v, s) => ({v, s});
test('winner combination uses the actual two hole cards and three board cards', () => {
  const hole = [card(10, 1), card(11, 1)];
  const board = [card(7, 1), card(8, 1), card(9, 1), card(2, 0), card(3, 0)];
  const hand = bestFiveCards(hole, board);
  assert.equal(hand.length, 5);
  assert.equal(handName(rank(hand.map(entry => entry.card))), 'Straight Flush');
  assert.deepEqual(hand.filter(entry => entry.source === 'hole').map(entry => entry.card), hole);
  assert.deepEqual(hand.filter(entry => entry.source === 'board').map(entry => entry.card), board.slice(0, 3));
});
test('board-only royal flush correctly identifies no hole cards in the best five', () => {
  const hole = [card(2, 0), card(3, 1)];
  const board = [10, 11, 12, 13, 14].map(v => card(v, 2));
  const hand = bestFiveCards(hole, board);
  assert.equal(handName(rank(hand.map(entry => entry.card))), 'Royal Flush');
  assert.ok(hand.every(entry => entry.source === 'board'));
});
test('unknown cards never produce an invented winner combination', () => {
  const board = [2, 3, 4, 5, 6].map(v => card(v, 0));
  assert.deepEqual(bestFiveCards([null, null], board), []);
  assert.deepEqual(bestFiveCards([card(14, 0), null], board), []);
  assert.deepEqual(bestFiveCards([card(14, 0), card(13, 0)], board.slice(0, 4)), []);
});
test('selection matches seven-card rank and does not mutate visible inputs', () => {
  const hole = [card(14, 0), card(14, 1)];
  const board = [card(14, 2), card(13, 0), card(13, 1), card(4, 2), card(2, 3)];
  const original = structuredClone({hole, board});
  const hand = bestFiveCards(hole, board);
  assert.deepEqual(rank(hand.map(entry => entry.card)), rank([...hole, ...board]));
  assert.equal(handName(rank(hand.map(entry => entry.card))), 'Full House');
  assert.deepEqual({hole, board}, original);
});
test('replacement slots preserve all board positions and only replace unused cards', () => {
  const hole = [card(10, 1), card(11, 1)];
  const board = [card(7, 1), card(8, 1), card(9, 1), card(2, 0), card(3, 0)];
  const slots = replacementSlots(hole, board);
  assert.equal(slots.length, 5);
  assert.deepEqual(slots.map(slot => slot.boardCard), board);
  assert.deepEqual(slots.map(slot => slot.replaced), [false, false, false, true, true]);
  assert.deepEqual(slots.map(slot => slot.card), [...board.slice(0, 3), ...hole]);
  assert.deepEqual(slots.map(slot => slot.source), ['board', 'board', 'board', 'hole', 'hole']);
  assert.equal(new Set(slots.map(slot => `${slot.card.v}:${slot.card.s}`)).size, 5);
  assert.deepEqual(rank(slots.map(slot => slot.card)), rank([...hole, ...board]));
});
test('board-only winning hand needs no replacements or invented cards', () => {
  const hole = [card(2, 0), card(3, 1)];
  const board = [10, 11, 12, 13, 14].map(v => card(v, 2));
  const slots = replacementSlots(hole, board);
  assert.deepEqual(slots.map(slot => slot.card), board);
  assert.ok(slots.every(slot => !slot.replaced && slot.source === 'board'));
});
test('single-hole winner replaces one board card and keeps sources intact', () => {
  const hole = [card(14, 0), card(2, 1)];
  const board = [card(14, 1), card(14, 2), card(13, 0), card(13, 1), card(3, 3)];
  const slots = replacementSlots(hole, board);
  assert.deepEqual(slots.filter(slot => slot.replaced).map(slot => slot.card), [hole[0]]);
  assert.deepEqual(slots.filter(slot => slot.replaced).map(slot => slot.boardCard), [board[4]]);
  assert.deepEqual(rank(slots.map(slot => slot.card)), rank([...hole, ...board]));
});
test('unknown, incomplete or duplicated public cards do not create replacement slots', () => {
  const board = [2, 3, 4, 5, 6].map(v => card(v, 0));
  assert.deepEqual(replacementSlots([null, null], board), []);
  assert.deepEqual(replacementSlots([card(14, 0), card(13, 0)], board.slice(0, 4)), []);
  assert.deepEqual(replacementSlots([board[0], card(13, 0)], board), []);
});
