#!/usr/bin/env python3
"""Statistiques sur des parties auto-jouées (sortie de `selfplay gen`).

    python3 analyze.py games.jsonl [autres.jsonl ...] > rapport.json

Chaque section du rapport est un dictionnaire ; les taux sont accompagnés d'un intervalle de confiance à 95 %.
"""
import json
import math
import sys
from collections import Counter, defaultdict

import numpy as np
from scipy.optimize import minimize

TYPES = ['E', 'V', 'S']           # Explorateur, Avant-garde, Sentinelle
STR = [1, 2, 3]
REASONS = {1: 'sentinelle_premiere', 2: 'deux_sorties', 3: 'limite_200', 4: 'bloque'}
N = 10


def load(paths):
    games = []
    for p in paths:
        with open(p) as f:
            for line in f:
                line = line.strip()
                if line:
                    games.append(json.loads(line))
    return games


def rate(k, n):
    """Taux et intervalle de Wilson à 95 %."""
    if n == 0:
        return {'n': 0}
    p = k / n
    z = 1.96
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return {'p': round(p, 4), 'lo': round(c - h, 4), 'hi': round(c + h, 4), 'n': n}


def result(g, side):
    """1 victoire, 0.5 nul, 0 défaite, pour le camp side."""
    if g['winner'] == 2:
        return 0.5
    return 1.0 if g['winner'] == side else 0.0


def snap_counts(m):
    """Instantané -> (tours restants triés par camp et type, nombre de pièces par camp et type)."""
    s = m['snap']  # 12 valeurs : camp0 E1 E2 V1 V2 S1 S2, camp1 ...
    tl = [[s[o * 6 + t * 2: o * 6 + t * 2 + 2] for t in range(3)] for o in range(2)]
    cnt = [[sum(1 for v in tl[o][t] if v != 99) for t in range(3)] for o in range(2)]
    return tl, cnt


def logistic(X, y, l2=1e-3):
    """Régression logistique (y dans [0, 1]) par maximum de vraisemblance."""
    X = np.asarray(X, float)
    y = np.asarray(y, float)

    def nll(w):
        z = X @ w
        return np.sum(np.logaddexp(0, z) - y * z) + l2 * np.sum(w[1:] ** 2)

    def grad(w):
        p = 1 / (1 + np.exp(-(X @ w)))
        g = X.T @ (p - y)
        g[1:] += 2 * l2 * w[1:]
        return g

    r = minimize(nll, np.zeros(X.shape[1]), jac=grad, method='L-BFGS-B')
    w = r.x
    p = 1 / (1 + np.exp(-(X @ w)))
    H = (X * (p * (1 - p))[:, None]).T @ X + 1e-9 * np.eye(X.shape[1])
    se = np.sqrt(np.diag(np.linalg.inv(H)))
    return w, se


def main():
    games = load(sys.argv[1:])
    R = {}
    n = len(games)
    R['parties'] = n

    # ---------------------------------------------------------- résultats globaux
    red = sum(1 for g in games if g['winner'] == 0)
    blue = sum(1 for g in games if g['winner'] == 1)
    draws = n - red - blue
    R['global'] = {
        'victoire_rouge (premier joueur)': rate(red, n),
        'victoire_bleu': rate(blue, n),
        'nul': rate(draws, n),
        'score_rouge': round((red + draws / 2) / n, 4),
        'longueur_moy': round(np.mean([g['plies'] for g in games]), 1),
        'longueur_quantiles_10_50_90': [int(x) for x in np.percentile([g['plies'] for g in games], [10, 50, 90])],
        'fins': {REASONS[k]: rate(sum(1 for g in games if g['reason'] == k), n) for k in REASONS},
        'departage_sans_points': {'plus_proche': sum(1 for g in games if g['tiebreak'] == 1), 'plus_forte': sum(1 for g in games if g['tiebreak'] == 2)},
    }

    # ---------------------------------------------------------- par type de terrain
    by_mode = defaultdict(list)
    for g in games:
        by_mode[g['mode']].append(g)
    R['par_terrain'] = {}
    for mode, gs in sorted(by_mode.items()):
        k = len(gs)
        R['par_terrain'][mode] = {
            'parties': k,
            'score_rouge': round(sum(result(g, 0) for g in gs) / k, 3),
            'nuls': rate(sum(1 for g in gs if g['winner'] == 2), k),
            'longueur_moy': round(np.mean([g['plies'] for g in gs]), 1),
            'fin_sentinelle': rate(sum(1 for g in gs if g['reason'] == 1), k),
            'hauteur_moy': round(np.mean([np.mean(g['h']) for g in gs]), 2),
            'captures_par_partie': round(np.mean([sum(1 for m in g['moves'] if m['k'] == 1) for g in gs]), 2),
        }

    # ---------------------------------------------------------- sorties : qui sort, quand, et ce que ça rapporte
    first_exit = Counter()
    first_exit_win = defaultdict(list)
    combos = Counter()
    combo_res = defaultdict(list)
    exit_ply = defaultdict(list)
    for g in games:
        exits = [(i, m) for i, m in enumerate(g['moves']) if m['k'] == 2]
        if not exits:
            continue
        i0, m0 = exits[0]
        key = TYPES[m0['t']]
        first_exit[key] += 1
        first_exit_win[key].append(result(g, m0['o']))
        exit_ply[key].append(i0)
        if len(exits) >= 2:
            i1, m1 = exits[1]
            same = m0['o'] == m1['o']
            c = f"{TYPES[m0['t']]} puis {TYPES[m1['t']]} ({'même camp' if same else 'camps opposés'})"
            combos[c] += 1
            combo_res[c].append(result(g, m0['o']))
    R['sorties'] = {
        'premiere_sortie_par_type': {k: {'parties': v, 'score_du_camp_qui_sort': round(np.mean(first_exit_win[k]), 3), 'ply_median': int(np.median(exit_ply[k]))} for k, v in first_exit.items()},
        'enchainements_des_deux_sorties': {k: {'parties': v, 'score_du_premier_sorti': round(np.mean(combo_res[k]), 3)} for k, v in combos.most_common()},
    }

    # ---------------------------------------------------------- captures
    pair = Counter()
    first_cap = []
    cap_count = []
    margins = Counter()
    needs_allies = 0
    height_help = Counter()
    vb_used = 0
    special_cap = 0
    n_att = 0
    cap_by_side_res = []
    for g in games:
        caps = [m for m in g['moves'] if m['k'] == 1]
        cap_count.append(len(caps))
        for m in caps:
            n_att += 1
            pair[(TYPES[m['t']], TYPES[m['vt']])] += 1
            margins[m['att'] - m['def']] += 1
            if m['att'] - m['al'] < m['def']:
                needs_allies += 1
            height_help[m['hgt']] += 1
            vb_used += m['vb']
            special_cap += 1 if m['sp'] else 0
        if caps:
            first_cap.append(result(g, caps[0]['o']))
        # bilan matériel des captures (en Force) -> résultat
        bal = [0, 0]
        for m in caps:
            bal[m['o']] += STR[m['vt']]
        if bal[0] != bal[1]:
            lead = 0 if bal[0] > bal[1] else 1
            cap_by_side_res.append(result(g, lead))
    R['captures'] = {
        'par_partie_moy': round(np.mean(cap_count), 2),
        'parties_sans_capture': rate(sum(1 for c in cap_count if c == 0), n),
        'attaquant_victime': {f'{a}x{v}': c for (a, v), c in pair.most_common()},
        'marge_attaque_moins_defense': dict(sorted(margins.items())),
        'part_necessitant_des_allies': rate(needs_allies, n_att),
        'hauteur_attaquant (+1 plus haut, -1 plus bas)': dict(sorted(height_help.items())),
        'bonus_avant_garde_utilise': rate(vb_used, n_att),
        'captures_par_coup_special_explorateur': rate(special_cap, n_att),
        'score_du_premier_a_capturer': round(np.mean(first_cap), 3) if first_cap else None,
        'score_du_camp_gagnant_le_bilan_des_captures': round(np.mean(cap_by_side_res), 3) if cap_by_side_res else None,
    }

    # ---------------------------------------------------------- valeur empirique des pièces et du tempo
    # instantanés tous les 4 plies (du ply 8 à la fin), point de vue de Rouge ; IC par bootstrap sur les parties
    rows = defaultdict(list)
    for gi, g in enumerate(games):
        for at in range(8, len(g['moves']), 4):
            m = g['moves'][at]
            tl, cnt = snap_counts(m)
            mat = [cnt[0][t] - cnt[1][t] for t in range(3)]
            s0, s1 = min(min(tl[0][2]), 12), min(min(tl[1][2]), 12)
            b0 = min(min(min(v) for v in tl[0]), 12)
            b1 = min(min(min(v) for v in tl[1]), 12)
            tomove = 1 if m['o'] == 0 else -1
            rows[gi].append(([1, *mat, s1 - s0, b1 - b0, tomove], result(g, 0)))
    names = ['constante', 'Explorateur', 'Avant-garde', 'Sentinelle', 'avance_sentinelle (tours)', 'avance_meilleure_piece (tours)', 'trait']
    gids = list(rows)

    def fit(sample):
        X = [r for gi in sample for r, _ in rows[gi]]
        y = [v for gi in sample for _, v in rows[gi]]
        w, _ = logistic(X, y)
        return w

    w = fit(gids)
    rng = np.random.default_rng(1)
    boots = np.array([fit(rng.choice(gids, len(gids))) for _ in range(60)])
    lo, hi = np.percentile(boots, [2.5, 97.5], axis=0)
    rel = boots[:, 1:4] / boots[:, [1]]
    rlo, rhi = np.percentile(rel, [2.5, 97.5], axis=0)
    R['valeur_des_pieces'] = {
        'positions': sum(len(v) for v in rows.values()),
        'coefficients_logit [valeur, IC95]': {k: [round(a, 3), round(b, 3), round(c, 3)] for k, a, b, c in zip(names, w, lo, hi)},
        'valeur_relative (Explorateur=1) [valeur, IC95]': {k: [round(w[i] / w[1], 2), round(rlo[i - 1], 2), round(rhi[i - 1], 2)] for i, k in ((1, 'E'), (2, 'V'), (3, 'S'))},
        'equivalent_en_tours_de_sentinelle': {k: round(w[i] / w[4], 2) for i, k in ((1, 'E'), (2, 'V'), (3, 'S'))},
    }

    # ---------------------------------------------------------- défense : risque d'être capturé juste après un déplacement
    risk = defaultdict(lambda: [0, 0])
    risk_h = defaultdict(lambda: [0, 0])
    risk_t = defaultdict(lambda: [0, 0])
    for g in games:
        mv = g['moves']
        for i in range(len(mv) - 1):
            m, nx = mv[i], mv[i + 1]
            if m['k'] != 0 or nx['o'] == m['o']:
                continue
            hit = 1 if (nx['k'] == 1 and nx['to'] == m['to']) else 0
            k = min(m['sup'], 2)
            risk[k][0] += hit; risk[k][1] += 1
            risk_t[TYPES[m['t']]][0] += hit; risk_t[TYPES[m['t']]][1] += 1
            hb = int(np.clip(round((m['ht'] - np.mean(g['h']))), -2, 2))
            risk_h[hb][0] += hit; risk_h[hb][1] += 1
    R['defense'] = {
        'capture_au_coup_suivant_selon_allies_adjacents': {f'{k}{"+" if k == 2 else ""}': rate(*v) for k, v in sorted(risk.items())},
        'capture_au_coup_suivant_selon_type': {k: rate(*v) for k, v in risk_t.items()},
        'capture_au_coup_suivant_selon_hauteur_relative': {f'{k:+d}': rate(*v) for k, v in sorted(risk_h.items())},
    }

    # ---------------------------------------------------------- rôle de chaque pièce
    role = {t: Counter() for t in TYPES}
    for g in games:
        for m in g['moves']:
            role[TYPES[m['t']]][['deplacement', 'capture', 'sortie'][m['k']]] += 1
            if m['k'] == 1:
                role[TYPES[m['vt']]]['capturee'] += 1
    R['role_des_pieces_par_partie'] = {t: {k: round(v / n, 2) for k, v in c.items()} for t, c in role.items()}

    # course des Sentinelles : avance (en tours) au ply 20 -> score
    race = defaultdict(list)
    for g in games:
        if len(g['moves']) <= 20:
            continue
        m = g['moves'][20]
        tl, cnt = snap_counts(m)
        s0, s1 = min(min(tl[0][2]), 12), min(min(tl[1][2]), 12)
        race[max(-4, min(4, s1 - s0))].append(result(g, 0))
    R['course_sentinelles_ply20'] = {f'{k:+d}': {'parties': len(v), 'score_rouge': round(np.mean(v), 3)} for k, v in sorted(race.items())}

    # ---------------------------------------------------------- déplacements : hauteur, couloirs, pièces jouées
    moved = Counter()
    moved_open = Counter()
    climb = Counter()
    hrel = []
    exit_col = Counter()
    sup_dest = []
    special = Counter()
    long_moves = Counter()
    for g in games:
        h = np.array(g['h'])
        mean_h = h.mean()
        for i, m in enumerate(g['moves']):
            moved[TYPES[m['t']]] += 1
            if i < 10:
                moved_open[TYPES[m['t']]] += 1
            if m['k'] == 0:
                climb[int(np.sign(m['ht'] - m['hf']))] += 1
                hrel.append(m['ht'] - mean_h)
                sup_dest.append(m['sup'])
                if m['sp']:
                    special['diagonale' if m['sp'] == 1 else 'bond'] += 1
                long_moves[m['tl0'] - m['tl1']] += 1
            if m['k'] == 2:
                exit_col[m['to'] % N] += 1
    tot = sum(moved.values())
    R['deplacements'] = {
        'part_des_coups_par_type': {k: round(v / tot, 3) for k, v in moved.items()},
        'part_par_type_10_premiers_plies': {k: round(v / sum(moved_open.values()), 3) for k, v in moved_open.items()},
        'monte_plat_descend': {('monte' if k > 0 else 'descend' if k < 0 else 'plat'): v for k, v in climb.items()},
        'hauteur_arrivee_moins_moyenne_plateau': round(float(np.mean(hrel)), 3),
        'allies_adjacents_a_l_arrivee_moy': round(float(np.mean(sup_dest)), 3),
        'coups_speciaux_explorateur': dict(special),
        'tours_gagnes_vers_la_sortie': dict(sorted(long_moves.items())),
        'colonne_de_sortie': dict(sorted(exit_col.items())),
    }

    json.dump(R, sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == '__main__':
    main()
