// Géométrie du plateau : une case est un indice 0…99 (ligne par ligne, Rouge part de la rangée 0)
import { N, NC } from './constants.js';

/** @type {(x: number, y: number) => number} */
export const idx = (x, y) => y * N + x;
/** @type {(i: number) => number} */
export const cx = i => i % N;
/** @type {(i: number) => number} */
export const cy = i => (i / N) | 0;
/** rangée d'arrivée du camp o @type {(o: number) => number} */
export const goalRow = o => (o === 0 ? N - 1 : 0);

// voisins orthogonaux de chaque case
/** @type {number[][]} */
export const NEIGH = [];
for (let i = 0; i < NC; i++) {
  const x = cx(i), y = cy(i), a = [];
  if (x > 0) a.push(i - 1);
  if (x < N - 1) a.push(i + 1);
  if (y > 0) a.push(i - N);
  if (y < N - 1) a.push(i + N);
  NEIGH.push(a);
}
