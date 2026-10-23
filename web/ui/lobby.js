// Fenêtre du salon en ligne : code à partager, attente de l'adversaire, annulation.
// Ce qu'elle affiche vient de l'annonce « lobby » (session/online.js) ; ses boutons appellent la session.
import * as R from '../render/index.js';
import { normalizeCode } from '../net.js';
import { inviteUrl, cancelLobby } from '../session/online.js';
import { $ } from './dom.js';
import { copyText } from './clipboard.js';

/** @param {{ title: string, text: string, code: string, canCopy: boolean } | null} lobby null : la refermer */
export function showLobby(lobby) {
  if (!lobby) return void $('lobby').classList.add('hidden');
  $('lobbyTitle').textContent = lobby.title;
  $('lobbyText').textContent = lobby.text;
  $('lobbyCode').textContent = lobby.code;
  $('btnLobbyCopy').classList.toggle('hidden', !lobby.canCopy);
  $('lobby').classList.remove('hidden');
}

export function initLobby() {
  $('btnLobbyCopy').onclick = () => {
    const url = inviteUrl();
    if (!url) return;
    // sur téléphone, le partage du système évite un copier-coller
    if (navigator.share && R.compactMQ.matches) navigator.share({ title: 'Traversal', text: 'Une partie de Traversal ?', url }).catch(() => {});
    else copyText(url, 'Lien d’invitation copié : envoyez-le à votre adversaire.');
  };
  $('btnLobbyCancel').onclick = cancelLobby;
  $('joinCode').addEventListener('input', e => { const el = /** @type {HTMLInputElement} */ (e.target); el.value = normalizeCode(el.value); });
  $('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnStart').click(); });
}
