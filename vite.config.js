// Jeu (web/) servi et construit par Vite. Le résultat (dist/) est publié par le Worker (server/wrangler.jsonc).
//   npm run dev         → jeu sur http://localhost:5173, salons relayés vers `npm run dev:server` (port 8787)
//   npm run build       → dist/
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: './', // chemins relatifs : le jeu fonctionne servi depuis n'importe quel dossier
  publicDir: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 900, // Three.js
  },
  worker: { format: 'es' },
  server: {
    port: 5173,
    // salons en ligne : même origine que la page en développement, relayés vers wrangler dev
    proxy: { '/room': { target: 'http://localhost:8787', ws: true } },
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.js'], // e2e/ : Playwright (npm run e2e)
  },
});
