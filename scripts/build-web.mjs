// Construit le jeu (dist/) avant que wrangler ne le publie ou ne le serve (build.command de server/wrangler.jsonc).
// Installe d'abord les dépendances du dépôt si elles manquent : c'est le cas lors d'un déploiement par
// Workers Builds, qui n'installe que celles de server/.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = cmd => execSync(cmd, { cwd: root, stdio: 'inherit' });

if (!existsSync(new URL('../node_modules/vite', import.meta.url))) run('npm ci --no-audit --no-fund');
run('npx vite build');
