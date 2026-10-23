// Couleurs des camps, communes au plateau 3D (main, dark : nombres pour Three.js) et à l’interface (css).
// Feuille partagée, sans dépendance : render/, ui/ et session/ y puisent sans se connaître.
export const TEAM = [
  { main: 0xc8323c, dark: 0x5c1117, css: '#e0484f' },
  { main: 0x2c68d6, dark: 0x102c66, css: '#4d8cf0' },
];
export const DOT = TEAM.map(t => t.css);
export const GOLD = 0xffd36b;
// analyse de partie : meilleur coup (vert) et coup joué (orange), sur le plateau comme dans les panneaux
export const BEST = 0x7fe39a, PLAYED = 0xf0955a;
