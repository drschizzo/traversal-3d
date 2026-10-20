// Traversal — recherche : negamax alpha-bêta (PVS), approfondissement itératif, table de transpositions,
// coups tueurs, historique, réductions des coups tardifs et recherche de quiescence.
use crate::game::*;

pub const WIN: i32 = 100000;
const INF: i32 = 1 << 30;
const MAX_PLY: usize = 128;

#[derive(Clone, Copy, Debug)]
pub struct Params {
    pub val: [i32; 3],        // valeur matérielle d'une pièce sur le plateau
    pub prog: [i32; 3],       // poids de l'avancée (par tour gagné vers la sortie)
    pub sent_prog0: i32,      // poids de l'avancée de la Sentinelle tant que personne n'est sorti
    pub exit_bonus: i32,      // bonus × Force pour une pièce qui peut sortir au prochain tour
    pub score_w: i32,         // poids d'un point marqué
    pub race0: i32,           // course des Sentinelles (aucune pièce sortie)
    pub race1: i32,           // course décisive (une pièce déjà sortie)
    pub legacy: bool,         // évaluation identique à l'ancien bot JavaScript
}

impl Default for Params {
    fn default() -> Self {
        Params { val: [16, 24, 36], prog: [3, 4, 6], sent_prog0: 11, exit_bonus: 6, score_w: 60, race0: 8, race1: 30, legacy: false }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_depth: i32,
    pub max_nodes: u64,  // 0 = illimité
    pub time_ms: f64,    // 0 = illimité
    pub noise: i32,      // bruit aléatoire ajouté aux coups racine (niveaux faciles)
    pub quiesce: bool,
    pub multipv: usize,  // nombre de coups racine évalués exactement (pour expliquer les alternatives)
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SearchInfo {
    pub mv: Move, pub score: i32, pub depth: i32, pub nodes: u64,
    pub alts: [(Move, i32); 4], // meilleurs coups racine évalués exactement, du meilleur au moins bon
    pub n_alts: usize,
}

#[derive(Clone, Copy, Default)]
struct TTEntry { key: u64, mv: Move, score: i32, depth: i8, flag: u8 }
const EXACT: u8 = 1;
const LOWER: u8 = 2;
const UPPER: u8 = 3;

#[cfg(target_arch = "wasm32")]
extern "C" { fn now() -> f64; }
#[cfg(target_arch = "wasm32")]
fn now_ms() -> f64 { unsafe { now() } }
#[cfg(not(target_arch = "wasm32"))]
fn now_ms() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

pub struct Engine {
    pub b: Board,
    pub params: Params,
    turns: Box<[[[u8; NC]; 3]; 2]>,
    legacy_ed: Box<[[f32; NC]; 2]>,
    tt: Vec<TTEntry>,
    tt_mask: usize,
    killers: [[Move; 2]; MAX_PLY],
    history: Box<[[i32; NC]; NP]>,
    pv_table: Box<[[Move; MAX_PLY]; MAX_PLY]>, // variante principale triangulaire, par ply
    pv_len: [usize; MAX_PLY],
    pub last_pv: Vec<Move>,                    // variante principale de la dernière recherche complète
    nodes: u64,
    stop: bool,
    limits: Limits,
    deadline: f64,
    rng: u64,
}

impl Engine {
    pub fn new(h: [i8; NC], params: Params, tt_bits: u32) -> Engine {
        let mut turns = Box::new([[[0u8; NC]; 3]; 2]);
        for o in 0..2u8 { for t in 0..3u8 { turns[o as usize][t as usize] = exit_turns(&h, o, t); } }
        let legacy_ed = Box::new([legacy_exit_distances(&h, 0), legacy_exit_distances(&h, 1)]);
        let size = 1usize << tt_bits;
        Engine {
            b: Board::new(h), params, turns, legacy_ed,
            tt: vec![TTEntry::default(); size], tt_mask: size - 1,
            killers: [[Move::NONE; 2]; MAX_PLY], history: Box::new([[0; NC]; NP]),
            pv_table: Box::new([[Move::NONE; MAX_PLY]; MAX_PLY]), pv_len: [0; MAX_PLY], last_pv: Vec::new(),
            nodes: 0, stop: false,
            limits: Limits { max_depth: 1, max_nodes: 0, time_ms: 0.0, noise: 0, quiesce: true, multipv: 0 },
            deadline: 0.0, rng: 0x2545F4914F6CDD1D,
        }
    }

    pub fn seed(&mut self, s: u64) { self.rng = s | 1; }
    fn rand(&mut self) -> f64 {
        self.rng ^= self.rng << 13; self.rng ^= self.rng >> 7; self.rng ^= self.rng << 17;
        (self.rng >> 11) as f64 / (1u64 << 53) as f64
    }

    #[inline]
    pub fn turns_left(&self, p: &Piece) -> i32 { self.turns[p.o as usize][p.t as usize][p.pos as usize].min(12) as i32 }

    // ------------------------------------------------------------ évaluation (point de vue du camp au trait)
    pub fn evaluate(&self, s: &State) -> i32 {
        if s.over { return terminal(s, s.turn); }
        if self.params.legacy { return self.legacy_eval(s); }
        let pr = &self.params;
        let mut side = [0i32; 2];
        let mut sent = [99i32; 2];
        let mut tmin = [[99i32; 3]; 2]; // tours minimaux par type
        for p in s.pieces.iter() {
            if p.st != ON_BOARD { continue; }
            let (o, ty) = (p.o as usize, p.t as usize);
            let t = self.turns_left(p);
            let w = if p.t == SENTINEL && s.crossed == 0 { pr.sent_prog0 } else { pr.prog[ty] };
            side[o] += pr.val[ty] + w * (12 - t).max(0) + if t <= 1 { pr.exit_bonus * STR[ty] } else { 0 };
            if p.t == SENTINEL { sent[o] = sent[o].min(t); }
            tmin[o][ty] = tmin[o][ty].min(t);
        }
        side[0] += s.score[0] * pr.score_w;
        side[1] += s.score[1] * pr.score_w;
        let me = s.turn as usize;
        let op = 1 - me;
        let mut race = 0;
        if s.crossed == 0 {
            // course des Sentinelles : à égalité de tours, le camp au trait passe en premier
            let best = sent[me].min(sent[op]);
            if best < 8 {
                let dt = sent[op] - sent[me];
                let r = if dt >= 0 { (dt + 1).min(4) } else { dt.max(-4) };
                race = pr.race0 * r * (8 - best) / 8;
            }
        } else if s.crossed == 1 {
            // la prochaine pièce qui sort termine la partie
            let x = if s.score[0] > 0 { 0 } else { 1 };
            let y = 1 - x;
            let sx = s.score[x];
            let tx = tmin[x].iter().copied().min().unwrap_or(99);
            let mut ty = 99;
            for k in 0..3 { if STR[k] > sx { ty = ty.min(tmin[y][k]); } }
            let (tme, top) = if me == x { (tx, ty) } else { (ty, tx) };
            let best = tme.min(top);
            if best < 10 {
                let dt = top - tme;
                let r = if dt >= 0 { (dt + 1).min(4) } else { dt.max(-4) };
                race = pr.race1 * r * (10 - best) / 10;
            }
        }
        side[me] - side[op] + race
    }

    // Évaluation de l'ancien bot JavaScript (référence pour mesurer les progrès)
    fn legacy_eval(&self, s: &State) -> i32 {
        const VAL: [i32; 3] = [16, 24, 36];
        const PROG: [i32; 3] = [3, 4, 6];
        let mut side = [0i32; 2];
        for p in s.pieces.iter() {
            if p.st != ON_BOARD { continue; }
            let ed = self.legacy_ed[p.o as usize][p.pos as usize];
            let t = (ed / MOVE[p.t as usize] as f32).ceil() as i32;
            let w = if p.t == SENTINEL && s.crossed == 0 { 11 } else { PROG[p.t as usize] };
            side[p.o as usize] += VAL[p.t as usize] + w * (12 - t).max(0) + if t <= 1 { 6 * STR[p.t as usize] } else { 0 };
        }
        side[0] += s.score[0] * 60;
        side[1] += s.score[1] * 60;
        side[s.turn as usize] - side[1 - s.turn as usize]
    }

    // ------------------------------------------------------------ tri des coups
    fn score_move(&self, s: &State, m: &Move, tt_move: Move, ply: usize) -> i32 {
        if !tt_move.is_none() && m.key() == tt_move.key() { return 10_000_000; }
        let p = &s.pieces[m.pi as usize];
        match m.kind {
            K_EXIT => 5_000_000 + if p.t == SENTINEL && s.crossed == 0 { 1_000_000 } else { 0 } + STR[p.t as usize] * 10,
            K_ATTACK => 2_000_000 + 1000 * STR[s.pieces[s.cell[m.to as usize] as usize].t as usize] - STR[p.t as usize],
            _ => {
                if ply < MAX_PLY && (m.key() == self.killers[ply][0].key() || m.key() == self.killers[ply][1].key()) { return 1_000_000; }
                let tb = &self.turns[p.o as usize][p.t as usize];
                let gain = tb[p.pos as usize].min(12) as i32 - tb[m.to as usize].min(12) as i32;
                gain * 2000 + self.history[m.pi as usize][m.to as usize].min(1500)
            }
        }
    }

    #[inline]
    fn tick(&mut self) {
        self.nodes += 1;
        if self.nodes & 1023 == 0 {
            if self.limits.max_nodes > 0 && self.nodes >= self.limits.max_nodes { self.stop = true; }
            if self.limits.time_ms > 0.0 && now_ms() > self.deadline { self.stop = true; }
        }
    }

    fn quiesce(&mut self, s: &State, mut alpha: i32, beta: i32, q: i32) -> i32 {
        self.tick();
        if self.stop { return 0; }
        let stand = self.evaluate(s);
        if q <= 0 || stand >= beta { return stand; }
        if stand > alpha { alpha = stand; }
        let mut ml = MoveList::new();
        gen_moves(&self.b, s, &mut ml, true);
        let mut sc = [0i32; 256];
        for i in 0..ml.n { sc[i] = self.score_move(s, &ml.m[i], Move::NONE, MAX_PLY); }
        for i in 0..ml.n {
            pick(&mut ml, &mut sc, i);
            let m = ml.m[i];
            let c = apply_move(&self.b, s, m);
            let v = if c.over { terminal(&c, s.turn) }
                else if c.turn == s.turn { self.quiesce(&c, alpha, beta, q - 1) }
                else { -self.quiesce(&c, -beta, -alpha, q - 1) };
            if self.stop { return 0; }
            if v >= beta { return v; }
            if v > alpha { alpha = v; }
        }
        alpha
    }

    // valeur de l'enfant c vue par le camp qui vient de jouer (side)
    #[inline]
    fn child(&mut self, c: &State, side: u8, depth: i32, alpha: i32, beta: i32, ply: usize) -> i32 {
        if ply < MAX_PLY { self.pv_len[ply] = 0; }
        if c.over { return terminal(c, side); }
        if c.turn == side { self.search(c, depth, alpha, beta, ply) } else { -self.search(c, depth, -beta, -alpha, ply) }
    }

    fn search(&mut self, s: &State, depth: i32, mut alpha: i32, beta: i32, ply: usize) -> i32 {
        if depth <= 0 {
            return if self.limits.quiesce { self.quiesce(s, alpha, beta, 6) } else { self.tick(); self.evaluate(s) };
        }
        self.tick();
        if self.stop { return 0; }
        let pv = beta as i64 - alpha as i64 > 1; // en i64 : une fenêtre complète déborde un i32
        let slot = (s.hash as usize) & self.tt_mask;
        let e = self.tt[slot];
        let mut tt_move = Move::NONE;
        if e.key == s.hash {
            tt_move = e.mv;
            if !pv && e.depth as i32 >= depth {
                match e.flag {
                    EXACT => return e.score,
                    LOWER if e.score >= beta => return e.score,
                    UPPER if e.score <= alpha => return e.score,
                    _ => {}
                }
            }
        }
        let mut ml = MoveList::new();
        gen_moves(&self.b, s, &mut ml, false);
        if ml.n == 0 { return self.evaluate(s); }
        let mut sc = [0i32; 256];
        for i in 0..ml.n { sc[i] = self.score_move(s, &ml.m[i], tt_move, ply); }
        let alpha0 = alpha;
        let mut best = -INF;
        let mut best_move = Move::NONE;
        let side = s.turn;
        for i in 0..ml.n {
            pick(&mut ml, &mut sc, i);
            let m = ml.m[i];
            let c = apply_move(&self.b, s, m);
            let quiet = m.kind == K_MOVE && sc[i] < 1_000_000;
            let v = if i == 0 {
                self.child(&c, side, depth - 1, alpha, beta, ply + 1)
            } else {
                let r = if depth >= 3 && i >= 4 && quiet { if i >= 12 && depth >= 5 { 2 } else { 1 } } else { 0 };
                let mut v = self.child(&c, side, depth - 1 - r, alpha, alpha + 1, ply + 1);
                if v > alpha && r > 0 { v = self.child(&c, side, depth - 1, alpha, alpha + 1, ply + 1); }
                if v > alpha && v < beta { v = self.child(&c, side, depth - 1, alpha, beta, ply + 1); }
                v
            };
            if self.stop { return 0; }
            if v > best { best = v; best_move = m; }
            if v > alpha { alpha = v; self.update_pv(ply, m); }
            if alpha >= beta {
                if m.kind == K_MOVE {
                    if ply < MAX_PLY && self.killers[ply][0].key() != m.key() {
                        self.killers[ply][1] = self.killers[ply][0];
                        self.killers[ply][0] = m;
                    }
                    let hh = &mut self.history[m.pi as usize][m.to as usize];
                    *hh += depth * depth;
                }
                break;
            }
        }
        let flag = if best <= alpha0 { UPPER } else if best >= beta { LOWER } else { EXACT };
        if e.key != s.hash || depth >= e.depth as i32 || flag == EXACT {
            self.tt[slot] = TTEntry { key: s.hash, mv: best_move, score: best, depth: depth as i8, flag };
        }
        best
    }

    // le coup m devient la tête de la variante au ply donné, suivi de la variante de l'enfant
    fn update_pv(&mut self, ply: usize, m: Move) {
        if ply + 1 >= MAX_PLY { return; }
        let n = self.pv_len[ply + 1].min(MAX_PLY - ply - 1);
        self.pv_table[ply][0] = m;
        for k in 0..n { self.pv_table[ply][k + 1] = self.pv_table[ply + 1][k]; }
        self.pv_len[ply] = n + 1;
    }

    // ------------------------------------------------------------ racine
    pub fn think(&mut self, s: &State, limits: Limits) -> SearchInfo {
        self.limits = limits;
        self.nodes = 0;
        self.stop = false;
        self.deadline = now_ms() + limits.time_ms;
        for k in self.killers.iter_mut() { *k = [Move::NONE; 2]; }
        for row in self.history.iter_mut() { for h in row.iter_mut() { *h /= 8; } }
        let mut ml = MoveList::new();
        gen_moves(&self.b, s, &mut ml, false);
        let mut info = SearchInfo { mv: Move::NONE, score: 0, depth: 0, nodes: 0, alts: [(Move::NONE, 0); 4], n_alts: 0 };
        if ml.n == 0 { return info; }
        let mut sc = [0i32; 256];
        for i in 0..ml.n { sc[i] = self.score_move(s, &ml.m[i], Move::NONE, 0); }
        for i in 0..ml.n { pick(&mut ml, &mut sc, i); }
        // (score bruité pour le tri, coup, variante, score réel)
        let mut root: Vec<(i32, Move, Vec<Move>, i32)> = ml.as_slice().iter().map(|&m| (0, m, Vec::new(), 0)).collect();
        info.mv = root[0].1;
        let side = s.turn;
        let noise: Vec<i32> = (0..root.len()).map(|_| if limits.noise > 0 { ((self.rand() - 0.5) * limits.noise as f64) as i32 } else { 0 }).collect();
        self.last_pv = vec![info.mv];
        for depth in 1..=limits.max_depth.max(1) {
            let mut alpha = -INF;
            let mut done = true;
            for k in 0..root.len() {
                let m = root[k].1;
                let a0 = alpha;
                let c = apply_move(&self.b, s, m);
                let exact = limits.noise > 0 || k < limits.multipv;
                let v = if exact || k == 0 {
                    self.child(&c, side, depth - 1, if exact { -INF } else { alpha }, INF, 1)
                } else {
                    let mut v = self.child(&c, side, depth - 1, alpha, alpha + 1, 1);
                    if v > alpha && !self.stop { v = self.child(&c, side, depth - 1, alpha, INF, 1); }
                    v
                };
                if self.stop { done = false; break; }
                root[k].0 = if exact || v > a0 { v + noise[k] } else { -INF };
                root[k].3 = if exact || v > a0 { v } else { -INF };
                if exact || v > a0 {
                    let mut line = vec![m];
                    line.extend_from_slice(&self.pv_table[1][..self.pv_len[1]]);
                    root[k].2 = line;
                }
                if v > alpha { alpha = v; }
            }
            if !done { break; }
            // tri stable : le meilleur coup en tête pour la profondeur suivante
            root.sort_by(|a, b| b.0.cmp(&a.0));
            info.mv = root[0].1;
            info.score = root[0].3;
            self.last_pv = root[0].2.clone();
            info.depth = depth;
            info.n_alts = 0;
            for &(v, m, _, raw) in root.iter().take(4) {
                if v <= -INF / 2 { break; }
                let v = raw;
                info.alts[info.n_alts] = (m, v);
                info.n_alts += 1;
            }
            if root[0].3.abs() >= WIN - 1000 { break; }
            if limits.time_ms > 0.0 && now_ms() > self.deadline { break; }
            if limits.max_nodes > 0 && self.nodes >= limits.max_nodes { break; }
        }
        info.nodes = self.nodes;
        info
    }
}

impl Engine {
    // Variante principale : celle enregistrée pendant la recherche, prolongée par la table de transpositions
    pub fn pv_line(&self, s: &State, max: usize) -> Vec<Move> {
        let mut line = Vec::new();
        let mut cur = *s;
        for &m in self.last_pv.iter().take(max) {
            if cur.over { break; }
            let mut ml = MoveList::new();
            gen_moves(&self.b, &cur, &mut ml, false);
            if !ml.as_slice().iter().any(|x| x.key() == m.key()) { break; }
            line.push(m);
            cur = apply_move(&self.b, &cur, m);
        }
        while line.len() < max && !cur.over {
            let e = self.tt[(cur.hash as usize) & self.tt_mask];
            if e.key != cur.hash || e.mv.is_none() { break; }
            let mut ml = MoveList::new();
            gen_moves(&self.b, &cur, &mut ml, false);
            let Some(&m) = ml.as_slice().iter().find(|m| m.key() == e.mv.key()) else { break };
            line.push(m);
            cur = apply_move(&self.b, &cur, m);
        }
        line
    }

    pub fn turns_table(&self) -> &[[[u8; NC]; 3]; 2] { &self.turns }
}

#[inline]
fn pick(ml: &mut MoveList, sc: &mut [i32; 256], i: usize) {
    let mut bi = i;
    for j in i + 1..ml.n { if sc[j] > sc[bi] { bi = j; } }
    if bi != i { ml.m.swap(i, bi); sc.swap(i, bi); }
}

pub fn terminal(s: &State, pov: u8) -> i32 {
    if s.winner == 2 { return 0; }
    if s.winner == pov as i8 { WIN - s.ply } else { -(WIN - s.ply) }
}

pub fn legacy_exit_distances(h: &[i8; NC], o: u8) -> [f32; NC] {
    let mut d = [f32::INFINITY; NC];
    let gr = goal_row(o);
    for x in 0..N { d[gr * N + x] = 1.0; }
    let mut changed = true;
    while changed {
        changed = false;
        for i in 0..NC {
            for n in neigh(i) {
                let c = d[n] + 1.0 + (h[i] as f32 - h[n] as f32).abs();
                if c < d[i] { d[i] = c; changed = true; }
            }
        }
    }
    d
}
