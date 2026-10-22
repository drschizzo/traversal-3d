// Accès au document
export const $ = id => /** @type {HTMLElement & HTMLButtonElement & HTMLInputElement & HTMLDetailsElement} */ (document.getElementById(id));
// icône de la barre d'outils (jeu de symboles au début de index.html)
export const icon = name => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const shown = id => !$(id).classList.contains('hidden');
export const isTouch = e => e.pointerType === 'touch' || e.pointerType === 'pen';
