// Copie dans le presse-papiers, avec une annonce
import { toast } from './hud.js';

// copie par champ temporaire : seul recours quand l'API presse-papiers est absente (page non sécurisée)
// ou refusée par le navigateur ; elle doit rester dans le geste de l'utilisateur, donc être tentée en premier.
function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0';
  document.body.appendChild(ta);
  const active = /** @type {HTMLElement} */ (document.activeElement);
  let ok = false;
  try {
    ta.focus();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
  } catch {}
  ta.remove();
  try { active?.focus?.(); } catch {}
  return ok;
}

export function copyText(text, done) {
  if (legacyCopy(text)) return toast(done);
  navigator.clipboard?.writeText(text).then(() => toast(done), () => toast('Copie impossible : ' + text));
}
