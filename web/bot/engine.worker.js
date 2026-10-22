// Web Worker du bot : le moteur Rust compilé en WebAssembly (engine/) y calcule sans bloquer l'affichage.
// Messages reçus : { id, state, level, analyze } ; réponses : { id, move, info } ou { id, error }.
import { loadEngine, think } from './wasm-bridge.js';

const engine = loadEngine(new URL('../../engine/traversal.wasm', import.meta.url));

self.onmessage = async e => {
  const { id, state, level, analyze } = e.data;
  try {
    const ex = await engine;
    self.postMessage({ id, ...think(ex, state, level, analyze) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
