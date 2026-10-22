// Données gardées dans le navigateur (localStorage). Chaque entrée a son nom, sa valeur par défaut, son format
// et sa validation : une valeur absente, illisible ou d'un autre format vaut la valeur par défaut.
// Toute lecture ou écriture peut échouer (navigation privée, stockage plein ou bloqué) : le jeu fonctionne alors
// sans mémoire. Les noms et formats sont ceux des versions précédentes, pour garder les données des joueurs.

const text = { parse: s => s, format: v => String(v) };
const flag = { parse: s => s === '1', format: v => (v ? '1' : '0') };
const json = { parse: s => JSON.parse(s), format: v => JSON.stringify(v) };

/** @type {Record<string, { key: string, codec: { parse: (s: string) => any, format: (v: any) => string }, fallback: any, valid?: (v: any) => boolean }>} */
const ENTRIES = {
  theme: { key: 'traversal.theme', codec: text, fallback: null },
  quality: { key: 'traversal.quality', codec: text, fallback: 'auto' },
  training: { key: 'traversal.training', codec: flag, fallback: false },
  rotateOk: { key: 'traversal.rotateOk', codec: flag, fallback: false },
  // partie locale en cours : { v: 1, seed, terrain, play, moves }
  game: { key: 'traversal.game', codec: json, fallback: null, valid: d => d?.v === 1 && Array.isArray(d.moves) },
  // une ligne par partie analysée (voir coach/progress.js)
  progress: { key: 'traversal.progress', codec: json, fallback: [], valid: Array.isArray },
  // place du joueur dans un salon en ligne : { code, token }
  online: { key: 'traversal.online', codec: json, fallback: null, valid: d => typeof d?.code === 'string' && typeof d.token === 'string' },
};

function entry(name) {
  const e = ENTRIES[name];
  if (!e) throw new Error(`entrée de stockage inconnue : ${name}`);
  return e;
}

export function load(name) {
  const e = entry(name);
  try {
    const raw = localStorage.getItem(e.key);
    if (raw === null) return e.fallback;
    const v = e.codec.parse(raw);
    return !e.valid || e.valid(v) ? v : e.fallback;
  } catch { return e.fallback; }
}

/** Enregistre une valeur ; null ou undefined efface l'entrée. */
export function save(name, value) {
  const e = entry(name);
  try {
    if (value === null || value === undefined) localStorage.removeItem(e.key);
    else localStorage.setItem(e.key, e.codec.format(value));
  } catch {}
}
