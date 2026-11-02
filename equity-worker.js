import {estimateEquity} from './equity.js';
import {analyzeDraws} from './draws.js';

self.onmessage = ({data}) => {
  const {key, cards, board, opponents} = data;
  try {
    const equity = estimateEquity({cards, board, opponents, samples:400});
    const {draws} = analyzeDraws({cards, board});
    self.postMessage({key, equity, draws});
  } catch (error) {
    self.postMessage({key, error:error.message});
  }
};
