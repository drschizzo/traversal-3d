// Traversal — serveur des salons en ligne : un Worker Cloudflare et un Durable Object par salon.
//
//   POST /room           → crée un salon, renvoie { code, token, side }
//   GET  /room/:code/ws  → WebSocket du salon
//   le reste             → fichiers statiques du jeu (binding ASSETS)
//
// Le salon importe game.js tel quel : il est le seul à faire foi et valide chaque coup avec allMoves().
// Trois choix tiennent les coûts de l'offre gratuite : l'API WebSocket Hibernation (pas de durée facturée
// pendant que les joueurs réfléchissent), la réponse automatique au heartbeat (qui ne réveille pas l'objet),
// et une alarme qui purge le salon 24 h après la dernière activité.
import { DurableObject } from 'cloudflare:workers';
import { TERRAIN_MODES, allMoves, applyMove, generateTerrain, newGame } from '../game.js';
import { KINDS } from '../match.js';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I ni O, trop proches de 1 et 0
const CODE_RE = /^[A-HJ-NP-Z]{6}$/;
const TTL = 24 * 3600 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

// Limite de création de salons par IP. Elle ne vaut que pour l'isolat qui reçoit la requête :
// c'est un garde-fou contre un script naïf, pas une protection garantie.
const RATE_WINDOW = 60_000, RATE_MAX = 10;
const recent = new Map();
function rateLimited(ip) {
  const now = Date.now(), list = (recent.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return list.length > RATE_MAX;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/room' || url.pathname.startsWith('/room/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

      if (url.pathname === '/room' && request.method === 'POST') {
        if (rateLimited(request.headers.get('CF-Connecting-IP') || '')) return json({ error: 'Trop de salons créés, réessayez dans une minute.' }, 429);
        let body = {};
        try { body = await request.json(); } catch {}
        const terrain = TERRAIN_MODES.some(m => m[0] === body.terrain) ? body.terrain : 'random';
        const seed = Number.isInteger(body.seed) && body.seed >= 0 && body.seed < 2 ** 32 ? body.seed : (Math.random() * 2 ** 32) >>> 0;
        const side = body.side === 1 ? 1 : 0;
        for (let k = 0; k < 5; k++) {
          const code = randomCode();
          const res = await env.ROOMS.get(env.ROOMS.idFromName(code)).create({ terrain, seed, side });
          if (res) return json({ code, ...res });
        }
        return json({ error: 'Impossible de créer un salon.' }, 503);
      }

      const m = url.pathname.match(/^\/room\/([A-Za-z]{6})\/ws$/);
      if (m && request.method === 'GET') {
        const code = m[1].toUpperCase();
        if (!CODE_RE.test(code)) return json({ error: 'Code de salon invalide.' }, 404);
        if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'WebSocket attendu.' }, 426);
        return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
      }
      return json({ error: 'Introuvable.' }, 404);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};

// Un salon : deux places, la partie en cours et sa liste de coups.
// Le stockage SQLite garde les réglages (table meta) et les coups en ajout seul (table moves) ;
// la position est tenue en mémoire et reconstruite au réveil en rejouant les coups.
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    this.meta = {};
    this.moves = [];
    this.game = null;
    // les tables ne sont créées qu'avec le salon : un code inconnu n'écrit rien (et ne laisse rien à purger)
    if (sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length) {
      this.meta = Object.fromEntries(sql.exec('SELECT k, v FROM meta').toArray().map(r => [r.k, JSON.parse(r.v)]));
      this.moves = sql.exec('SELECT pi, kind, dest FROM moves ORDER BY ply').toArray().map(r => ({ pi: r.pi, kind: KINDS[r.kind], to: r.dest }));
      if (this.meta.seed !== undefined) this.rebuild();
    }
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  setMeta(obj) {
    for (const [k, v] of Object.entries(obj)) {
      this.meta[k] = v;
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, JSON.stringify(v));
    }
  }

  rebuild() {
    let s = newGame(generateTerrain(this.meta.terrain, this.meta.seed));
    for (const m of this.moves) {
      const lm = allMoves(s).find(x => x.pi === m.pi && x.kind === m.kind && x.to === m.to);
      if (!lm) break; // ne peut pas arriver : chaque coup a été validé avant d'être écrit
      s = applyMove(s, lm);
    }
    this.game = s;
  }

  // appelé par le Worker (RPC) ; null si ce code est déjà pris
  async create({ terrain, seed, side }) {
    if (this.meta.seed !== undefined) return null;
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS moves (ply INTEGER PRIMARY KEY, pi INTEGER, kind INTEGER, dest INTEGER, at INTEGER)');
    const token = randomToken();
    const tokens = [null, null];
    tokens[side] = token;
    this.setMeta({ terrain, seed, tokens, createdAt: Date.now(), result: null, rematch: [false, false] });
    this.moves = [];
    this.rebuild();
    await this.ctx.storage.setAlarm(Date.now() + TTL);
    return { token, side };
  }

  async fetch() {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ side: -1 });
    return new Response(null, { status: 101, webSocket: client });
  }

  sockets(side) {
    return this.ctx.getWebSockets().filter(ws => ws.deserializeAttachment()?.side === side);
  }

  send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch {} }

  broadcast(msg) {
    for (const ws of this.ctx.getWebSockets()) if (ws.deserializeAttachment()?.side >= 0) this.send(ws, msg);
  }

  stateFor(side) {
    const g = this.game;
    return {
      type: 'state', seed: this.meta.seed, terrain: this.meta.terrain, moves: this.moves, you: side,
      token: this.meta.tokens[side], turn: g.turn, opponent: this.sockets(1 - side).length > 0,
      result: this.meta.result, rematch: this.meta.rematch,
    };
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment()?.side ?? -1;

    if (msg.type === 'join') {
      if (this.meta.seed === undefined) {
        this.send(ws, { type: 'error', code: 'notfound', msg: 'Ce salon n’existe pas ou a expiré.' });
        return ws.close(4004, 'notfound');
      }
      const tokens = this.meta.tokens;
      let side = tokens.indexOf(msg.token);
      if (!msg.token || side < 0) {
        side = tokens.indexOf(null);
        if (side < 0) {
          this.send(ws, { type: 'error', code: 'full', msg: 'Ce salon est complet.' });
          return ws.close(4003, 'full');
        }
        tokens[side] = randomToken();
        this.setMeta({ tokens });
      }
      // un ancien onglet du même joueur cède la place
      for (const old of this.sockets(side)) if (old !== ws) { old.serializeAttachment({ side: -1 }); try { old.close(4000, 'replaced'); } catch {} }
      ws.serializeAttachment({ side });
      this.send(ws, this.stateFor(side));
      for (const o of this.sockets(1 - side)) this.send(o, { type: 'opponent', status: 'joined' });
      return;
    }
    if (me < 0) return;

    if (msg.type === 'move') {
      const g = this.game;
      const reject = reason => this.send(ws, { type: 'reject', ply: msg.ply, reason });
      if (this.meta.result || g.over) return reject('La partie est terminée.');
      if (msg.ply !== g.ply) return reject('Coup désynchronisé.');
      if (g.turn !== me) return reject('Ce n’est pas votre tour.');
      const lm = allMoves(g).find(x => x.pi === msg.pi && x.kind === msg.kind && x.to === msg.to);
      if (!lm) return reject('Coup illégal.');
      this.game = applyMove(g, lm);
      const m = { pi: lm.pi, kind: lm.kind, to: lm.to };
      this.moves.push(m);
      this.ctx.storage.sql.exec('INSERT INTO moves (ply, pi, kind, dest, at) VALUES (?, ?, ?, ?, ?)', g.ply, m.pi, KINDS.indexOf(m.kind), m.to, Date.now());
      this.broadcast({ type: 'move', ply: g.ply, ...m });
      if (this.game.over) this.endGame({ winner: this.game.winner, reason: this.game.reason });
      return;
    }

    if (msg.type === 'resign') {
      if (this.meta.result || this.game.over) return;
      this.endGame({ winner: 1 - me, reason: `${me === 0 ? 'Rouge' : 'Bleu'} a abandonné`, resigned: me });
      return;
    }

    if (msg.type === 'rematch') {
      if (!this.meta.result) return;
      const rematch = this.meta.rematch.slice();
      rematch[me] = true;
      if (!rematch[0] || !rematch[1]) {
        this.setMeta({ rematch });
        for (const o of this.sockets(1 - me)) this.send(o, { type: 'rematch' });
        return;
      }
      // revanche acceptée : nouveau monde sur le même terrain, couleurs échangées
      this.ctx.storage.sql.exec('DELETE FROM moves');
      this.moves = [];
      this.setMeta({ seed: (Math.random() * 2 ** 32) >>> 0, tokens: [this.meta.tokens[1], this.meta.tokens[0]], result: null, rematch: [false, false] });
      this.rebuild();
      for (const ws2 of this.ctx.getWebSockets()) {
        const side = ws2.deserializeAttachment()?.side;
        if (side >= 0) { ws2.serializeAttachment({ side: 1 - side }); this.send(ws2, this.stateFor(1 - side)); }
      }
    }
  }

  endGame(result) {
    this.setMeta({ result, rematch: [false, false] });
    this.broadcast({ type: 'over', ...result });
  }

  async webSocketClose(ws, code) {
    const side = ws.deserializeAttachment()?.side;
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch {}
    if (side >= 0 && !this.sockets(side).some(o => o !== ws)) for (const o of this.sockets(1 - side)) this.send(o, { type: 'opponent', status: 'left' });
  }

  async webSocketError(ws) { await this.webSocketClose(ws, 1011); }

  // purge 24 h après la dernière activité
  async alarm() {
    const last = this.ctx.storage.sql.exec('SELECT MAX(at) AS t FROM moves').one().t ?? this.meta.createdAt ?? 0;
    if (Date.now() - last < TTL) return this.ctx.storage.setAlarm(last + TTL);
    for (const ws of this.ctx.getWebSockets()) try { ws.close(4010, 'expired'); } catch {}
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.meta = {};
    this.moves = [];
    this.game = null;
  }
}
