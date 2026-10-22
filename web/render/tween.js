// Animations : interpolations avancées à chaque image par la boucle de rendu (loop.js), sur le temps des images
// rendues (rien ne saute quand le rendu se met en pause)
const tweens = [];

/** Appelle fn(k) à chaque image, k allant de 0 à 1 en dur secondes ; la promesse se résout à la fin. */
export const tween = (dur, fn) => new Promise(res => tweens.push({ t: 0, dur, fn, res }));
export const easeIO = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const wait = ms => new Promise(r => setTimeout(r, ms));
export const tweening = () => tweens.length > 0;

export function stepTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    tw.fn(k);
    if (k >= 1) { tweens.splice(i, 1); tw.res(); }
  }
}
