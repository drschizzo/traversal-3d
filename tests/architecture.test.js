// Sens des dépendances décrit dans docs/architecture.md : aucun cycle d'imports, et chaque couche n'importe que
// ce qu'elle a le droit de connaître.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['core', 'server', 'web'];

const jsFiles = dir => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(e => {
  const p = join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'public' || e.name.startsWith('.') ? [] : jsFiles(p);
  return e.name.endsWith('.js') ? [p] : [];
});

// module → modules du dépôt qu'il importe (chemins relatifs à la racine)
const graph = new Map(DIRS.flatMap(jsFiles).map(f => {
  const src = readFileSync(join(ROOT, f), 'utf8');
  const deps = [...src.matchAll(/^\s*(?:import|export)\b[^'"]*?(?:from\s*)?['"](\.[^'"]+)['"]/gm)]
    .map(m => normalize(join(dirname(f), m[1])));
  return [f, deps];
}));

describe('architecture', () => {
  it('aucun cycle d’imports', () => {
    const state = new Map(), cycles = [];
    const visit = (f, stack) => {
      if (state.get(f) === 'done') return;
      if (state.get(f) === 'open') { cycles.push([...stack.slice(stack.indexOf(f)), f].join(' → ')); return; }
      state.set(f, 'open');
      for (const d of graph.get(f) ?? []) if (graph.has(d)) visit(d, [...stack, f]);
      state.set(f, 'done');
    };
    for (const f of graph.keys()) visit(f, []);
    expect(cycles).toEqual([]);
  });

  // dossier → dossiers qu'il ne doit pas importer
  const FORBIDDEN = {
    'core/': ['web/', 'server/'],
    'server/': ['web/'],
    'web/session/': ['web/ui/'],
    'web/render/': ['web/session/', 'web/ui/', 'web/coach/', 'web/bot/'],
    'web/coach/': ['web/session/', 'web/ui/', 'web/render/'],
  };
  it.each(Object.entries(FORBIDDEN))('%s n’importe pas %j', (from, banned) => {
    const bad = [];
    for (const [f, deps] of graph)
      if (f.startsWith(from)) for (const d of deps) if (banned.some(b => relative(ROOT, join(ROOT, d)).startsWith(b))) bad.push(`${f} → ${d}`);
    expect(bad).toEqual([]);
  });
});
