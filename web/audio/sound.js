// Sons du jeu, fabriqués à la volée par le navigateur (Web Audio) : aucun fichier à charger, rien à mettre en cache
// pour le jeu hors ligne. Chaque thème choisit une voix (bois, verre, bol, synthé, douce) : les mêmes gestes
// sonnent différemment, comme les éclats d'une capture changent d'un thème à l'autre.
//
// Le navigateur n'autorise le son qu'après un geste du joueur : le contexte audio naît au premier clic ou toucher.
// Avant cela, et quand l'onglet est caché, les sons demandés sont simplement ignorés.
import { load, save } from '../storage.js';

// volumes proposés au menu
export const VOLUMES = { off: 0, low: 0.35, mid: 0.7, high: 1 };

// partials : rapports de fréquence des harmoniques ; ring : durée de résonance (s) ; base : note de référence (Hz) ;
// knock : fréquence du bruit d'impact (pas, chocs) ; echo : part de l'écho ; filter : coupe-haut des synthés
const VOICES = {
  soft: { wave: 'triangle', partials: [1, 2], ring: 0.5, base: 262, knock: 900, echo: 0.12 },
  wood: { wave: 'triangle', partials: [1, 3.9], ring: 0.2, base: 233, knock: 1500, echo: 0 },
  glass: { wave: 'sine', partials: [1, 2.76, 5.4], ring: 1.1, base: 523, knock: 3800, echo: 0.28 },
  bowl: { wave: 'sine', partials: [1, 2.02, 2.98], ring: 2, base: 196, knock: 700, echo: 0.3 },
  synth: { wave: 'sawtooth', partials: [1, 1.006], ring: 0.35, base: 220, knock: 2600, echo: 0.32, filter: 2200 },
};

const pref = load('sound');
let level = pref in VOLUMES ? pref : 'mid';
let V = VOICES.soft;
/** @type {AudioContext | null} */
let ctx = null;
let master = null, echoSend = null, noiseBuf = null;

function createContext() {
  ctx = new AudioContext();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  comp.connect(ctx.destination);
  master = ctx.createGain();
  master.gain.value = VOLUMES[level];
  master.connect(comp);
  // écho : un retard qui se nourrit de lui-même, d'autant plus présent que la voix résonne
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.19;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.35;
  echoSend = ctx.createGain();
  echoSend.gain.value = V.echo;
  echoSend.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

// le premier geste du joueur ouvre le son
function unlock() {
  if (!ctx) {
    try { createContext(); } catch { return; }
  }
  if (ctx.state === 'suspended') ctx.resume();
}
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, unlock, { capture: true, passive: true });

/** @returns {AudioContext | null} le contexte, s'il peut jouer maintenant */
function live() {
  if (!ctx || ctx.state !== 'running' || level === 'off' || document.hidden) return null;
  return ctx;
}

/** Volume choisi au menu ('off', 'low', 'mid', 'high'), gardé d'une visite à l'autre. */
export function setSoundLevel(v) {
  if (!(v in VOLUMES)) return;
  level = v;
  save('sound', v);
  if (master) master.gain.setTargetAtTime(VOLUMES[v], ctx.currentTime, 0.02);
}
export const soundLevel = () => level;

/** Voix du thème (themes.js : sound). */
export function setVoice(name) {
  V = VOICES[name] || VOICES.soft;
  if (echoSend) echoSend.gain.value = V.echo;
}

// ---------------------------------------------------------------- briques
const hz = semi => V.base * Math.pow(2, semi / 12);

// sortie d'une source : directe, et un peu vers l'écho
function out(node, wet = 1) {
  node.connect(master);
  if (V.echo && wet) {
    const g = ctx.createGain();
    g.gain.value = wet;
    node.connect(g); g.connect(echoSend);
  }
}

// enveloppe percussive : attaque brève, extinction exponentielle
function envelope(t, gain, attack, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

/** Note de la voix du thème : semi demi-tons au-dessus de sa note de référence. */
function note(semi, { at = 0, gain = 0.2, ring = V.ring, wave = V.wave, wet = 1 } = {}) {
  const t = ctx.currentTime + at, f = hz(semi);
  V.partials.forEach((r, k) => {
    const osc = ctx.createOscillator();
    osc.type = /** @type {OscillatorType} */ (wave);
    osc.frequency.value = f * r;
    const env = envelope(t, gain / Math.pow(k + 1, 1.4), 0.006, ring / (1 + k * 0.6));
    let last = osc.connect(env);
    if (V.filter) {
      const lp = ctx.createBiquadFilter();
      lp.frequency.value = V.filter;
      last = last.connect(lp);
    }
    out(last, wet);
    osc.start(t);
    osc.stop(t + ring + 0.1);
  });
}

/** Bruit filtré : pas, chocs, souffles. sweep : fréquence d'arrivée (le filtre glisse). */
function knock({ at = 0, gain = 0.15, freq = V.knock, q = 1.4, dur = 0.07, sweep = 0, type = 'bandpass', wet = 0.3 } = {}) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const bp = ctx.createBiquadFilter();
  bp.type = /** @type {BiquadFilterType} */ (type);
  bp.frequency.setValueAtTime(freq, t);
  if (sweep) bp.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  bp.Q.value = q;
  const env = envelope(t, gain, 0.003, dur);
  out(src.connect(bp).connect(env), wet);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

/** Coup sourd, dont la hauteur tombe (impact, battement de cœur). */
function thump({ at = 0, gain = 0.4, from = 150, to = 45, dur = 0.25 } = {}) {
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  const env = envelope(t, gain, 0.004, dur);
  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

// ---------------------------------------------------------------- sons du jeu
// (chaque son se tait si le contexte ne peut pas jouer)

/** Un pas d'une case à l'autre ; rise : différence de hauteur (le pas monte ou descend avec le relief). */
export function step(rise = 0) {
  if (!live()) return;
  knock({ gain: 0.1, freq: V.knock * Math.pow(2, rise * 0.3), dur: 0.05 });
  note(14 + rise * 2, { gain: 0.035, ring: 0.09, wet: 0 });
}

/** La pièce se pose sur sa case d'arrivée. */
export function land() {
  if (!live()) return;
  knock({ gain: 0.16, freq: V.knock * 0.6, dur: 0.09 });
  thump({ gain: 0.12, from: 120, to: 60, dur: 0.12 });
}

/** Bond ou pas en diagonale de l'Explorateur : un souffle. */
export function leap() {
  if (!live()) return;
  knock({ gain: 0.08, freq: 500, sweep: 2500, dur: 0.35, q: 0.8, wet: 0.5 });
}

/** Une pièce est choisie (preview : pièce adverse en aperçu). */
export function select(preview = false) {
  if (!live()) return;
  if (preview) { note(7, { gain: 0.08, ring: 0.18 }); note(10, { at: 0.05, gain: 0.07, ring: 0.2 }); return; }
  note(12, { gain: 0.09, ring: 0.15 });
  note(19, { at: 0.045, gain: 0.07, ring: 0.2 });
}

let lastTick = 0;
/** Survol d'une case accessible : un tic à peine audible. */
export function tick() {
  if (!live() || ctx.currentTime - lastTick < 0.05) return;
  lastTick = ctx.currentTime;
  knock({ gain: 0.035, freq: V.knock * 2.2, dur: 0.025, q: 3, wet: 0 });
}

/** Capture : choc, éclats, et une note grave d'autant plus lourde que la pièce prise est forte (str). */
export function capture(str = 1) {
  if (!live()) return;
  thump({ gain: 0.45, from: 170, to: 40, dur: 0.3 });
  knock({ gain: 0.3, freq: 300, type: 'lowpass', dur: 0.22, q: 0.7 });
  for (let k = 0; k < 4; k++) knock({ at: 0.03 + k * 0.035 + Math.random() * 0.02, gain: 0.07, freq: V.knock * (2 + Math.random() * 2), dur: 0.04, q: 4 });
  note(-12 - str, { at: 0.02, gain: 0.16, ring: V.ring * 1.4 });
  note(-6 - str, { at: 0.02, gain: 0.08, ring: V.ring });
}

// gamme pentatonique majeure : des arpèges qui sonnent juste quelle que soit leur longueur
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

/** Sortie d'une pièce : arpège montant, plus long pour une pièce plus forte (str). */
export function exit(str = 1) {
  if (!live()) return;
  const n = 3 + str;
  for (let k = 0; k < n; k++) note(PENTA[k] + 5, { at: k * 0.07, gain: 0.12, ring: V.ring + 0.2 });
  note(PENTA[n] + 5, { at: n * 0.07, gain: 0.1, ring: V.ring * 2 + 0.4 });
  knock({ at: n * 0.07, gain: 0.05, freq: 6000, dur: 0.6, q: 0.5, type: 'highpass', wet: 0.8 });
}

/** Fin de partie : 'win' (fanfare), 'lose' (descente), 'draw' (suspendu). */
export function finale(kind) {
  if (!live()) return;
  if (kind === 'win') {
    [0, 4, 7, 12, 16].forEach((s, k) => note(s, { at: k * 0.11, gain: 0.13, ring: V.ring + 0.3 }));
    for (const s of [12, 16, 19, 24]) note(s, { at: 0.62, gain: 0.08, ring: V.ring * 2.5 + 0.8 });
  } else if (kind === 'lose') {
    [7, 3, 0, -5].forEach((s, k) => note(s, { at: k * 0.22, gain: 0.12, ring: V.ring + 0.4 }));
    note(-12, { at: 0.9, gain: 0.1, ring: V.ring * 2 + 0.8 });
  } else {
    [0, 7, 5].forEach((s, k) => note(s, { at: k * 0.18, gain: 0.11, ring: V.ring + 0.4 }));
  }
}

// ---------------------------------------------------------------- moments tactiques

/** Renfort : un accord plein et grave ; saved : il met l'allié hors de prise, l'accord s'ouvre vers le haut. */
export function reinforce(saved = false, at = 0) {
  if (!live()) return;
  note(-12, { at, gain: 0.11, ring: V.ring + 0.3 });
  note(-5, { at: at + 0.03, gain: 0.08, ring: V.ring + 0.3 });
  if (saved) { note(0, { at: at + 0.12, gain: 0.08, ring: V.ring + 0.3 }); note(4, { at: at + 0.18, gain: 0.07, ring: V.ring + 0.5 }); }
}

/** Menace : triton tendu ; against : c'est le joueur qui est menacé, l'alerte se répète. */
export function threat(against = false, at = 0) {
  if (!live()) return;
  if (against) {
    for (const k of [0, 1]) { note(13, { at: at + k * 0.16, gain: 0.09, ring: 0.12, wave: 'square', wet: 0.3 }); note(7, { at: at + k * 0.16, gain: 0.07, ring: 0.12, wave: 'square', wet: 0.3 }); }
    return;
  }
  note(6, { at, gain: 0.1, ring: V.ring * 0.8 });
  note(12, { at: at + 0.09, gain: 0.08, ring: V.ring * 0.8 });
}

/** Une pièce menacée est sauvée : la tension se résout. */
export function relief(at = 0) {
  if (!live()) return;
  note(5, { at, gain: 0.08, ring: 0.2 });
  note(4, { at: at + 0.12, gain: 0.09, ring: V.ring + 0.3 });
}

/** Bonus de l'Avant-garde (+1 en attaque) : un trait électrique. */
export function zap(at = 0) {
  if (!live()) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(1800, t);
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.18);
  const env = envelope(t, 0.06, 0.004, 0.18);
  out(osc.connect(env), 0.4);
  osc.start(t); osc.stop(t + 0.25);
}

/** Une pièce peut sortir au prochain tour : battement de cœur ; decisive : cette sortie déciderait la partie. */
export function heartbeat(decisive = false, at = 0) {
  if (!live()) return;
  for (let k = 0; k < (decisive ? 3 : 1); k++) {
    thump({ at: at + k * 0.6, gain: 0.35, from: 90, to: 40, dur: 0.14 });
    thump({ at: at + k * 0.6 + 0.17, gain: 0.25, from: 80, to: 38, dur: 0.14 });
  }
}
