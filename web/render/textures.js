// Petites textures dessinées au canevas : pastilles numérotées, cases en surbrillance, flèche, anneau, halo
import * as THREE from 'three';

const canvasTexture = (size, draw, srgb = true) => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

// halo rond et doux (particules, lueur des repères des pièces)
export const radialTexture = size => canvasTexture(size, (g, n) => {
  const r = n / 2, grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, n, n);
}, false);

// pastille numérotée : hauteur des cases, numéros de la suite prévue
const numTexCache = {};
export function numberTexture(n) {
  return (numTexCache[n] ??= canvasTexture(64, g => {
    g.fillStyle = 'rgba(15,18,25,.55)';
    g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
    g.font = 'bold 38px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.fillText(String(n), 32, 35);
  }));
}

function tileTexture(kind) {
  const t = canvasTexture(128, g => {
    const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
    if (kind === 'arrow') {
      g.fillStyle = 'rgba(255,255,255,.95)';
      g.beginPath(); g.moveTo(64, 10); g.lineTo(112, 62); g.lineTo(82, 62); g.lineTo(82, 116); g.lineTo(46, 116); g.lineTo(46, 62); g.lineTo(16, 62); g.closePath(); g.fill();
    } else if (kind === 'target') {
      // viseur : cercle et quatre traits, sur fond sombre pour rester lisible au-dessus des pièces
      g.fillStyle = 'rgba(15,18,25,.55)';
      g.beginPath(); g.arc(64, 64, 40, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 9; g.lineCap = 'round';
      g.beginPath(); g.arc(64, 64, 30, 0, Math.PI * 2); g.stroke();
      g.beginPath();
      for (const [a, b] of [[64, 8], [64, 120], [8, 64], [120, 64]]) { g.moveTo(a, b); g.lineTo(a + Math.sign(64 - a) * 30, b + Math.sign(64 - b) * 30); }
      g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 8, 0, Math.PI * 2); g.fill();
    } else if (kind === 'ring') {
      g.strokeStyle = '#fff'; g.lineWidth = 9;
      g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 0.25; g.lineWidth = 22; g.stroke();
    } else {
      const grd = g.createRadialGradient(64, 64, 10, 64, 64, 80);
      grd.addColorStop(0, 'rgba(255,255,255,.25)'); grd.addColorStop(1, 'rgba(255,255,255,.6)');
      g.fillStyle = grd; rr(8, 8, 112, 112, 20); g.fill();
      g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 6; rr(8, 8, 112, 112, 20); g.stroke();
    }
  });
  t.anisotropy = 4;
  return t;
}
export const TEX = { tile: tileTexture('tile'), arrow: tileTexture('arrow'), ring: tileTexture('ring'), target: tileTexture('target') };
