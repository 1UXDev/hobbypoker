import {rank, compare} from './poker.js';

/**
 * Estimated showdown pot share against uniformly random unknown hands.
 * Only pass the viewer's two cards and the public board, never opponent cards.
 * Splits count as a fraction; future folds, betting and side pots are excluded.
 */
export function estimateEquity({cards, board, opponents, samples = 500}, random = Math.random) {
  if (!Array.isArray(cards) || cards.length !== 2) throw Error('Two hole cards are required.');
  if (!Array.isArray(board) || ![0, 3, 4, 5].includes(board.length)) throw Error('Invalid board.');
  if (!Number.isInteger(opponents) || opponents < 0 || opponents > 7) throw Error('Invalid opponent count.');
  if (!Number.isInteger(samples) || samples < 1 || samples > 5000) throw Error('Invalid sample count.');
  if (typeof random !== 'function') throw Error('Invalid random source.');

  const known = new Set();
  for (const card of [...cards, ...board]) {
    if (!card || !Number.isInteger(card.v) || card.v < 2 || card.v > 14 ||
        !Number.isInteger(card.s) || card.s < 0 || card.s > 3) throw Error('Invalid card.');
    const key = card.s * 13 + card.v - 2;
    if (known.has(key)) throw Error('Duplicate card.');
    known.add(key);
  }
  if (opponents === 0) return 1;

  const available = Array.from({length:52}, (_, key) => ({v:2+key%13, s:Math.floor(key/13)}))
    .filter(card => !known.has(card.s * 13 + card.v - 2));
  let share = 0;
  for (let sample = 0; sample < samples; sample++) {
    const deck = available.slice();
    const draw = () => {
      const value = random();
      if (!Number.isFinite(value) || value < 0 || value >= 1) throw Error('Invalid random value.');
      const index = Math.floor(value * deck.length);
      const card = deck[index];
      deck[index] = deck[deck.length - 1];
      deck.pop();
      return card;
    };
    const runout = board.slice();
    while (runout.length < 5) runout.push(draw());
    const hero = rank([...cards, ...runout]);
    let tied = 1;
    let beaten = false;
    for (let opponent = 0; opponent < opponents; opponent++) {
      const result = compare(rank([draw(), draw(), ...runout]), hero);
      if (result > 0) { beaten = true; break; }
      if (result === 0) tied++;
    }
    if (!beaten) share += 1 / tied;
  }
  return share / samples;
}
