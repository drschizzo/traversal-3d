// Traversal — serveur des salons en ligne : un Worker Cloudflare et un Durable Object par salon.
//
//   POST /room           → crée un salon, renvoie { code, token, side }
//   GET  /room/:code/ws  → WebSocket du salon (protocole : core/protocol.js)
//   le reste             → fichiers statiques du jeu (binding ASSETS, dossier dist/)
//
// Les décisions d'un salon (places, coups, fin de partie, revanche) sont dans room.js, qui importe les règles du jeu
// (core/) telles quelles : le serveur est le seul à faire foi et valide chaque coup.
// Trois choix tiennent les coûts de l'offre gratuite : l'API WebSocket Hibernation (pas de durée facturée
// pendant que les joueurs réfléchissent), la réponse automatique au heartbeat (qui ne réveille pas l'objet),
// et une alarme qui purge le salon 24 h après la dernière activité.
import { DurableObject } from 'cloudflare:workers';
import { CLOSE, CODE_LETTERS, CODE_LENGTH, CODE_RE, ERROR, KINDS, isSeed, isTerrain, parseClientMessage, randomSeed } from '../core/index.js';
import { RoomGame } from './room.js';

const TTL = 24 * 3600 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(CODE_LENGTH)), b => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
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
        if (rateLimited(request.headers.get('CF-Connecting-IP') || '')) return json({ error: ERROR.RATE }, 429);
        let body = {};
        try { body = await request.json(); } catch {}
        const terrain = isTerrain(body.terrain) ? body.terrain : 'random';
        const seed = isSeed(body.seed) ? body.seed : randomSeed();
        const side = body.side === 1 ? 1 : 0;
        for (let k = 0; k < 5; k++) {
          const code = randomCode();
          const res = await env.ROOMS.get(env.ROOMS.idFromName(code)).create({ terrain, seed, side });
          if (res) return json({ code, ...res });
        }
        return json({ error: ERROR.UNAVAILABLE }, 503);
      }

      const m = url.pathname.match(/^\/room\/([A-Za-z]{6})\/ws$/);
      if (m && request.method === 'GET') {
        const code = m[1].toUpperCase();
        if (!CODE_RE.test(code)) return json({ error: ERROR.BAD_CODE }, 404);
        if (request.headers.get('Upgrade') !== 'websocket') return json({ error: ERROR.NOT_WEBSOCKET }, 426);
        return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
      }
      return json({ error: ERROR.NOT_FOUND }, 404);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};

// Un salon : le stockage SQLite garde les réglages (table meta) et les coups en ajout seul (table moves) ;
// la position est tenue en mémoire (RoomGame) et reconstruite au réveil en rejouant les coups.
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    let meta = {}, moves = [];
    // les tables ne sont créées qu'avec le salon : un code inconnu n'écrit rien (et ne laisse rien à purger)
    if (sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length) {
      meta = Object.fromEntries(sql.exec('SELECT k, v FROM meta').toArray().map(r => [r.k, JSON.parse(r.v)]));
      moves = sql.exec('SELECT pi, kind, dest FROM moves ORDER BY ply').toArray().map(r => ({ pi: r.pi, kind: KINDS[r.kind], to: r.dest }));
    }
    this.room = new RoomGame(meta, moves);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // enregistre les réglages modifiés
  persist(keys) {
    for (const k of keys) this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, JSON.stringify(this.room.meta[k]));
  }

  // appelé par le Worker (RPC) ; null si ce code est déjà pris
  async create({ terrain, seed, side }) {
    if (this.room.exists) return null;
    const sql = this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
    sql.exec('CREATE TABLE IF NOT EXISTS moves (ply INTEGER PRIMARY KEY, pi INTEGER, kind INTEGER, dest INTEGER, at INTEGER)');
    const token = randomToken();
    this.room = new RoomGame(RoomGame.create({ terrain, seed, side, token, now: Date.now() }));
    this.persist(Object.keys(this.room.meta));
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

  async webSocketMessage(ws, raw) {
    const msg = parseClientMessage(raw);
    if (!msg) return;
    const me = ws.deserializeAttachment()?.side ?? -1;
    const room = this.room;

    if (msg.type === 'join') {
      const res = room.join(msg, randomToken);
      if ('error' in res) {
        this.send(ws, { type: 'error', code: res.error });
        const close = { [ERROR.NOT_FOUND]: CLOSE.NOT_FOUND, [ERROR.FULL]: CLOSE.FULL, [ERROR.VERSION]: CLOSE.VERSION }[res.error];
        return ws.close(close, res.error);
      }
      if (res.patch) this.persist(Object.keys(res.patch));
      const side = res.side;
      // un ancien onglet du même joueur cède la place
      for (const old of this.sockets(side)) if (old !== ws) { old.serializeAttachment({ side: -1 }); try { old.close(CLOSE.REPLACED, 'replaced'); } catch {} }
      ws.serializeAttachment({ side });
      this.send(ws, room.stateFor(side, this.sockets(1 - side).length > 0));
      for (const o of this.sockets(1 - side)) this.send(o, { type: 'opponent', status: 'joined' });
      return;
    }
    if (me < 0) return;

    if (msg.type === 'move') {
      const res = room.play(me, msg);
      if ('reject' in res) return this.send(ws, { type: 'reject', ply: msg.ply, code: res.reject });
      const k = res.move;
      this.ctx.storage.sql.exec('INSERT INTO moves (ply, pi, kind, dest, at) VALUES (?, ?, ?, ?, ?)', res.ply, k.pi, KINDS.indexOf(k.kind), k.to, Date.now());
      this.broadcast({ type: 'move', ply: res.ply, ...k });
      if (res.result) this.ended(res.result);
      return;
    }

    if (msg.type === 'resign') {
      const result = room.resign(me);
      if (result) this.ended(result);
      return;
    }

    if (msg.type === 'rematch') {
      const res = room.rematch(me, randomSeed());
      if (!res) return;
      if (!res.started) {
        this.persist(['rematch']);
        for (const o of this.sockets(1 - me)) this.send(o, { type: 'rematch' });
        return;
      }
      // revanche acceptée : nouveau monde, couleurs échangées
      this.ctx.storage.sql.exec('DELETE FROM moves');
      this.persist(['seed', 'tokens', 'result', 'rematch']);
      // présence de chaque camp lue avant l'échange : les places changent au fil de la boucle, et la question
      // « l'adversaire est-il là ? » porte sur la même personne, donc sur sa place d'avant la revanche
      const here = [this.sockets(0).length > 0, this.sockets(1).length > 0];
      for (const ws2 of this.ctx.getWebSockets()) {
        const side = ws2.deserializeAttachment()?.side;
        if (!(side >= 0)) continue;
        ws2.serializeAttachment({ side: 1 - side });
        this.send(ws2, room.stateFor(1 - side, here[1 - side]));
      }
    }
  }

  ended(result) {
    this.persist(['result', 'rematch']);
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
    const last = this.ctx.storage.sql.exec('SELECT MAX(at) AS t FROM moves').one().t ?? this.room.meta.createdAt ?? 0;
    if (Date.now() - last < TTL) return this.ctx.storage.setAlarm(last + TTL);
    for (const ws of this.ctx.getWebSockets()) try { ws.close(CLOSE.EXPIRED, 'expired'); } catch {}
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.room = new RoomGame();
  }
}
