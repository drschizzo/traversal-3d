// Portée d'un calcul : tout ce qui est lancé pour la partie affichée (ou pour l'analyse de partie, ou pour une
// variante rejouée sur le plateau) est abandonné d'un coup quand elle change. Un seul mécanisme, l'AbortSignal :
//
//   const { signal } = scope;        // portée saisie au début de la suite
//   const r = await …;
//   if (signal.aborted) return;      // la partie affichée a changé : plus rien à faire ici
//
// `signal` est relu à chaque accès : le prendre au début d'une suite asynchrone fige la portée du moment,
// exactement comme un jeton, et le même objet sert à annuler les demandes au bot (bot/client.js).
// Pur, sans DOM : testé dans tests/session.test.js.

/** @typedef {{ readonly signal: AbortSignal, readonly aborted: boolean, bump: () => void, child: () => Scope }} Scope */

/** @returns {Scope} */
export function createScope() {
  let ctrl = new AbortController();
  const children = new Set();
  return {
    get signal() { return ctrl.signal; },
    get aborted() { return ctrl.signal.aborted; },
    /** Abandonne tout ce qui a été lancé dans cette portée (et dans les portées filles), et en ouvre une nouvelle. */
    bump() {
      for (const c of children) c.bump();
      ctrl.abort();
      ctrl = new AbortController();
    },
    /** Portée plus fine, abandonnée aussi par la portée mère (une variante rejouée dans l'analyse de partie). */
    child() {
      const c = createScope();
      children.add(c);
      return c;
    },
  };
}
