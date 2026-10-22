// Explication des coups, à partir de l'analyse renvoyée par le moteur (évaluation, variante prévue, alternatives,
// tours minimaux pour sortir). Pur : renvoie des données, que ui/coach-view.js met en page.
// Chaque raison porte un thème (relié au guide de stratégie), un poids et un ton : la plus lourde devient
// « l'idée » du coup, affichée en tête ; les autres se replient.
import * as G from '../../core/index.js';
import { WIN, isMateScore, sameMove } from '../../core/index.js';
import { PLAYER_NAMES, TYPE_GLYPHS, TYPE_NAMES } from '../i18n/fr.js';
import { DEF_CTX, pieceRef, moveText, moveAdvice, plural, pct, cap } from './wording.js';

// évaluation -> chances de gain du camp qui joue (échelle calibrée sur les parties auto-jouées)
export const winProb = score => 1 / (1 + Math.exp(-score / 30));

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
function attacksBy(s, by) {
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
// Une raison : { theme, tone ('good' | 'bad' | 'info'), weight, idea (phrase courte), clue (piste sans dévoiler le coup),
// text (explication, en texte enrichi : **gras**) }
export function explain(before, move, info, { judged = false, ctx = DEF_CTX } = {}) {
  const side = before.turn, op = 1 - side, turns = info.turns;
  const after = G.applyMove(before, move);
  const p = before.pieces[move.pi];
  const ref = pi => pieceRef(before, pi, ctx), refAfter = pi => pieceRef(after, pi, ctx);
  const reasons = [];
  const add = (theme, tone, weight, idea, text, clue = '') =>
    reasons.push({ theme, tone, weight, idea, text, clue });

  // ---------------------------------------------------------------- sorties
  if (move.kind === 'exit') {
    if (p.t === G.SENTINEL && before.crossed === 0)
      add('exit', 'good', 100, 'Gagner : la Sentinelle franchit l’arrivée la première', '**Sentinelle première arrivée : victoire immédiate.**', 'Une Sentinelle peut gagner la partie dès ce coup.');
    else if (before.crossed === 1) {
      const w = after.winner, tone = w === side ? 'good' : w === 2 ? 'info' : 'bad';
      add('exit', tone, 90, w === side ? 'Terminer la partie en tête' : w === 2 ? 'Terminer la partie sur un nul' : 'La partie se termine sur une défaite',
        `**Deuxième arrivée : la partie s’arrête** sur le score ${after.score[0]} – ${after.score[1]}.`, 'Une sortie peut terminer la partie maintenant.');
    } else {
      add('exit', 'good', 50, `Marquer ${plural(G.STR[p.t], 'point')} en sortant ${ref(move.pi)}`,
        `**Sortie** : +${plural(G.STR[p.t], 'point')}. La prochaine pièce qui sortira terminera la partie.`, 'Une pièce peut marquer des points en franchissant l’arrivée.');
      let best = 99, bt = -1;
      for (const q of before.pieces)
        if (q.o === op && q.st === G.ON_BOARD && G.STR[q.t] >= G.STR[p.t] && turnsOf(turns, q) < best) { best = turnsOf(turns, q); bt = q.t; }
      if (bt >= 0) add('exit', 'bad', judged ? 45 : 15, 'Sortir trop tôt : l’adversaire peut répondre par une sortie aussi forte',
        `Risque : ${G.STR[bt] > G.STR[p.t] ? 'l’adversaire gagne' : 'l’adversaire égalise'} s’il sort sa ${TYPE_NAMES[bt]} (au mieux dans ${plural(best, 'tour')}).`);
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
      `**Capture de ${ref(dpi)}** : Attaque ${c.att} (${parts.join(', ')}) ≥ Défense ${c.def} (${dparts.join(', ')}).`,
      'Une capture est possible : cherchez une pièce adverse à votre portée.');
  }

  // ---------------------------------------------------------------- course des Sentinelles
  if (before.crossed === 0 && move.kind !== 'exit') {
    const m0 = bestSentinel(turns, before, side), o0 = bestSentinel(turns, before, op);
    const m1 = after.over ? m0 : bestSentinel(turns, after, side), o1 = after.over ? o0 : bestSentinel(turns, after, op);
    const delta = raceLead(m1, o1) - raceLead(m0, o0);
    const text = `**Course des Sentinelles** : ${raceText(m0, o0)} → ${raceText(m1, o1)}.`;
    if (delta > 0) add('race', 'good', 40 + 12 * Math.min(delta, 3), `Gagner ${plural(delta, 'tour')} dans la course des Sentinelles`, text, 'Pensez à la course des Sentinelles : il y a un tour à gagner.');
    else if (delta < 0) add('race', 'bad', 40 + 12 * Math.min(-delta, 3), `Perdre ${plural(-delta, 'tour')} dans la course des Sentinelles`, text);
    else if (m1 !== m0 || o1 !== o0) add('race', 'info', 4, 'Course des Sentinelles', text);
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
      const list = exposed.map(pi => `${refAfter(pi)} (par ${threatAfter.get(pi).map(a => TYPE_GLYPHS[after.pieces[a].t]).join(' ')})`).join(', ');
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
    || { theme: 'progress', tone: 'info', weight: 0, idea: 'Coup d’attente', text: '', clue: '' };
  const clue = reasons.find(r => r.tone === 'good' && r.clue)?.clue || 'Pas d’urgence : améliorez la position d’une de vos pièces.';

  // ---------------------------------------------------------------- verdict
  const sc = info.score;
  const name = ctx.me === side ? 'vous' : PLAYER_NAMES[side];
  /** @type {{ pSide: number, text: string, pRed?: number }} */
  let verdict;
  if (after.over) {
    const w = after.winner;
    verdict = { pSide: w === 2 ? 0.5 : w === side ? 1 : 0, text: w === 2 ? '**La partie se termine sur un nul.**' : w === side ? '**Ce coup gagne la partie.**' : '**Ce coup termine la partie sur une défaite** : il n’y avait pas mieux.' };
  } else if (sc >= WIN - 1000) verdict = { pSide: 1, text: `**Victoire forcée** : la partie est gagnée au plus tard dans ${plural(WIN - sc - before.ply, 'coup')}, quoi que fasse l’adversaire.` };
  else if (sc <= -(WIN - 1000)) verdict = { pSide: 0, text: `**Défaite inévitable** d’ici ${plural(WIN + sc - before.ply, 'coup')} : ${judged ? 'il n’y a plus de parade' : 'le bot retarde l’échéance au maximum'}.` };
  else {
    const pr = winProb(sc);
    const word = pr > 0.9 ? 'gagnante' : pr > 0.7 ? 'nettement favorable' : pr > 0.57 ? 'légèrement favorable' : pr >= 0.43 ? 'équilibrée' : pr >= 0.3 ? 'légèrement défavorable' : pr >= 0.1 ? 'difficile' : 'perdue';
    verdict = { pSide: pr, text: `Position **${word}** pour ${name} : environ ${pct(pr)} de chances de gain.` };
  }
  verdict.pRed = side === 0 ? verdict.pSide : 1 - verdict.pSide;

  // ---------------------------------------------------------------- alternatives écartées
  const alts = info.alts.filter(a => !sameMove(a.move, move)).slice(0, 3).map(a => {
    let cost;
    if (isMateScore(a.score) || isMateScore(sc)) cost = a.score >= WIN - 1000 ? 'gagne aussi' : a.score <= -(WIN - 1000) ? 'perd par force' : 'ne force pas la victoire';
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

