// Client des salons en ligne (server/worker.js, protocole : core/protocol.js) : création d'un salon, WebSocket,
// reconnexion automatique, et place du joueur gardée pour la reprendre après un rechargement.
import { PROTOCOL, CODE_RE, isFinalClose } from '../core/index.js';
import { roomServer } from './config.js';
import { errorText } from './i18n/fr.js';
import { load, save } from './storage.js';

export { CODE_RE, normalizeCode } from '../core/index.js';
export const inviteLink = code => `${location.origin}${location.pathname}${location.search}#r=${code}`;

// session du joueur dans un salon : { code, token }
export function savedSession() {
  const d = load('online');
  return d && CODE_RE.test(d.code) ? d : null;
}
export const saveSession = d => save('online', d);

export async function createRoom({ seed, terrain, side }) {
  let res;
  try {
    res = await fetch(`${roomServer()}/room`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seed, terrain, side }) });
  } catch { throw new Error('Serveur injoignable.'); }
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.code) throw new Error(errorText(d.error));
  return d;
}

// Connexion à un salon. handlers.onMessage(msg) reçoit les messages du serveur ; handlers.onStatus(s) l'état
// de la connexion ('open', 'reconnecting', 'closed'). La connexion se rétablit seule tant que close() n'a pas
// été appelé et que le serveur n'a pas refusé l'accès (salon introuvable, complet, expiré, autre version).
export function connect(code, token, handlers) {
  let ws = null, closed = false, retry = 0, pingTimer = 0, retryTimer = 0;
  const wsUrl = `${roomServer().replace(/^http/, 'ws')}/room/${code}/ws`;
  const open = () => {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      retry = 0;
      ws.send(JSON.stringify({ type: 'join', v: PROTOCOL, token: conn.token }));
      // heartbeat : le serveur y répond automatiquement sans se réveiller
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 30_000);
      handlers.onStatus?.('open');
    };
    ws.onmessage = e => {
      if (e.data === 'pong') return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'state') conn.token = msg.token;
      handlers.onMessage(msg);
    };
    ws.onclose = e => {
      clearInterval(pingTimer);
      if (closed) return;
      if (isFinalClose(e.code)) { closed = true; handlers.onStatus?.('closed', e.code); return; }
      handlers.onStatus?.('reconnecting');
      retryTimer = setTimeout(open, Math.min(10_000, 500 * 2 ** retry++));
    };
  };
  const conn = {
    code, token,
    send(msg) { if (ws?.readyState === 1) { ws.send(JSON.stringify(msg)); return true; } return false; },
    close() { closed = true; clearInterval(pingTimer); clearTimeout(retryTimer); try { ws?.close(1000); } catch {} },
    // après un retour au premier plan (mobile) : reconnexion immédiate si la socket est tombée
    wake() { if (!closed && ws?.readyState === 3) { clearTimeout(retryTimer); retry = 0; open(); } },
  };
  open();
  return conn;
}
