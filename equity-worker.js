import {estimateEquity} from './equity.js';

self.onmessage = ({data}) => {
  const {key, cards, board, opponents} = data;
  try {
    self.postMessage({key, equity:estimateEquity({cards, board, opponents, samples:400})});
  } catch (error) {
    self.postMessage({key, error:error.message});
  }
};
