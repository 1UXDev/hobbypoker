import {rank, handName} from './poker.js';

/**
 * Exact hand-improvement probabilities from the viewer's cards and public board.
 * These describe making a hand, not winning against opponents. Straight/flush
 * include straight flushes; other categories refer to the best made hand.
 */
export function analyzeDraws({cards, board}) {
  if (!Array.isArray(cards) || cards.length !== 2) throw Error('Two hole cards are required.');
  if (!Array.isArray(board) || ![0, 3, 4, 5].includes(board.length)) throw Error('Invalid board.');

  const known = new Set();
  for (const card of [...cards, ...board]) {
    if (!card || !Number.isInteger(card.v) || card.v < 2 || card.v > 14 ||
        !Number.isInteger(card.s) || card.s < 0 || card.s > 3) throw Error('Invalid card.');
    const key = card.s * 13 + card.v - 2;
    if (known.has(key)) throw Error('Duplicate card.');
    known.add(key);
  }
  if (board.length === 0 || board.length === 5) return {draws:[]};

  const hand = [...cards, ...board];
  const currentCategory = rank(hand)[0];
  const available = Array.from({length:52}, (_, key) => ({v:2+key%13, s:Math.floor(key/13)}))
    .filter(card => !known.has(card.s * 13 + card.v - 2));
  const outs = Array.from({length:9}, () => []);
  const riverCounts = Array(9).fill(0);
  const categories = category => category === 8 ? [4, 5, 8] : [category];

  for (const card of available) {
    for (const category of categories(rank([...hand, card])[0])) {
      if (category > currentCategory) outs[category].push(card);
    }
  }
  if (board.length === 4) {
    for (let category = 1; category <= 8; category++) riverCounts[category] = outs[category].length;
  } else {
    for (let first = 0; first < available.length - 1; first++) {
      for (let second = first + 1; second < available.length; second++) {
        for (const category of categories(rank([...hand, available[first], available[second]])[0])) {
          if (category > currentCategory) riverCounts[category]++;
        }
      }
    }
  }

  const riverRunouts = board.length === 4 ? available.length : available.length * (available.length - 1) / 2;
  const priority = category => ({4:0,5:1,8:2})[category] ?? 10 + category;
  const draws = [];
  for (let category = currentCategory + 1; category <= 8; category++) {
    if (riverCounts[category] === 0 && outs[category].length === 0) continue;
    draws.push({
      handName:handName([category,0]),
      category,
      outs:outs[category].length,
      ranks:[...new Set(outs[category].map(card => card.v))].sort((a,b) => a-b),
      nextCardCards:outs[category].map(card => ({...card})),
      nextCardProbability:outs[category].length / available.length,
      byRiverProbability:riverCounts[category] / riverRunouts,
      runnerRunner:outs[category].length === 0,
    });
  }
  draws.sort((a,b) => Number(a.runnerRunner) - Number(b.runnerRunner) || priority(a.category) - priority(b.category));
  return {draws};
}
