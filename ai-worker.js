import { chooseMove } from './ai.js';

self.onmessage = e => {
  const { state, level, token } = e.data;
  self.postMessage({ move: chooseMove(state, level), token });
};
