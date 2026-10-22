// Progression d'une partie à l'autre : chaque partie analysée (contre le bot ou en ligne) laisse une ligne
// { id, t, n, solid, acc, themes, level } ; on compare les 5 dernières aux 5 d'avant. Pur : le stockage est ailleurs.
import { summary } from './review.js';
import { TOPICS } from './topics.js';

export const PROGRESS_MAX = 40;

/** Liste mise à jour après l'analyse d'une partie ; null si le camp n'a aucun coup jugé. */
export function addGame(list, items, { id, side, level, now = Date.now() }) {
  const s = summary(items, side);
  if (!s) return null;
  const entry = { id, t: now, n: s.n, solid: s.solid, acc: Math.round(s.accuracy), themes: s.themes, level };
  return [...list.filter(e => e.id !== id), entry].slice(-PROGRESS_MAX);
}

// moyenne des 5 dernières parties, comparée aux 5 d'avant ; thème le plus fréquent dans leurs fautes
export function progressStats(list) {
  if (!list.length) return null;
  const last = list.slice(-5), prev = list.slice(-10, -5);
  const mean = l => Math.round(l.reduce((a, e) => a + e.acc, 0) / l.length);
  const themes = {};
  for (const e of last) for (const [t, k] of Object.entries(e.themes || {})) if (TOPICS[t]) themes[t] = (themes[t] || 0) + k;
  const top = Object.entries(themes).sort((a, b) => b[1] - a[1])[0];
  return { games: list.length, n: last.length, acc: mean(last), prev: prev.length ? mean(prev) : null, theme: top ? top[0] : null };
}
