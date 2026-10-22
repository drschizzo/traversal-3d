// Client du bot : une file de demandes servie par un Web Worker (engine.worker.js).
//
// - Annulation : chaque demande peut porter un AbortSignal. Une demande abandonnée par tous ceux qui l'attendent
//   est retirée de la file, ou, si le moteur la calcule déjà, le Worker est arrêté et relancé : la demande
//   suivante n'attend pas la fin d'une recherche devenue inutile (jusqu'à 8 s au niveau expert).
// - Priorités : le coup du bot passe avant les analyses (conseil, entraînement), qui passent avant l'analyse de partie.
// - Cache : une analyse demandée avec cache: true n'est calculée qu'une fois par position, quelle que soit la
//   façon dont la position a été reconstruite (clé de position de core/).
import { positionKey } from '../../core/index.js';

export const PRIORITY = { high: 0, normal: 1, low: 2 };

const defaultWorker = () => new Worker(new URL('./engine.worker.js', import.meta.url), { type: 'module' });
const abortError = signal => signal?.reason ?? new DOMException('Demande abandonnée', 'AbortError');
export const isAbort = e => e?.name === 'AbortError';

/**
 * @typedef {{ move: import('../../core/rules.js').Move | null, info: any, error?: string }} BotResult
 * @typedef {{ level: string, analyze?: boolean, priority?: number, signal?: AbortSignal, cache?: boolean }} ThinkOptions
 */

export function createBot({ createWorker = defaultWorker, cacheSize = 24 } = {}) {
  let worker = null, running = null, seq = 0;
  const queue = [], cache = new Map();

  function ensureWorker() {
    if (worker) return worker;
    worker = createWorker();
    worker.onmessage = e => {
      const job = running;
      if (!job || e.data.id !== job.id) return;
      running = null;
      settle(job, e.data.error ? { move: null, info: null, error: e.data.error } : { move: e.data.move, info: e.data.info });
      pump();
    };
    worker.onerror = ev => {
      ev.preventDefault?.();
      stopWorker();
      const job = running;
      running = null;
      if (job) settle(job, { move: null, info: null, error: 'Le moteur du bot s’est arrêté.' });
      pump();
    };
    return worker;
  }

  function stopWorker() {
    worker?.terminate();
    worker = null;
  }

  function pump() {
    if (running || !queue.length) return;
    queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    running = queue.shift();
    running.status = 'running';
    const { id, state, level, analyze } = running;
    ensureWorker().postMessage({ id, state, level, analyze });
  }

  function settle(job, result) {
    job.status = 'done';
    job.result = result;
    for (const sub of job.subs) sub.resolve(result);
    job.subs.clear();
    if (result.error && job.key) cache.delete(job.key); // une panne ne se garde pas
  }

  function cancel(job) {
    if (job.key && cache.get(job.key) === job) cache.delete(job.key);
    if (job.status === 'queued') queue.splice(queue.indexOf(job), 1);
    else if (job === running) {
      running = null;
      stopWorker(); // le Worker suivant repart d'un moteur neuf
      pump();
    }
    job.status = 'cancelled';
  }

  function remember(key, job) {
    cache.delete(key);
    cache.set(key, job);
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
  }

  /** @param {any} state @param {ThinkOptions} opts @returns {Promise<BotResult>} */
  function think(state, { level, analyze = false, priority = PRIORITY.normal, signal, cache: cached = false }) {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    const key = cached ? `${level}|${analyze ? 1 : 0}|${positionKey(state)}` : null;
    let job = key ? cache.get(key) : null;
    if (job) remember(key, job);
    if (job?.status === 'done') return Promise.resolve(job.result);
    if (!job) {
      job = { id: ++seq, seq, key, state, level, analyze, priority, status: 'queued', subs: new Set(), result: null };
      if (key) remember(key, job);
      queue.push(job);
    } else job.priority = Math.min(job.priority, priority);
    const j = job;
    const p = new Promise((resolve, reject) => {
      const sub = { resolve, reject };
      j.subs.add(sub);
      signal?.addEventListener('abort', () => {
        if (!j.subs.delete(sub)) return;
        reject(abortError(signal));
        if (!j.subs.size && j.status !== 'done') cancel(j);
      }, { once: true });
    });
    pump();
    return p;
  }

  return {
    think,
    /** lance le Worker (et le chargement du moteur) sans attendre la première demande */
    warmUp() { ensureWorker(); },
    /** demandes en attente ou en cours (pour les tests et le débogage) */
    get pending() { return queue.length + (running ? 1 : 0); },
    clearCache() { cache.clear(); },
    dispose() {
      for (const job of [...queue, running].filter(Boolean)) settle(job, { move: null, info: null, error: 'arrêt' });
      queue.length = 0;
      running = null;
      stopWorker();
      cache.clear();
    },
  };
}
