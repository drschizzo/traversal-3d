#!/usr/bin/env python3
"""Graphiques SVG du guide de stratégie (sans dépendance graphique).

    python3 figures.py dossier_de_sortie games.jsonl [autres.jsonl ...]
"""
import json
import sys
from collections import defaultdict

import numpy as np

INK, MUTED, GRID, BG = '#2b2b2b', '#707070', '#e4e4e4', '#ffffff'
RED, BLUE = '#c0392b', '#2471a3'
SEQ = ['#a9c4e0', '#5b8cc2', '#1f4e85']
STR = [1, 2, 3]
FONT = 'font-family="system-ui, -apple-system, Segoe UI, sans-serif"'


def result(g, side):
    if g['winner'] == 2:
        return 0.5
    return 1.0 if g['winner'] == side else 0.0


class Chart:
    """Repère cartésien minimal : axes, grille, étiquettes."""

    def __init__(self, w, h, xr, yr, xlabel, ylabel, ml=56, mb=46, mt=16, mr=16):
        self.w, self.h, self.xr, self.yr = w, h, xr, yr
        self.ml, self.mb, self.mt, self.mr = ml, mb, mt, mr
        self.el = [f'<rect width="{w}" height="{h}" fill="{BG}"/>']
        self.xlabel, self.ylabel = xlabel, ylabel

    def x(self, v):
        return self.ml + (v - self.xr[0]) / (self.xr[1] - self.xr[0]) * (self.w - self.ml - self.mr)

    def y(self, v):
        return self.h - self.mb - (v - self.yr[0]) / (self.yr[1] - self.yr[0]) * (self.h - self.mb - self.mt)

    def axes(self, xticks, yticks, xfmt=str, yfmt=str):
        for t in yticks:
            self.el.append(f'<line x1="{self.ml}" x2="{self.w - self.mr}" y1="{self.y(t):.1f}" y2="{self.y(t):.1f}" stroke="{GRID}"/>')
            self.el.append(f'<text x="{self.ml - 8}" y="{self.y(t) + 4:.1f}" text-anchor="end" font-size="11" fill="{MUTED}" {FONT}>{yfmt(t)}</text>')
        for t in xticks:
            self.el.append(f'<text x="{self.x(t):.1f}" y="{self.h - self.mb + 17}" text-anchor="middle" font-size="11" fill="{MUTED}" {FONT}>{xfmt(t)}</text>')
        self.el.append(f'<line x1="{self.ml}" x2="{self.w - self.mr}" y1="{self.h - self.mb}" y2="{self.h - self.mb}" stroke="{MUTED}"/>')
        self.el.append(f'<text x="{(self.ml + self.w - self.mr) / 2:.1f}" y="{self.h - 8}" text-anchor="middle" font-size="12" fill="{INK}" {FONT}>{self.xlabel}</text>')
        self.el.append(f'<text transform="translate(14 {(self.mt + self.h - self.mb) / 2:.1f}) rotate(-90)" text-anchor="middle" font-size="12" fill="{INK}" {FONT}>{self.ylabel}</text>')

    def line(self, pts, color, label=None, lx=None, ly=None):
        d = ' '.join(f'{"M" if i == 0 else "L"}{self.x(a):.1f},{self.y(b):.1f}' for i, (a, b) in enumerate(pts))
        self.el.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2"/>')
        for a, b in pts:
            self.el.append(f'<circle cx="{self.x(a):.1f}" cy="{self.y(b):.1f}" r="3.2" fill="{color}"/>')
        if label:
            self.el.append(f'<text x="{lx}" y="{ly}" font-size="11" fill="{color}" {FONT}>{label}</text>')

    def svg(self):
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" width="{self.w}" height="{self.h}">' + ''.join(self.el) + '</svg>'


def save(path, s):
    with open(path, 'w') as f:
        f.write(s)


def race_chart(games):
    c = Chart(640, 330, (-4.4, 4.4), (0, 100), 'Avance de ma Sentinelle la plus proche (tours de moins que celle d’en face)', 'Score du camp au trait (%)')
    c.axes(range(-4, 5), range(0, 101, 25), xfmt=lambda t: f'{t:+d}' if t else '0', yfmt=lambda t: f'{t}')
    c.el.append(f'<line x1="{c.x(-4.4)}" x2="{c.x(4.4)}" y1="{c.y(50)}" y2="{c.y(50)}" stroke="{MUTED}" stroke-dasharray="4 3"/>')
    for i, at in enumerate((10, 20, 30)):
        d = defaultdict(list)
        for g in games:
            if len(g['moves']) <= at:
                continue
            m = g['moves'][at]
            s = m['snap']
            me, op = m['o'], 1 - m['o']
            sm = min(s[me * 6 + 4], s[me * 6 + 5], 12)
            so = min(s[op * 6 + 4], s[op * 6 + 5], 12)
            d[int(np.clip(so - sm, -4, 4))].append(result(g, me))
        pts = [(k, np.mean(d[k]) * 100) for k in sorted(d) if len(d[k]) >= 40]
        c.line(pts, SEQ[i], f'au coup {at}', c.ml + 12, c.mt + 14 + 15 * i)
    return c.svg()


def material_chart(games):
    d = defaultdict(list)
    for g in games:
        if len(g['moves']) <= 30:
            continue
        s = g['moves'][30]['snap']
        force = [sum(STR[t] for t in range(3) for v in s[o * 6 + t * 2: o * 6 + t * 2 + 2] if v != 99) for o in range(2)]
        d[int(np.clip(force[0] - force[1], -6, 6))].append(result(g, 0))
    c = Chart(640, 320, (-6.6, 6.6), (0, 100), 'Différence de Force encore sur le plateau au coup 30 (Rouge − Bleu)', 'Score de Rouge (%)')
    c.axes(range(-6, 7), range(0, 101, 25), xfmt=lambda t: f'{t:+d}' if t else '0')
    bw = (c.x(1) - c.x(0)) * 0.7
    for k in sorted(d):
        if len(d[k]) < 30:
            continue
        v = np.mean(d[k]) * 100
        col = RED if k > 0 else BLUE if k < 0 else MUTED
        y0, y1 = sorted((c.y(50), c.y(v)))
        c.el.append(f'<rect x="{c.x(k) - bw / 2:.1f}" y="{y0:.1f}" width="{bw:.1f}" height="{max(y1 - y0, 1):.1f}" fill="{col}" opacity="0.85"/>')
        c.el.append(f'<text x="{c.x(k):.1f}" y="{(c.y(v) - 5 if v >= 50 else c.y(v) + 14):.1f}" text-anchor="middle" font-size="10" fill="{MUTED}" {FONT}>{len(d[k])}</text>')
    c.el.append(f'<line x1="{c.ml}" x2="{c.w - c.mr}" y1="{c.y(50)}" y2="{c.y(50)}" stroke="{MUTED}"/>')
    return c.svg()


def heatmaps(games):
    cell, gap, top = 22, 28, 34
    w = 3 * 10 * cell + 2 * gap + 120
    h = 10 * cell + top + 30
    el = [f'<rect width="{w}" height="{h}" fill="{BG}"/>']
    for t, name in enumerate(['Explorateur', 'Avant-garde', 'Sentinelle']):
        heat = np.zeros(100)
        for g in games:
            for m in g['moves']:
                if m['t'] == t and m['k'] != 2:
                    heat[m['to'] if m['o'] == 0 else 99 - m['to']] += 1
        heat /= heat.max() or 1
        x0 = 70 + t * (10 * cell + gap)
        el.append(f'<text x="{x0 + 5 * cell}" y="20" text-anchor="middle" font-size="13" fill="{INK}" {FONT}>{name}</text>')
        for i in range(100):
            x, y = i % 10, i // 10
            a = heat[i] ** 0.6
            el.append(f'<rect x="{x0 + x * cell}" y="{top + (9 - y) * cell}" width="{cell - 1}" height="{cell - 1}" fill="{RED}" fill-opacity="{a:.3f}" stroke="{GRID}" stroke-width="0.5"/>')
    el.append(f'<text x="62" y="{top + 12}" text-anchor="end" font-size="11" fill="{MUTED}" {FONT}>arrivée</text>')
    el.append(f'<text x="62" y="{top + 10 * cell - 6}" text-anchor="end" font-size="11" fill="{MUTED}" {FONT}>départ</text>')
    el.append(f'<text x="{w / 2}" y="{h - 8}" text-anchor="middle" font-size="11" fill="{MUTED}" {FONT}>Cases d’arrivée des déplacements et captures, vues depuis le camp qui joue (plus foncé = plus fréquent)</text>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">' + ''.join(el) + '</svg>'


def main():
    out = sys.argv[1]
    games = []
    for p in sys.argv[2:]:
        with open(p) as f:
            games += [json.loads(l) for l in f if l.strip()]
    save(f'{out}/course-sentinelles.svg', race_chart(games))
    save(f'{out}/materiel.svg', material_chart(games))
    save(f'{out}/cartes-de-chaleur.svg', heatmaps(games))


if __name__ == '__main__':
    main()
