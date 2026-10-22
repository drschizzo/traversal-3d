// Analyse statique : erreurs probables seulement (variables inconnues ou inutilisées, code mort…), pas de style.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', '**/node_modules/', 'engine/target/', 'server/.wrangler/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  { files: ['core/**/*.js'], languageOptions: { globals: globals['shared-node-browser'] } },
  { files: ['web/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['web/**/*worker*.js', 'web/bot/engine.worker.js'], languageOptions: { globals: globals.worker } },
  { files: ['web/sw.js', 'web/public/sw.js'], languageOptions: { globals: globals.serviceworker } },
  { files: ['server/**/*.js'], languageOptions: { globals: { ...globals.worker, WebSocketPair: 'readonly', WebSocketRequestResponsePair: 'readonly' } } },
  { files: ['tests/**/*.js', 'scripts/**/*.{js,mjs}', '*.config.js', 'e2e/**/*.js'], languageOptions: { globals: globals.node } },
];
