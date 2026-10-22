// Client des salons en ligne (server/worker.js) : création d'un salon, WebSocket, reconnexion automatique.

// Adresse du Worker déployé (npx wrangler deploy, dans server/). Vide : même origine que la page,
// ce qui suffit quand le Worker sert aussi le jeu (wrangler dev, ou le site *.workers.dev).
const DEFAULT_SERVER = '';
const SERVER = (new URLSearchParams(location.search).get('server') || DEFAULT_SERVER || location.origin).replace(/\/$/, '');

export const CODE_RE = /^[A-HJ-NP-Z]{6}$/;
export const normalizeCode = s => (s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
export const inviteLink = code => `${location.origin}${location.pathname}${location.search}#r=${code}`;

// session du joueur dans un salon : { code, token }, pour la reconnexion après rechargement
const SESSION_KEY = 'traversal.online';
export function savedSession() {
  try {
    const d = JSON.parse(localStorage.getItem(SESSION_KEY));
    return d && CODE_RE.test(d.code) && typeof d.token === 'string' ? d : null;
  } catch { return null; }
}
export function saveSession(d) {
  try { d ? localStorage.setItem(SESSION_KEY, JSON.stringify(d)) : localStorage.removeItem(SESSION_KEY); } catch {}
}

export async function createRoom({ seed, terrain, side }) {
  let res;
  try {
    res = await fetch(`${SERVER}/room`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seed, terrain, side }) });
  } catch { throw new Error('Serveur injoignable.'); }
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.code) throw new Error(d.error || 'Serveur indisponible.');
  return d;
}

// Connexion à un salon. handlers.onMessage(msg) reçoit les messages du serveur ; handlers.onStatus(s) l'état
// de la connexion ('open', 'reconnecting', 'closed'). La connexion se rétablit seule tant que close() n'a pas
// été appelé et que le serveur n'a pas refusé l'accès (salon introuvable, complet ou expiré).
export function connect(code, token, handlers) {
  let ws = null, closed = false, retry = 0, pingTimer = 0, retryTimer = 0;
  const wsUrl = `${SERVER.replace(/^http/, 'ws')}/room/${code}/ws`;
  const open = () => {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      retry = 0;
      ws.send(JSON.stringify({ type: 'join', token: conn.token }));
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
      // 4000 : remplacé par un autre onglet ; 4003, 4004, 4010 : complet, introuvable, expiré
      if (e.code >= 4000 && e.code < 4100) { closed = true; handlers.onStatus?.('closed', e.code); return; }
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
