// Parcours du joueur dans un vrai navigateur : le menu, le bot, une partie par lien, une partie en ligne.
import { test, expect } from '@playwright/test';

// partie complète (26 coups, Bleu gagne par sa Sentinelle) : voir tests/codec.test.js pour le format
const FINISHED = 'EAAAEJIGIxBABjcQKwarEkEGPxK_BCISKQQ2EgsAiwxIBEoMyggZDD4IJQwpCDkMHwhDDIsIVw0B';

// erreurs de la page (exceptions et console.error), vérifiées à la fin de chaque test
let errors;
// sans carte graphique, le rendu WebGL est logiciel : qualité basse, pour que les animations avancent
const lowQuality = () => localStorage.setItem('traversal.quality', 'low');
test.beforeEach(async ({ page, context }) => {
  errors = [];
  await context.addInitScript(lowQuality);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
});
test.afterEach(() => expect(errors).toEqual([]));

// le menu s'affiche avant que le jeu ne soit chargé : on attend qu'il réponde
const open = async (page, url = '/') => { await page.goto(url); await page.locator('html[data-ready]').waitFor(); };
const choose = (page, key, value) => page.locator(`.seg[data-key="${key}"] button[data-v="${value}"]`).click();
const ply = page => page.locator('#ply');

test('bot contre bot : le moteur joue, la lecture se met en pause et se revoit', async ({ page }) => {
  await open(page);
  await choose(page, 'mode', 'bvb');
  await page.locator('#btnStart').click();
  await expect(page.locator('#statusText')).toBeVisible();
  await expect.poll(async () => Number(await ply(page).textContent()), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#coach')).toContainText('L’idée');
  await page.locator('#btnPlay').click(); // pause après le coup en cours
  await expect(page.locator('#statusText')).toContainText('En pause', { timeout: 15_000 });
  await page.locator('#btnPrev').click();
  await expect(page.locator('#statusText')).toContainText('Revue — position après le coup');
});

test('partie reçue par lien : rejouée jusqu’à sa fin, puis analysée', async ({ page }) => {
  await open(page, `/#g=${FINISHED}`);
  await expect(page.locator('#over')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#overTitle')).toHaveText('Bleu l’emporte');
  await expect(page.locator('#overReason')).toHaveText('Une Sentinelle a franchi l’arrivée en premier.');
  await page.locator('#btnReview').click();
  await expect(page.locator('#review')).toContainText('Analyse de la partie');
  await expect(page.locator('#review .rv-keys li').first()).toBeVisible({ timeout: 45_000 });
});

test('partie en ligne : création du salon, invité, abandon', async ({ browser }) => {
  const newPage = async () => { const ctx = await browser.newContext(); await ctx.addInitScript(lowQuality); return ctx.newPage(); };
  const host = await newPage(), guest = await newPage();
  for (const p of [host, guest]) p.on('pageerror', e => errors.push(e.message));

  await open(host);
  await choose(host, 'mode', 'pvp');
  await choose(host, 'where', 'create');
  await host.locator('#btnStart').click();
  await expect(host.locator('#lobbyCode')).toHaveText(/^[A-HJ-NP-Z]{6}$/, { timeout: 15_000 });
  const code = await host.locator('#lobbyCode').textContent();

  await open(guest, `/#r=${code}`);
  await expect(host.locator('#statusText')).toHaveText('À vous de jouer — choisir une pièce', { timeout: 15_000 });
  await expect(guest.locator('#statusText')).toContainText('À votre adversaire de jouer');
  await expect(guest.locator('#name1')).toHaveText('Vous · Bleu');

  // l'hôte abandonne : nouvelle partie depuis le menu (sans coup joué, pas de confirmation demandée)
  await host.locator('#btnMenu').click();
  await host.locator('#btnStart').click();
  await expect(guest.locator('#overTitle')).toHaveText('Victoire', { timeout: 15_000 });
  await expect(guest.locator('#overReason')).toHaveText('Rouge a abandonné.');
});
