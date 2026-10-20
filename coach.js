// Traversal — explication des coups du bot, à partir de l'analyse renvoyée par le moteur
// (évaluation, variante prévue, alternatives, tours minimaux pour sortir).
import * as G from './game.js';

export const WIN = 100000;
const COLS = 'abcdefghij';
export const cellName = i => COLS[G.cx(i)] + (G.cy(i) + 1);
// évaluation -> chances de gain du camp qui joue (échelle calibrée sur les parties auto-jouées)
export const winProb = score => 1 / (1 + Math.exp(-score / 30));
const pct = p => `${Math.round(p * 100)} %`;
const plural = (n, w) => `${n} ${w}${Math.abs(n) > 1 ? 's' : ''}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const pieceLabel = p => `${G.TYPE_GLYPHS[p.t]} ${G.TYPE_NAMES[p.t]}`;
const sameMove = (a, b) => a.pi === b.pi && a.kind === b.kind && (a.kind === 'exit' || a.to === b.to);

export function describeMove(s, m) {
  const p = s.pieces[m.pi], from = cellName(G.idx(p.x, p.y));
  if (m.kind === 'exit') return `${pieceLabel(p)} ${from} → sortie`;
  const sp = m.special === 'jump' ? ' (bond)' : m.special === 'diag' ? ' (diagonale)' : '';
  if (m.kind === 'attack') return `${pieceLabel(p)} ${from} × ${G.TYPE_GLYPHS[s.pieces[s.cell[m.to]].t]} ${cellName(m.to)}${sp}`;
  return `${pieceLabel(p)} ${from} → ${cellName(m.to)}${sp}`;
}

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

// Analyse d'un coup : renvoie des données prêtes à afficher.
// judged : le coup est jugé (analyse de partie) et non justifié comme un choix du bot.
export function explain(before, move, info, { judged = false } = {}) {
  const side = before.turn, op = 1 - side, turns = info.turns;
  const after = G.applyMove(before, move);
  const p = before.pieces[move.pi];
  const reasons = [];
  const add = (icon, html) => reasons.push({ icon, html });

  // ---------------------------------------------------------------- sorties
  if (move.kind === 'exit') {
    if (p.t === G.SENTINEL && before.crossed === 0) add('🏁', '<b>Sentinelle première arrivée : victoire immédiate.</b>');
    else if (before.crossed === 1) add('🏁', `<b>Deuxième arrivée : la partie s’arrête</b> sur le score ${after.score[0]} – ${after.score[1]}.`);
    else {
      add('🏁', `<b>Sortie</b> : +${G.STR[p.t]} point${G.STR[p.t] > 1 ? 's' : ''}. La prochaine pièce qui sortira terminera la partie.`);
      let best = 99, bt = -1;
      for (const q of before.pieces)
        if (q.o === op && q.st === G.ON_BOARD && G.STR[q.t] >= G.STR[p.t] && turnsOf(turns, q) < best) { best = turnsOf(turns, q); bt = q.t; }
      if (bt >= 0) add('⚠️', `Risque accepté : ${G.STR[bt] > G.STR[p.t] ? 'l’adversaire gagne' : 'l’adversaire égalise'} s’il sort sa ${G.TYPE_NAMES[bt]} (au mieux dans ${plural(best, 'tour')}).`);
      else add('✅', 'Aucune pièce adverse assez forte ne peut répondre : la sortie est sûre.');
    }
  }

  // ---------------------------------------------------------------- capture
  if (move.kind === 'attack') {
    const c = move.combat, d = before.pieces[c.defender];
    const parts = [`Force ${c.base}`];
    if (c.height) parts.push(`${c.height > 0 ? '+1' : '−1'} hauteur`);
    if (c.vb) parts.push('+1 charge de l’Avant-garde');
    if (c.allies) parts.push(`+${c.allies} alliés`);
    const dparts = [`Force ${c.dBase}`];
    if (c.reinf) dparts.push(`+${c.reinf} renfort${c.reinf > 1 ? 's' : ''}`);
    add('⚔️', `<b>Capture ${pieceLabel(d)}</b> : Attaque ${c.att} (${parts.join(', ')}) ≥ Défense ${c.def} (${dparts.join(', ')}).`);
  }

  // ---------------------------------------------------------------- course des Sentinelles
  if (before.crossed === 0) {
    const m0 = bestSentinel(turns, before, side), o0 = bestSentinel(turns, before, op);
    const m1 = after.over ? m0 : bestSentinel(turns, after, side), o1 = after.over ? o0 : bestSentinel(turns, after, op);
    if (move.kind !== 'exit' && (m1 !== m0 || o1 !== o0)) add('🏃', `<b>Course des Sentinelles</b> : ${raceText(m0, o0)} → ${raceText(m1, o1)}.`);
    else if (move.kind !== 'exit' && p.t === G.SENTINEL) add('🏃', `La Sentinelle se place sans gagner de tour sur la course (${raceText(m0, o0)}) : à cause du relief, il faut parfois un détour ou une préparation.`);
    else if (move.kind !== 'exit' && (m0 < 99 || o0 < 99)) add('🏃', `Course des Sentinelles inchangée (${raceText(m0, o0)}).`);
  }

  // ---------------------------------------------------------------- avancée de la pièce jouée
  if (move.kind !== 'exit') {
    const t0 = turnsOf(turns, p), t1 = turnsAt(turns, p, move.to);
    if (p.t !== G.SENTINEL || before.crossed > 0) {
      if (t1 < t0) add('➡️', `Rapproche ${pieceLabel(p)} de la sortie : ${t0} → ${plural(t1, 'tour')}.`);
      else if (t1 > t0 && t0 < 99) add('↩️', `${pieceLabel(p)} s’éloigne de la sortie (${t0} → ${t1} tours) : coup de placement, pas de course.`);
    }
    const h0 = before.h[G.idx(p.x, p.y)], h1 = before.h[move.to];
    if (h1 - h0 >= 2) add('⛰️', `Prend de la hauteur (${h0} → ${h1}) : +1 en attaque vers le bas, et plus difficile à attaquer.`);
    let allies = 0;
    for (const n of G.NEIGH[move.to]) { const q = after.cell[n]; if (q >= 0 && q !== move.pi && after.pieces[q].o === side) allies++; }
    if (allies >= 2) add('🛡️', `Reste groupée : ${allies} alliés adjacents (+${allies} en défense).`);
    if (move.special) add('✨', move.special === 'jump' ? 'Bond de l’Explorateur : franchit le relief sans coût de hauteur.' : 'Pas en diagonale de l’Explorateur.');
  }

  // ---------------------------------------------------------------- sécurité
  if (!after.over) {
    const threatBefore = attacksBy(before, op);
    const threatAfter = after.turn === op ? attacksBy(after, op) : new Map();
    const mine = pi => before.pieces[pi].o === side;
    const saved = [...threatBefore.keys()].filter(pi => mine(pi) && !threatAfter.has(pi) && after.pieces[pi].st === G.ON_BOARD);
    const exposed = [...threatAfter.keys()].filter(pi => after.pieces[pi].o === side);
    if (saved.length) add('🛡️', `Met hors de prise ${saved.map(pi => pieceLabel(before.pieces[pi])).join(', ')}.`);
    if (exposed.length) {
      const list = exposed.map(pi => `${pieceLabel(after.pieces[pi])} (par ${threatAfter.get(pi).map(a => G.TYPE_GLYPHS[after.pieces[a].t]).join(' ')})`).join(', ');
      add('⚠️', judged ? `Laisse attaquable ${list}.` : `Laisse attaquable ${list} : le calcul montre que c’est le moindre mal, ou que la riposte est préparée (voir la suite prévue).`);
    } else if (!saved.length) add('✅', 'Aucune pièce laissée en prise.');
    const newThreats = [...attacksBy(after, side).keys()].filter(pi => !attacksBy(before, side).has(pi));
    if (newThreats.length) add('🎯', `Crée une menace sur ${newThreats.map(pi => `${pieceLabel(after.pieces[pi])} ${cellName(G.idx(after.pieces[pi].x, after.pieces[pi].y))}`).join(', ')}.`);
  }

  // ---------------------------------------------------------------- verdict
  const sc = info.score;
  let verdict;
  if (after.over) {
    const w = after.winner;
    verdict = { pSide: w === 2 ? 0.5 : w === side ? 1 : 0, text: w === 2 ? '<b>La partie se termine sur un nul.</b>' : w === side ? '<b>Ce coup gagne la partie.</b>' : '<b>Ce coup termine la partie sur une défaite</b> : il n’y avait pas mieux.' };
  } else if (sc >= WIN - 1000) verdict = { pSide: 1, text: `<b>Victoire forcée</b> : la partie est gagnée au plus tard dans ${plural(WIN - sc - before.ply, 'coup')}, quoi que fasse l’adversaire.` };
  else if (sc <= -(WIN - 1000)) verdict = { pSide: 0, text: `<b>Défaite inévitable</b> d’ici ${plural(WIN + sc - before.ply, 'coup')} : le bot retarde l’échéance au maximum.` };
  else {
    const p = winProb(sc);
    const word = p > 0.9 ? 'gagnante' : p > 0.7 ? 'nettement favorable' : p > 0.57 ? 'légèrement favorable' : p >= 0.43 ? 'équilibrée' : p >= 0.3 ? 'légèrement défavorable' : p >= 0.1 ? 'difficile' : 'perdue';
    verdict = { pSide: p, text: `Position jugée <b>${word}</b> pour ${G.PLAYER_NAMES[side]} : environ ${pct(p)} de chances de gain.` };
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
    return { move: a.move, text: describeMove(before, a.move), cost };
  });

  // ---------------------------------------------------------------- suite prévue (après ce coup)
  const plan = info.pv.slice(1, 9).map(({ move: m, before: s }) => ({ move: m, side: s.turn, text: describeMove(s, m) }));

  return {
    title: describeMove(before, move), move, side, verdict, reasons, alts, plan,
    depth: info.depth, nodes: info.nodes, noisy: info.noisy,
  };
}

// ---------------------------------------------------------------- rendu HTML du panneau
const DOT = ['#e0484f', '#4d8cf0'];
export function renderAnalysis(a, { label, history = [] } = {}) {
  const bar = `<div class="eval-bar" title="Chances de gain estimées"><i style="width:${(a.verdict.pRed * 100).toFixed(1)}%"></i>
    <span class="l">Rouge ${pct(a.verdict.pRed)}</span><span class="r">${pct(1 - a.verdict.pRed)} Bleu</span></div>`;
  const reasons = a.reasons.map(r => `<li><span class="ic">${r.icon}</span><span>${r.html}</span></li>`).join('');
  const plan = a.plan.length
    ? `<ol class="plan">${a.plan.map((p, i) => `<li data-plan="${i}"><i style="background:${DOT[p.side]}"></i>${esc(p.text)}</li>`).join('')}</ol>`
    : '<p class="muted">Pas de suite calculée au-delà de ce coup.</p>';
  const alts = a.alts.length
    ? `<ul class="alts">${a.alts.map((x, i) => `<li data-alt="${i}"><span>${esc(x.text)}</span><b>${esc(x.cost)}</b></li>`).join('')}</ul>`
    : '';
  const fmtNodes = n => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : n >= 1000 ? Math.round(n / 1000) + ' k' : String(n));
  return `
    <div class="coach-head"><span class="tag">${esc(label)}</span><span class="who" style="color:${DOT[a.side]}">${G.PLAYER_NAMES[a.side]}</span></div>
    <div class="coach-move">${esc(a.title)}</div>
    ${bar}
    <p class="verdict">${a.verdict.text}</p>
    ${sparkline(history)}
    <h4>Pourquoi ce coup</h4><ul class="reasons">${reasons}</ul>
    <h4>Suite prévue <button class="mini" id="coachPlanBtn">Voir sur le plateau</button></h4>${plan}
    ${alts ? `<h4>Coups écartés</h4>${alts}` : ''}
    <p class="muted foot">${plural(a.depth, 'coup')} d’avance · ${fmtNodes(a.nodes)} position${a.nodes > 1 ? 's' : ''} examinée${a.nodes > 1 ? 's' : ''}${a.noisy ? ' · à ce niveau, le bot ajoute volontairement du hasard' : ''}</p>`;
}

// courbe des chances de Rouge au fil de la partie
function sparkline(history) {
  if (history.length < 2) return '';
  const W = 290, H = 46, maxPly = Math.max(20, history[history.length - 1].ply);
  const pts = history.map(h => `${(h.ply / maxPly * W).toFixed(1)},${((1 - h.pRed) * H).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Chances de gain de Rouge au fil de la partie">
    <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mid"/><polyline points="${pts}"/></svg>`;
}
