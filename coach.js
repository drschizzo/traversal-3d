// Traversal — explication des coups, à partir de l'analyse renvoyée par le moteur
// (évaluation, variante prévue, alternatives, tours minimaux pour sortir).
// Chaque raison porte un thème (relié au guide de stratégie), un poids et un ton : la plus lourde devient
// « l'idée » du coup, affichée en tête ; les autres se replient.
import * as G from './game.js';

export const WIN = 100000;
// évaluation -> chances de gain du camp qui joue (échelle calibrée sur les parties auto-jouées)
export const winProb = score => 1 / (1 + Math.exp(-score / 30));
export const pct = p => `${Math.round(p * 100)} %`;
export const plural = (n, w) => `${n} ${w}${Math.abs(n) > 1 ? 's' : ''}`;
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const sameMove = (a, b) => !!a && !!b && a.pi === b.pi && a.kind === b.kind && (a.kind === 'exit' || a.to === b.to);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- thèmes : ce que chaque raison enseigne
const GUIDE = 'https://github.com/drschizzo/traversal-3d/blob/main/docs/guide-strategie.md';
export const TOPICS = {
  race: { label: 'Course des Sentinelles', icon: '🏃', guide: '#2-la-course-des-sentinelles',
    principle: 'Comptez les tours, pas les cases : un tour d’avance de Sentinelle vaut une pièce entière.' },
  safety: { label: 'Sécurité des pièces', icon: '🛡️', guide: '#5-se-défendre',
    principle: 'Avant chaque coup, regardez quelles pièces adverses pourront entrer sur votre case au tour suivant, hauteur et voisins compris.' },
  capture: { label: 'Captures', icon: '⚔️', guide: '#4-le-combat',
    principle: 'Le camp qui gagne le bilan des captures l’emporte trois fois sur quatre : cherchez les attaques depuis la hauteur ou avec la charge de l’Avant-garde.' },
  exit: { label: 'Sorties', icon: '🏁', guide: '#qui-sort-en-premier-et-ce-que-ça-rapporte',
    principle: 'Ne sortez pas un Explorateur en premier, sauf si une seconde pièce suit aussitôt ; sortir une Avant-garde en premier est un pari.' },
  height: { label: 'Hauteur', icon: '⛰️', guide: '#4-le-combat',
    principle: 'La hauteur est la meilleure arme : la moitié des captures se font depuis une case plus haute.' },
  group: { label: 'Cohésion', icon: '🤝', guide: '#5-se-défendre',
    principle: 'Avancez par paires : une pièce collée à deux alliés est capturée trois fois moins souvent qu’une pièce isolée.' },
  progress: { label: 'Progression', icon: '➡️', guide: '#6-la-géographie-du-plateau',
    principle: 'Les Sentinelles courent sur les flancs, les Explorateurs tiennent le centre ; un chemin plat est souvent plus rapide qu’une ligne droite en montagne.' },
};
export const guideUrl = th => GUIDE + TOPICS[th].guide;

// ---------------------------------------------------------------- les pièces et les coups en mots
// Pas de coordonnées : une pièce se désigne par son type, son camp et, s'il le faut, son flanc
// (vu depuis le côté du plateau d'où regarde le joueur) ; un coup, par ce qu'il fait.
// ctx = { view : camp d'où l'on regarde (gauche et droite), me : camp à qui l'on parle (« votre »), −1 sinon }
const DEF_CTX = { view: 0, me: -1 };
const ART = ['l’', 'l’', 'la '];
const COLOR_ADJ = [['rouge', 'bleu'], ['rouge', 'bleue'], ['rouge', 'bleue']];

function flank(s, pi, view) {
  const p = s.pieces[pi];
  const twin = s.pieces.findIndex((q, k) => k !== pi && q.o === p.o && q.t === p.t && q.st === G.ON_BOARD);
  if (twin < 0 || p.st !== G.ON_BOARD) return '';
  const q = s.pieces[twin];
  if (p.x === q.x) {
    const ahead = p.o === 0 ? p.y > q.y : p.y < q.y;
    return ahead ? ' de devant' : ' de derrière';
  }
  const left = view === 0 ? p.x < q.x : p.x > q.x;
  return left ? ' de gauche' : ' de droite';
}

// « votre ▲ Sentinelle de gauche », « l’◆ Avant-garde adverse », « la ▲ Sentinelle bleue »
export function pieceRef(s, pi, ctx = DEF_CTX) {
  const p = s.pieces[pi], name = `${G.TYPE_GLYPHS[p.t]} ${G.TYPE_NAMES[p.t]}`, side = flank(s, pi, ctx.view);
  if (ctx.me === p.o) return `votre ${name}${side}`;
  if (ctx.me >= 0) return `${ART[p.t]}${name} adverse${side}`;
  return `${ART[p.t]}${name} ${COLOR_ADJ[p.t][p.o]}${side}`;
}

// déplacement vu par le camp qui joue : rangées gagnées vers l'arrivée, décalage à gauche ou à droite à l'écran
function shift(s, m, view) {
  const p = s.pieces[m.pi], dy = (G.cy(m.to) - p.y) * (p.o === 0 ? 1 : -1), dx = G.cx(m.to) - p.x;
  const side = dx === 0 ? '' : (dx < 0) === (view === 0) ? 'gauche' : 'droite';
  return { dy, dx: Math.abs(dx), side };
}
const rows = n => (n === 1 ? 'd’une rangée' : `de ${n} rangées`);
const cells = n => (n === 1 ? 'd’une case' : `de ${n} cases`);
const special = m => (m.special === 'jump' ? ' (bond)' : m.special === 'diag' ? ' (diagonale)' : '');

// coup à l'indicatif : « Votre ▲ Sentinelle de gauche avance de 2 rangées vers la droite »
export function moveText(s, m, ctx = DEF_CTX) {
  const ref = cap(pieceRef(s, m.pi, ctx));
  if (m.kind === 'exit') return `${ref} franchit l’arrivée`;
  if (m.kind === 'attack') return `${ref} capture ${pieceRef(s, s.cell[m.to], ctx)}${special(m)}`;
  const { dy, dx, side } = shift(s, m, ctx.view), to = side ? ` vers la ${side}` : '';
  if (dy > 0) return `${ref} avance ${rows(dy)}${to}${special(m)}`;
  if (dy < 0) return `${ref} recule ${rows(-dy)}${to}${special(m)}`;
  return `${ref} se décale ${cells(dx)}${to}${special(m)}`;
}

// coup à l'impératif, pour un conseil : « Avancez votre ▲ Sentinelle de gauche de 2 rangées »
export function moveAdvice(s, m, ctx = DEF_CTX) {
  const ref = pieceRef(s, m.pi, ctx);
  if (m.kind === 'exit') return `Faites franchir l’arrivée à ${ref}`;
  if (m.kind === 'attack') return `Capturez ${pieceRef(s, s.cell[m.to], ctx)} avec ${ref}${special(m)}`;
  const { dy, dx, side } = shift(s, m, ctx.view), to = side ? ` vers la ${side}` : '';
  if (dy > 0) return `Avancez ${ref} ${rows(dy)}${to}${special(m)}`;
  if (dy < 0) return `Reculez ${ref} ${rows(-dy)}${to}${special(m)}`;
  return `Décalez ${ref} ${cells(dx)}${to}${special(m)}`;
}

// ---------------------------------------------------------------- outils d'analyse
// tours minimaux pour sortir (terrain seul) ; 99 = inaccessible
const turnsAt = (turns, p, pos) => turns[(p.o * 3 + p.t) * 100 + pos];
const turnsOf = (turns, p) => turnsAt(turns, p, G.idx(p.x, p.y));
function bestSentinel(turns, s, o) {
  let b = 99;
  for (const p of s.pieces) if (p.o === o && p.t === G.SENTINEL && p.st === G.ON_BOARD) b = Math.min(b, turnsOf(turns, p));
  return b;
}

// attaques que le camp `by` pourrait jouer s'il avait le trait : cible -> attaquants
export function attacksBy(s, by) {
  const map = new Map();
  if (s.over) return map;
  for (const m of G.allMoves({ ...s, turn: by }, true)) {
    if (m.kind !== 'attack') continue;
    const d = s.cell[m.to];
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(m.pi);
  }
  return map;
}

function raceText(me, op) {
  if (me >= 99 && op >= 99) return 'plus aucune Sentinelle en jeu';
  if (me >= 99) return `plus de Sentinelle, celle d’en face est à ${plural(op, 'tour')} de la sortie`;
  if (op >= 99) return `seule Sentinelle encore en jeu, à ${plural(me, 'tour')} de la sortie`;
  const d = op - me;
  const lead = d > 0 ? `avance de ${plural(d, 'tour')}` : d < 0 ? `retard de ${plural(-d, 'tour')}` : 'égalité';
  return `${me} tour${me > 1 ? 's' : ''} contre ${op} : ${lead}`;
}
// avance dans la course, en tours (99 = pas de Sentinelle)
const raceLead = (me, op) => (me >= 99 && op >= 99 ? 0 : me >= 99 ? -12 : op >= 99 ? 12 : op - me);

// ---------------------------------------------------------------- explication d'un coup
// judged : le coup est jugé (analyse de partie, entraînement) et non justifié comme un choix du bot.
// Une raison : { theme, tone ('good' | 'bad' | 'info'), weight, idea (phrase courte), clue (piste sans dévoiler le coup), html }
export function explain(before, move, info, { judged = false, ctx = DEF_CTX } = {}) {
  const side = before.turn, op = 1 - side, turns = info.turns;
  const after = G.applyMove(before, move);
  const p = before.pieces[move.pi];
  const ref = pi => pieceRef(before, pi, ctx), refAfter = pi => pieceRef(after, pi, ctx);
  const reasons = [];
  const add = (theme, tone, weight, idea, html, clue = '') =>
    reasons.push({ theme, tone, weight, idea, html, clue, icon: tone === 'bad' ? '⚠️' : tone === 'info' ? '·' : TOPICS[theme].icon });

  // ---------------------------------------------------------------- sorties
  if (move.kind === 'exit') {
    if (p.t === G.SENTINEL && before.crossed === 0)
      add('exit', 'good', 100, 'Gagner : la Sentinelle franchit l’arrivée la première', '<b>Sentinelle première arrivée : victoire immédiate.</b>', 'Une Sentinelle peut gagner la partie dès ce coup.');
    else if (before.crossed === 1) {
      const w = after.winner, tone = w === side ? 'good' : w === 2 ? 'info' : 'bad';
      add('exit', tone, 90, w === side ? 'Terminer la partie en tête' : w === 2 ? 'Terminer la partie sur un nul' : 'La partie se termine sur une défaite',
        `<b>Deuxième arrivée : la partie s’arrête</b> sur le score ${after.score[0]} – ${after.score[1]}.`, 'Une sortie peut terminer la partie maintenant.');
    } else {
      add('exit', 'good', 50, `Marquer ${plural(G.STR[p.t], 'point')} en sortant ${ref(move.pi)}`,
        `<b>Sortie</b> : +${plural(G.STR[p.t], 'point')}. La prochaine pièce qui sortira terminera la partie.`, 'Une pièce peut marquer des points en franchissant l’arrivée.');
      let best = 99, bt = -1;
      for (const q of before.pieces)
        if (q.o === op && q.st === G.ON_BOARD && G.STR[q.t] >= G.STR[p.t] && turnsOf(turns, q) < best) { best = turnsOf(turns, q); bt = q.t; }
      if (bt >= 0) add('exit', 'bad', judged ? 45 : 15, 'Sortir trop tôt : l’adversaire peut répondre par une sortie aussi forte',
        `Risque : ${G.STR[bt] > G.STR[p.t] ? 'l’adversaire gagne' : 'l’adversaire égalise'} s’il sort sa ${G.TYPE_NAMES[bt]} (au mieux dans ${plural(best, 'tour')}).`);
      else add('exit', 'good', 20, 'Sortir sans risque', 'Aucune pièce adverse assez forte ne peut répondre : la sortie est sûre.');
    }
  }

  // ---------------------------------------------------------------- capture
  if (move.kind === 'attack') {
    const c = move.combat, dpi = c.defender, d = before.pieces[dpi];
    const parts = [`Force ${c.base}`];
    if (c.height) parts.push(`${c.height > 0 ? '+1' : '−1'} hauteur`);
    if (c.vb) parts.push('+1 charge de l’Avant-garde');
    if (c.allies) parts.push(`+${c.allies} alliés`);
    const dparts = [`Force ${c.dBase}`];
    if (c.reinf) dparts.push(`+${c.reinf} renfort${c.reinf > 1 ? 's' : ''}`);
    add('capture', 'good', 55 + 10 * G.STR[d.t], `Capturer ${ref(dpi)}`,
      `<b>Capture de ${ref(dpi)}</b> : Attaque ${c.att} (${parts.join(', ')}) ≥ Défense ${c.def} (${dparts.join(', ')}).`,
      'Une capture est possible : cherchez une pièce adverse à votre portée.');
  }

  // ---------------------------------------------------------------- course des Sentinelles
  if (before.crossed === 0 && move.kind !== 'exit') {
    const m0 = bestSentinel(turns, before, side), o0 = bestSentinel(turns, before, op);
    const m1 = after.over ? m0 : bestSentinel(turns, after, side), o1 = after.over ? o0 : bestSentinel(turns, after, op);
    const delta = raceLead(m1, o1) - raceLead(m0, o0);
    const html = `<b>Course des Sentinelles</b> : ${raceText(m0, o0)} → ${raceText(m1, o1)}.`;
    if (delta > 0) add('race', 'good', 40 + 12 * Math.min(delta, 3), `Gagner ${plural(delta, 'tour')} dans la course des Sentinelles`, html, 'Pensez à la course des Sentinelles : il y a un tour à gagner.');
    else if (delta < 0) add('race', 'bad', 40 + 12 * Math.min(-delta, 3), `Perdre ${plural(-delta, 'tour')} dans la course des Sentinelles`, html);
    else if (m1 !== m0 || o1 !== o0) add('race', 'info', 4, 'Course des Sentinelles', html);
    else if (p.t === G.SENTINEL) add('race', 'good', 8, 'Préparer le chemin de la Sentinelle', `La Sentinelle se place sans gagner de tour (${raceText(m0, o0)}) : à cause du relief, il faut parfois un détour ou une préparation.`, 'Pensez à la course des Sentinelles : préparez le chemin de l’une d’elles.');
    else if (m0 < 99 || o0 < 99) add('race', 'info', 0, 'Course inchangée', `Course des Sentinelles inchangée (${raceText(m0, o0)}).`);
  }

  // ---------------------------------------------------------------- avancée de la pièce jouée
  if (move.kind !== 'exit') {
    const t0 = turnsOf(turns, p), t1 = turnsAt(turns, p, move.to);
    if (p.t !== G.SENTINEL || before.crossed > 0) {
      // une fois une pièce sortie, la prochaine sortie décide de la partie : chaque tour gagné compte double
      const race2 = before.crossed > 0 ? 20 : 0;
      if (t1 < t0) add('progress', 'good', 18 + race2 + (t1 <= 1 ? 15 : 0), t1 <= 1 ? `Placer ${ref(move.pi)} à un tour de l’arrivée` : `Rapprocher ${ref(move.pi)} de l’arrivée`,
        `Rapproche ${ref(move.pi)} de la sortie : ${t0} → ${plural(t1, 'tour')}.`, t1 <= 1 ? 'Une pièce peut se placer tout près de l’arrivée.' : 'Faites progresser une pièce vers l’arrivée.');
      else if (t1 > t0 && t0 < 99) add('progress', 'info', 5, 'Coup de placement', `${cap(ref(move.pi))} s’éloigne de la sortie (${t0} → ${t1} tours) : coup de placement, pas de course.`);
    }
    const h0 = before.h[G.idx(p.x, p.y)], h1 = before.h[move.to];
    if (h1 - h0 >= 2) add('height', 'good', 15, 'Prendre de la hauteur', `Prend de la hauteur (${h0} → ${h1}) : +1 en attaque vers le bas, et plus difficile à attaquer.`, 'Cherchez une case en hauteur.');
    let allies = 0;
    for (const n of G.NEIGH[move.to]) { const q = after.cell[n]; if (q >= 0 && q !== move.pi && after.pieces[q].o === side) allies++; }
    if (allies >= 2) add('group', 'good', 12, 'Rester groupé', `Reste groupée : ${allies} alliés adjacents (+${allies} en défense).`, 'Rapprochez vos pièces les unes des autres.');
    if (move.special) add('progress', 'info', 3, 'Coup spécial de l’Explorateur', move.special === 'jump' ? 'Bond de l’Explorateur : franchit le relief sans coût de hauteur.' : 'Pas en diagonale de l’Explorateur.');
  }

  // ---------------------------------------------------------------- sécurité
  if (!after.over) {
    const threatBefore = attacksBy(before, op);
    const threatAfter = after.turn === op ? attacksBy(after, op) : new Map();
    const mine = pi => before.pieces[pi].o === side;
    const saved = [...threatBefore.keys()].filter(pi => mine(pi) && !threatAfter.has(pi) && after.pieces[pi].st === G.ON_BOARD);
    const exposed = [...threatAfter.keys()].filter(pi => after.pieces[pi].o === side);
    const strongest = list => list.reduce((a, pi) => (G.STR[after.pieces[pi].t] > G.STR[after.pieces[a].t] ? pi : a), list[0]);
    if (saved.length) {
      const k = strongest(saved);
      add('safety', 'good', 40 + 10 * G.STR[before.pieces[k].t], `Mettre ${ref(k)} à l’abri`, `Met hors de prise ${saved.map(ref).join(', ')}.`, 'Une de vos pièces est menacée.');
    }
    if (exposed.length) {
      const k = strongest(exposed);
      const list = exposed.map(pi => `${refAfter(pi)} (par ${threatAfter.get(pi).map(a => G.TYPE_GLYPHS[after.pieces[a].t]).join(' ')})`).join(', ');
      add('safety', 'bad', (judged ? 45 : 20) + 10 * G.STR[after.pieces[k].t], `Laisser ${refAfter(k)} en prise`,
        judged ? `Laisse attaquable ${list}.` : `Laisse attaquable ${list} : le calcul montre que c’est le moindre mal, ou que la riposte est préparée (voir la suite prévue).`);
    } else if (!saved.length) add('safety', 'info', 0, 'Aucune pièce en prise', 'Aucune pièce laissée en prise.');
    const before2 = attacksBy(before, side);
    const newThreats = [...attacksBy(after, side).keys()].filter(pi => !before2.has(pi));
    if (newThreats.length) {
      const k = strongest(newThreats);
      add('capture', 'good', 25 + 5 * G.STR[after.pieces[k].t], `Menacer ${refAfter(k)}`, `Crée une menace sur ${newThreats.map(refAfter).join(', ')}.`, 'Cherchez un coup qui menace une pièce adverse.');
    }
  }
  reasons.sort((a, b) => b.weight - a.weight);

  // ---------------------------------------------------------------- l'idée du coup
  // coup jugé : ce qui cloche s'il y a lieu ; sinon ce que le coup apporte de plus important
  const lead = (judged && reasons.find(r => r.tone === 'bad' && r.weight >= 30)) || reasons.find(r => r.tone === 'good') || reasons[0]
    || { theme: 'progress', tone: 'info', weight: 0, idea: 'Coup d’attente', html: '', clue: '', icon: '·' };
  const clue = reasons.find(r => r.tone === 'good' && r.clue)?.clue || 'Pas d’urgence : améliorez la position d’une de vos pièces.';

  // ---------------------------------------------------------------- verdict
  const sc = info.score;
  const name = ctx.me === side ? 'vous' : G.PLAYER_NAMES[side];
  let verdict;
  if (after.over) {
    const w = after.winner;
    verdict = { pSide: w === 2 ? 0.5 : w === side ? 1 : 0, text: w === 2 ? '<b>La partie se termine sur un nul.</b>' : w === side ? '<b>Ce coup gagne la partie.</b>' : '<b>Ce coup termine la partie sur une défaite</b> : il n’y avait pas mieux.' };
  } else if (sc >= WIN - 1000) verdict = { pSide: 1, text: `<b>Victoire forcée</b> : la partie est gagnée au plus tard dans ${plural(WIN - sc - before.ply, 'coup')}, quoi que fasse l’adversaire.` };
  else if (sc <= -(WIN - 1000)) verdict = { pSide: 0, text: `<b>Défaite inévitable</b> d’ici ${plural(WIN + sc - before.ply, 'coup')} : ${judged ? 'il n’y a plus de parade' : 'le bot retarde l’échéance au maximum'}.` };
  else {
    const pr = winProb(sc);
    const word = pr > 0.9 ? 'gagnante' : pr > 0.7 ? 'nettement favorable' : pr > 0.57 ? 'légèrement favorable' : pr >= 0.43 ? 'équilibrée' : pr >= 0.3 ? 'légèrement défavorable' : pr >= 0.1 ? 'difficile' : 'perdue';
    verdict = { pSide: pr, text: `Position <b>${word}</b> pour ${name} : environ ${pct(pr)} de chances de gain.` };
  }
  verdict.pRed = side === 0 ? verdict.pSide : 1 - verdict.pSide;

  // ---------------------------------------------------------------- alternatives écartées
  const alts = info.alts.filter(a => !sameMove(a.move, move)).slice(0, 3).map(a => {
    let cost;
    if (Math.abs(a.score) >= WIN - 1000 || Math.abs(sc) >= WIN - 1000) cost = a.score >= WIN - 1000 ? 'gagne aussi' : a.score <= -(WIN - 1000) ? 'perd par force' : 'ne force pas la victoire';
    else {
      const d = Math.round((winProb(a.score) - winProb(sc)) * 100);
      cost = d === 0 ? 'presque équivalent' : `${d > 0 ? '+' : '−'}${Math.abs(d)} % de chances`;
    }
    return { move: a.move, text: moveText(before, a.move, ctx), cost };
  });

  // ---------------------------------------------------------------- suite prévue (après ce coup)
  const plan = info.pv.slice(1, 9).map(({ move: m, before: s }) => ({ move: m, side: s.turn, before: s, text: moveText(s, m, ctx) }));

  return {
    title: moveText(before, move, ctx), advice: moveAdvice(before, move, ctx), pieceRef: pieceRef(before, move.pi, ctx),
    move, side, verdict, reasons, idea: lead, clue, alts, plan,
    depth: info.depth, nodes: info.nodes, noisy: info.noisy,
  };
}

// ---------------------------------------------------------------- rendu HTML
const DOT = ['#e0484f', '#4d8cf0'];
// les coups cités dans un panneau sont montrés sur le plateau au survol (ou au toucher) : chaque panneau
// enregistre les siens, et la page relie ensuite les éléments [data-mv] à leur coup
export function moveRegistry() {
  const list = [];
  const chip = (m, html, { tag = 'span', cls = '', attrs = '' } = {}) =>
    `<${tag} class="mv-chip${cls ? ' ' + cls : ''}" data-mv="${list.push(m) - 1}"${attrs}>${html}</${tag}>`;
  return { list, chip };
}

export const reasonList = (list, cls = 'reasons') =>
  list.length ? `<ul class="${cls}">${list.map(r => `<li class="${r.tone}"><span class="ic">${r.icon}</span><span>${r.html}</span></li>`).join('')}</ul>` : '';

export const ideaBox = (idea, kicker = 'L’idée') =>
  `<div class="idea ${idea.tone}"><span class="ic">${TOPICS[idea.theme].icon}</span><div><small>${kicker}</small><b>${esc(idea.idea)}</b></div></div>`;

export const principleBox = theme =>
  `<div class="principle"><span>${TOPICS[theme].icon}</span><p><b>${TOPICS[theme].label}.</b> ${TOPICS[theme].principle} <a href="${guideUrl(theme)}" target="_blank" rel="noopener">Le guide ↗</a></p></div>`;

const fmtNodes = n => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : n >= 1000 ? Math.round(n / 1000) + ' k' : String(n));

function evalBar(pRed) {
  return `<div class="eval-bar" title="Chances de gain estimées"><i style="width:${(pRed * 100).toFixed(1)}%"></i>
    <span class="l">Rouge ${pct(pRed)}</span><span class="r">${pct(1 - pRed)} Bleu</span></div>`;
}

// le reste de l'analyse, replié sous l'idée : raisons secondaires, suite prévue, coups écartés
function detailsHtml(a, reg, history, { skip = null, open = false } = {}) {
  const rest = a.reasons.filter(r => r !== skip && r.weight > 0);
  const plan = a.plan.length
    ? `<ol class="plan">${a.plan.map((p, i) => reg.chip(p.move, `<i style="background:${DOT[p.side]}"></i>${esc(p.text)}`, { tag: 'li', attrs: ` data-plan="${i}"` })).join('')}</ol>`
    : '<p class="muted">Pas de suite calculée au-delà de ce coup.</p>';
  const alts = a.alts.length
    ? `<ul class="alts">${a.alts.map(x => reg.chip(x.move, `<span>${esc(x.text)}</span><b>${esc(x.cost)}</b>`, { tag: 'li' })).join('')}</ul>` : '';
  return `<details${open ? ' open' : ''}><summary>Plus de détails</summary>
    ${evalBar(a.verdict.pRed)}
    <p class="verdict">${a.verdict.text}</p>
    ${sparkline(history)}
    ${rest.length ? `<h4>Toutes les raisons</h4>${reasonList(rest)}` : ''}
    <h4>Suite prévue <button class="mini" id="coachPlanBtn">Voir sur le plateau</button></h4>${plan}
    ${alts ? `<h4>Coups écartés</h4>${alts}` : ''}
    <p class="muted foot">${plural(a.depth, 'coup')} d’avance · ${fmtNodes(a.nodes)} position${a.nodes > 1 ? 's' : ''} examinée${a.nodes > 1 ? 's' : ''}${a.noisy ? ' · à ce niveau, le bot ajoute volontairement du hasard' : ''}</p>
  </details>`;
}

// explication d'un coup joué (bot, ou coup revu en bot contre bot) : l'idée en tête, deux raisons, le reste replié
export function renderAnalysis(a, reg, { label, history = [], compact = false } = {}) {
  const key = a.reasons.filter(r => r !== a.idea && r.weight >= 10).slice(0, compact ? 1 : 2);
  return `
    <div class="coach-head"><span class="tag">${esc(label)}</span><span class="who" style="color:${DOT[a.side]}">${G.PLAYER_NAMES[a.side]}</span></div>
    ${reg.chip(a.move, esc(a.title), { tag: 'div', cls: 'coach-move' })}
    ${ideaBox(a.idea)}
    ${reasonList(key, 'reasons key')}
    ${detailsHtml(a, reg, history, { skip: a.idea })}`;
}

// conseil en trois temps : une piste, puis la pièce, puis le coup
export const HINT_STEPS = ['Piste', 'La pièce', 'Le coup'];
export function renderHint(a, level, reg, { history = [] } = {}) {
  const steps = `<div class="hint-steps">${HINT_STEPS.map((s, i) => `<span class="${i < level ? 'on' : ''}">${i + 1}. ${s}</span>`).join('')}</div>`;
  let body;
  if (level === 1) body = `<div class="what">${esc(a.clue)}</div>
    <p class="muted">Cherchez d’abord par vous-même. Besoin d’aide ?</p>
    <div class="hint-cta"><button class="mini" data-hint="2">Montrer la pièce</button><button class="mini" data-hint="3">Montrer le coup</button></div>`;
  else if (level === 2) body = `<div class="what">Jouez ${esc(a.pieceRef)}</div>
    <p class="muted">${esc(a.clue)} Ses cases accessibles sont éclairées : à vous de choisir la bonne.</p>
    <div class="hint-cta"><button class="mini" data-hint="3">Montrer le coup</button></div>`;
  else body = `${reg.chip(a.move, esc(a.advice), { tag: 'div', cls: 'what' })}
    ${ideaBox(a.idea, 'Pourquoi')}
    ${reasonList(a.reasons.filter(r => r !== a.idea && r.weight >= 10).slice(0, 2), 'reasons key')}
    <div class="hint-cta"><button class="accent" id="coachPlayHint">Jouer ce coup</button></div>`;
  return `
    <div class="coach-head"><span class="tag">Conseil</span><span class="who" style="color:${DOT[a.side]}">${G.PLAYER_NAMES[a.side]}</span></div>
    ${steps}
    <div class="hint-box">${body}</div>
    ${level === 3 ? detailsHtml(a, reg, history, { skip: a.idea }) : ''}`;
}

// courbe des chances de Rouge au fil de la partie
function sparkline(history) {
  if (history.length < 2) return '';
  const W = 290, H = 46, maxPly = Math.max(20, history[history.length - 1].ply);
  const pts = history.map(h => `${(h.ply / maxPly * W).toFixed(1)},${((1 - h.pRed) * H).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Chances de gain de Rouge au fil de la partie">
    <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mid"/><polyline points="${pts}"/></svg>`;
}
