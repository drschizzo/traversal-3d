import { describe, it, expect, beforeEach } from 'vitest';
import { createBot, PRIORITY, isAbort } from '../web/bot/client.js';
import { startPosition, allMoves, applyMove } from '../core/index.js';

// faux Worker : chaque demande est servie quand le test appelle finish()
let workers;
function fakeWorker() {
  const w = {
    received: [], terminated: false, onmessage: null, onerror: null,
    postMessage(msg) { this.received.push(msg); },
    terminate() { this.terminated = true; },
    finish(extra = {}) { const msg = this.received.shift(); this.onmessage({ data: { id: msg.id, move: { pi: msg.id }, info: null, ...extra } }); },
  };
  workers.push(w);
  return w;
}
const flush = () => new Promise(r => setTimeout(r, 0));

describe('client du bot', () => {
  let bot;
  const s0 = startPosition('random', 1);
  const s1 = applyMove(s0, allMoves(s0)[0]);
  beforeEach(() => { workers = []; bot = createBot({ createWorker: fakeWorker }); });

  it('sert les demandes une à une, par priorité', async () => {
    const order = [];
    bot.think(s0, { level: 'hard' }).then(() => order.push('a'));
    bot.think(s1, { level: 'review', priority: PRIORITY.low }).then(() => order.push('low'));
    bot.think(s1, { level: 'hard', priority: PRIORITY.high }).then(() => order.push('high'));
    const w = workers[0];
    expect(w.received).toHaveLength(1);
    w.finish(); await flush();
    w.finish(); await flush();
    w.finish(); await flush();
    expect(order).toEqual(['a', 'high', 'low']);
  });

  it('ne calcule qu’une fois une analyse mise en cache', async () => {
    const a = bot.think(s0, { level: 'hard', analyze: true, cache: true });
    const b = bot.think(startPosition('random', 1), { level: 'hard', analyze: true, cache: true });
    expect(workers[0].received).toHaveLength(1);
    workers[0].finish();
    expect(await a).toBe(await b);
    expect(await bot.think(s0, { level: 'hard', analyze: true, cache: true })).toBe(await a);
    expect(bot.pending).toBe(0);
  });

  it('abandonner une recherche en cours relance le Worker pour la suivante', async () => {
    const ctl = new AbortController();
    const a = bot.think(s0, { level: 'expert', signal: ctl.signal });
    const b = bot.think(s1, { level: 'hard' });
    ctl.abort();
    await expect(a).rejects.toSatisfy(isAbort);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].received).toHaveLength(1);
    workers[1].finish();
    expect((await b).move).toBeTruthy();
  });

  it('abandonner une demande en attente la retire sans arrêter le calcul en cours', async () => {
    const ctl = new AbortController();
    bot.think(s0, { level: 'hard' });
    const b = bot.think(s1, { level: 'hard', signal: ctl.signal });
    ctl.abort();
    await expect(b).rejects.toSatisfy(isAbort);
    expect(workers[0].terminated).toBe(false);
    expect(bot.pending).toBe(1);
  });

  it('une demande partagée n’est annulée que si tous l’abandonnent', async () => {
    const c1 = new AbortController(), c2 = new AbortController();
    const a = bot.think(s0, { level: 'hard', cache: true, signal: c1.signal });
    const b = bot.think(s0, { level: 'hard', cache: true, signal: c2.signal });
    c1.abort();
    await expect(a).rejects.toSatisfy(isAbort);
    expect(workers[0].terminated).toBe(false);
    workers[0].finish();
    expect((await b).move).toBeTruthy();
  });

  it('une panne du moteur est signalée et pas gardée en cache', async () => {
    const a = bot.think(s0, { level: 'hard', cache: true });
    workers[0].finish({ error: 'moteur introuvable' });
    expect((await a).error).toBe('moteur introuvable');
    bot.think(s0, { level: 'hard', cache: true });
    expect(workers[0].received).toHaveLength(1); // recalculée
  });
});
