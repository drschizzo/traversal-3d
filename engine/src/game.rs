// Traversal — moteur de règles en Rust, portage fidèle de game.js

pub const N: usize = 10;
pub const NC: usize = N * N;
pub const NP: usize = 12;
pub const EXPLORER: u8 = 0;
pub const VANGUARD: u8 = 1;
pub const SENTINEL: u8 = 2;
pub const MOVE: [i32; 3] = [5, 4, 3];
pub const STR: [i32; 3] = [1, 2, 3];
pub const MAX_PLIES: i32 = 200;
pub const ON_BOARD: u8 = 0;
pub const CAPTURED: u8 = 1;
pub const SCORED: u8 = 2;

// types de coup
pub const K_MOVE: u8 = 0;
pub const K_ATTACK: u8 = 1;
pub const K_EXIT: u8 = 2;
// coups spéciaux de l'Explorateur
pub const SP_NONE: u8 = 0;
pub const SP_DIAG: u8 = 1;
pub const SP_JUMP: u8 = 2;

// raisons de fin de partie
pub const R_NONE: u8 = 0;
pub const R_SENTINEL: u8 = 1;
pub const R_TWO: u8 = 2;
pub const R_PLIES: u8 = 3;
pub const R_STUCK: u8 = 4;

pub const MODES: [&str; 6] = ["random", "mountains", "valleys", "highlands", "woods", "desert"];

#[inline]
pub fn cx(i: usize) -> usize { i % N }
#[inline]
pub fn cy(i: usize) -> usize { i / N }
#[inline]
pub fn goal_row(o: u8) -> usize { if o == 0 { N - 1 } else { 0 } }

const fn build_neigh() -> [[u8; 4]; NC] {
    let mut t = [[255u8; 4]; NC];
    let mut i = 0;
    while i < NC {
        let x = i % N;
        let y = i / N;
        let mut k = 0;
        if x > 0 { t[i][k] = (i - 1) as u8; k += 1; }
        if x < N - 1 { t[i][k] = (i + 1) as u8; k += 1; }
        if y > 0 { t[i][k] = (i - N) as u8; k += 1; }
        if y < N - 1 { t[i][k] = (i + N) as u8; }
        i += 1;
    }
    t
}
pub static NEIGH: [[u8; 4]; NC] = build_neigh();

#[inline]
pub fn neigh(i: usize) -> impl Iterator<Item = usize> {
    NEIGH[i].iter().take_while(|&&n| n != 255).map(|&n| n as usize)
}

// ---------------------------------------------------------------- terrain (identique à generateTerrain)

pub struct Mulberry(u32);
impl Mulberry {
    pub fn new(seed: u32) -> Self { Mulberry(seed) }
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let a = self.0;
        let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

struct Noise { grid: Vec<f64>, scale: f64 }
impl Noise {
    fn new(rng: &mut Mulberry, scale: f64) -> Self {
        Noise { grid: (0..256).map(|_| rng.next()).collect(), scale }
    }
    fn g(&self, i: i64, j: i64) -> f64 { self.grid[(j.rem_euclid(16) * 16 + i.rem_euclid(16)) as usize] }
    fn at(&self, x: f64, y: f64) -> f64 {
        let s = |t: f64| t * t * (3.0 - 2.0 * t);
        let (fx, fy) = (x / self.scale, y / self.scale);
        let (x0, y0) = (fx.floor(), fy.floor());
        let (u, v) = (s(fx - x0), s(fy - y0));
        let (x0, y0) = (x0 as i64, y0 as i64);
        let (a, b, c, d) = (self.g(x0, y0), self.g(x0 + 1, y0), self.g(x0, y0 + 1), self.g(x0 + 1, y0 + 1));
        a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
    }
}

pub fn generate_terrain(mode: &str, seed: u32) -> [i8; NC] {
    let mut rng = Mulberry::new(seed);
    let na = Noise::new(&mut rng, 3.4);
    let nb = Noise::new(&mut rng, 1.8);
    let nc = Noise::new(&mut rng, 5.5);
    let ox = rng.next() * 20.0;
    let oy = rng.next() * 20.0;
    let mut blobs: Vec<[f64; 4]> = Vec::new();
    let mut add_blobs = |rng: &mut Mulberry, k: usize, smin: f64, smax: f64, spread: f64| {
        for _ in 0..k {
            let x = 4.5 + (rng.next() * 2.0 - 1.0) * spread;
            let y = 4.5 + (rng.next() * 2.0 - 1.0) * spread;
            let s = smin + rng.next() * (smax - smin);
            let a = 0.75 + rng.next() * 0.25;
            blobs.push([x, y, s, a]);
        }
    };
    let max_h: f64;
    match mode {
        "mountains" => { max_h = 8.0; add_blobs(&mut rng, 2, 1.5, 2.3, 1.8); }
        "valleys" => { max_h = 7.0; }
        "highlands" => { max_h = 7.0; add_blobs(&mut rng, 2, 1.3, 1.9, 2.6); }
        "woods" => { max_h = 3.0; }
        "desert" => {
            max_h = 6.0;
            let k = 1 + ((rng.next() * 2.0) as usize);
            add_blobs(&mut rng, k, 0.7, 1.1, 3.2);
        }
        _ => { max_h = 6.0; add_blobs(&mut rng, 1, 1.5, 2.5, 3.0); }
    }
    let blob = |x: f64, y: f64| blobs.iter().fold(0.0, |s, b| s + b[3] * (-((x - b[0]).powi(2) + (y - b[1]).powi(2)) / (2.0 * b[2] * b[2])).exp());
    let ridge = |n: f64| 1.0 - (2.0 * n - 1.0).abs();
    let mut raw = [0f32; NC];
    for y in 0..N {
        for x in 0..N {
            let (xf, yf) = (x as f64, y as f64);
            let a = na.at(xf + ox, yf + oy);
            let b = nb.at(xf + oy, yf + ox);
            let c = nc.at(xf + ox * 0.5, yf + oy * 0.7);
            let v = match mode {
                "mountains" => 0.9 * blob(xf, yf) + 0.22 * a + 0.1 * b,
                "valleys" => 0.8 * ridge(a).max(0.85 * ridge(c)).powf(2.4) + 0.1 * b,
                "highlands" => 0.6 * blob(xf, yf) + 0.4 * ridge(c).powi(2) + 0.15 * a,
                "woods" => 0.65 * a + 0.35 * b,
                "desert" => blob(xf, yf) + 0.1 * b,
                _ => 0.55 * a + 0.3 * b + 0.35 * blob(xf, yf),
            };
            raw[y * N + x] = v as f32;
        }
    }
    let mut sym = [0f32; NC];
    for i in 0..NC { sym[i] = ((raw[i] as f64 + raw[NC - 1 - i] as f64) / 2.0) as f32; }
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for &v in sym.iter() { lo = lo.min(v as f64); hi = hi.max(v as f64); }
    let span = if hi - lo != 0.0 { hi - lo } else { 1.0 };
    let mut h = [0i8; NC];
    for i in 0..NC { h[i] = (((sym[i] as f64 - lo) / span) * max_h + 0.5).floor() as i8; }
    let mut changed = true;
    while changed {
        changed = false;
        for i in 0..NC {
            for n in neigh(i) {
                if h[i] > h[n] + 2 { h[i] = h[n] + 2; changed = true; }
            }
        }
    }
    h
}

// ---------------------------------------------------------------- état

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Piece { pub t: u8, pub o: u8, pub pos: u8, pub st: u8 }

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Move { pub pi: u8, pub kind: u8, pub to: u8, pub special: u8, pub cost: u8 }

impl Move {
    pub const NONE: Move = Move { pi: 255, kind: 0, to: 0, special: 0, cost: 0 };
    #[inline]
    pub fn is_none(&self) -> bool { self.pi == 255 }
    #[inline]
    pub fn key(&self) -> u16 { (self.pi as u16) << 9 | (self.kind as u16) << 7 | self.to as u16 }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Combat { pub att: i32, pub def: i32, pub height: i32, pub vb: i32, pub allies: i32, pub reinf: i32 }

pub struct Board { pub h: [i8; NC], pub zob: Zobrist }

pub struct Zobrist { pub piece: [[[u64; NC]; 3]; 2], pub turn: u64, pub score: [[u64; 8]; 2], pub crossed: [u64; 4] }
impl Zobrist {
    fn new() -> Self {
        let mut s: u64 = 0x9E3779B97F4A7C15;
        let mut r = || { s ^= s << 13; s ^= s >> 7; s ^= s << 17; s };
        let mut z = Zobrist { piece: [[[0; NC]; 3]; 2], turn: 0, score: [[0; 8]; 2], crossed: [0; 4] };
        for o in 0..2 { for t in 0..3 { for c in 0..NC { z.piece[o][t][c] = r(); } } }
        z.turn = r();
        for o in 0..2 { for k in 0..8 { z.score[o][k] = r(); } }
        for k in 0..4 { z.crossed[k] = r(); }
        z
    }
}

impl Board {
    pub fn new(h: [i8; NC]) -> Self { Board { h, zob: Zobrist::new() } }
}

#[derive(Clone, Copy, Debug)]
pub struct State {
    pub cell: [i8; NC],
    pub pieces: [Piece; NP],
    pub turn: u8,
    pub ply: i32,
    pub score: [i32; 2],
    pub crossed: i32,
    pub over: bool,
    pub winner: i8, // 0, 1, 2 = nul, -1 = en cours
    pub reason: u8,
    pub tiebreak: u8, // 1 = départagé par la pièce la plus proche, 2 = la plus forte
    pub passed: bool,
    pub hash: u64,
}

pub const ORDER: [u8; 6] = [SENTINEL, VANGUARD, EXPLORER, EXPLORER, VANGUARD, SENTINEL];

impl State {
    pub fn new_game(b: &Board) -> State {
        let mut cell = [-1i8; NC];
        let mut pieces = [Piece { t: 0, o: 0, pos: 0, st: 0 }; NP];
        let mut k = 0;
        for o in 0..2u8 {
            for (j, &t) in ORDER.iter().enumerate() {
                let x = 2 + j;
                let y = if o == 0 { 0 } else { N - 1 };
                let pos = y * N + x;
                cell[pos] = k as i8;
                pieces[k] = Piece { t, o, pos: pos as u8, st: ON_BOARD };
                k += 1;
            }
        }
        let mut s = State { cell, pieces, turn: 0, ply: 0, score: [0; 2], crossed: 0, over: false, winner: -1, reason: 0, tiebreak: 0, passed: false, hash: 0 };
        s.hash = s.compute_hash(b);
        s
    }

    pub fn compute_hash(&self, b: &Board) -> u64 {
        let z = &b.zob;
        let mut h = 0u64;
        for p in self.pieces.iter() {
            if p.st == ON_BOARD { h ^= z.piece[p.o as usize][p.t as usize][p.pos as usize]; }
        }
        if self.turn == 1 { h ^= z.turn; }
        h ^= z.score[0][self.score[0].min(7) as usize] ^ z.score[1][self.score[1].min(7) as usize];
        h ^= z.crossed[self.crossed.min(3) as usize];
        h
    }
}

// Dijkstra par seaux (coûts ≤ 5) à travers les cases vides. dist = 99 si inatteignable.
#[inline]
pub fn reach(b: &Board, s: &State, pi: usize, dist: &mut [u8; NC]) {
    let p = s.pieces[pi];
    let mp = MOVE[p.t as usize] as usize;
    let start = p.pos as usize;
    *dist = [99u8; NC];
    let mut buckets = [[0u8; NC]; 6];
    let mut len = [0usize; 6];
    dist[start] = 0;
    buckets[0][0] = start as u8;
    len[0] = 1;
    for c in 0..=mp {
        let mut k = 0;
        while k < len[c] {
            let u = buckets[c][k] as usize;
            k += 1;
            if dist[u] as usize != c { continue; }
            let hu = b.h[u] as i32;
            for v in neigh(u) {
                if s.cell[v] != -1 { continue; }
                let nc = c + 1 + (hu - b.h[v] as i32).unsigned_abs() as usize;
                if nc <= mp && nc < dist[v] as usize {
                    dist[v] = nc as u8;
                    buckets[nc][len[nc]] = v as u8; len[nc] += 1;
                }
            }
        }
    }
}

pub fn combat(b: &Board, s: &State, pi: usize, target: usize, vb: bool) -> Combat {
    let p = s.pieces[pi];
    let d = s.pieces[s.cell[target] as usize];
    let hs = b.h[p.pos as usize];
    let ht = b.h[target];
    let height = if hs > ht { 1 } else if hs < ht { -1 } else { 0 };
    let (mut allies, mut reinf) = (0, 0);
    for n in neigh(target) {
        let q = s.cell[n];
        if q < 0 || q as usize == pi { continue; }
        let qp = s.pieces[q as usize];
        if qp.o == p.o { allies += STR[qp.t as usize]; } else { reinf += 1; }
    }
    let vbv = if vb { 1 } else { 0 };
    Combat { att: STR[p.t as usize] + height + vbv + allies, def: STR[d.t as usize] + reinf, height, vb: vbv, allies, reinf }
}

pub struct MoveList { pub m: [Move; 256], pub n: usize }
impl MoveList {
    pub fn new() -> Self { MoveList { m: [Move::NONE; 256], n: 0 } }
    #[inline]
    pub fn push(&mut self, m: Move) { if self.n < 256 { self.m[self.n] = m; self.n += 1; } }
    pub fn as_slice(&self) -> &[Move] { &self.m[..self.n] }
}

// Coups d'une pièce (une seule sortie par pièce, la moins chère : toutes mènent au même état).
// only_tactical : seulement attaques et sorties (quiescence).
pub fn piece_moves(b: &Board, s: &State, pi: usize, out: &mut MoveList, only_tactical: bool) {
    let p = s.pieces[pi];
    if p.st != ON_BOARD { return; }
    let mut dist = [99u8; NC];
    reach(b, s, pi, &mut dist);
    let mp = MOVE[p.t as usize] as u8;
    let start = p.pos as usize;
    if !only_tactical {
        for v in 0..NC {
            if v != start && dist[v] <= mp { out.push(Move { pi: pi as u8, kind: K_MOVE, to: v as u8, special: SP_NONE, cost: dist[v] }); }
        }
    }
    // attaques : coût minimal par cible
    let mut best = [99u8; NC];
    for u in 0..NC {
        if dist[u] > mp { continue; }
        let hu = b.h[u] as i32;
        for v in neigh(u) {
            let q = s.cell[v];
            if q < 0 || s.pieces[q as usize].o == p.o { continue; }
            let c = dist[u] as i32 + 1 + (hu - b.h[v] as i32).abs();
            if c <= mp as i32 && (c as u8) < best[v] { best[v] = c as u8; }
        }
    }
    for v in 0..NC {
        if best[v] == 99 { continue; }
        let vb = p.t == VANGUARD && best[v] == 4;
        let cb = combat(b, s, pi, v, vb);
        if cb.att >= cb.def { out.push(Move { pi: pi as u8, kind: K_ATTACK, to: v as u8, special: SP_NONE, cost: best[v] }); }
    }
    // sortie
    let gr = goal_row(p.o);
    let mut ex: Option<(u8, usize)> = None;
    for x in 0..N {
        let u = gr * N + x;
        if dist[u] + 1 <= mp && ex.map_or(true, |(c, _)| dist[u] + 1 < c) { ex = Some((dist[u] + 1, u)); }
    }
    if let Some((c, u)) = ex { out.push(Move { pi: pi as u8, kind: K_EXIT, to: u as u8, special: SP_NONE, cost: c }); }
    // coups spéciaux de l'Explorateur
    if p.t == EXPLORER {
        const SP: [(i32, i32, u8); 8] = [(1, 1, SP_DIAG), (1, -1, SP_DIAG), (-1, 1, SP_DIAG), (-1, -1, SP_DIAG), (2, 0, SP_JUMP), (-2, 0, SP_JUMP), (0, 2, SP_JUMP), (0, -2, SP_JUMP)];
        let (px, py) = (cx(start) as i32, cy(start) as i32);
        for &(dx, dy, kind) in SP.iter() {
            let (x, y) = (px + dx, py + dy);
            if x < 0 || y < 0 || x >= N as i32 || y >= N as i32 { continue; }
            let v = (y as usize) * N + x as usize;
            let q = s.cell[v];
            if q == -1 {
                if only_tactical || dist[v] <= mp { continue; }
                out.push(Move { pi: pi as u8, kind: K_MOVE, to: v as u8, special: kind, cost: 0 });
            } else if s.pieces[q as usize].o != p.o && best[v] == 99 {
                let cb = combat(b, s, pi, v, false);
                if cb.att >= cb.def { out.push(Move { pi: pi as u8, kind: K_ATTACK, to: v as u8, special: kind, cost: 0 }); }
            }
        }
    }
}

pub fn gen_moves(b: &Board, s: &State, out: &mut MoveList, only_tactical: bool) {
    out.n = 0;
    for pi in 0..NP {
        let p = s.pieces[pi];
        if p.o == s.turn && p.st == ON_BOARD { piece_moves(b, s, pi, out, only_tactical); }
    }
}

// Existe-t-il au moins un coup ? Tests rapides, puis génération complète en dernier recours.
pub fn has_any_move(b: &Board, s: &State) -> bool {
    let mut slow = false;
    for pi in 0..NP {
        let p = s.pieces[pi];
        if p.o != s.turn || p.st != ON_BOARD { continue; }
        let u = p.pos as usize;
        if cy(u) == goal_row(p.o) { return true; }
        let mp = MOVE[p.t as usize];
        for v in neigh(u) {
            if s.cell[v] == -1 && 1 + (b.h[u] as i32 - b.h[v] as i32).abs() <= mp { return true; }
        }
        if p.t == EXPLORER {
            let (px, py) = (cx(u) as i32, cy(u) as i32);
            for &(dx, dy) in [(1, 1), (1, -1), (-1, 1), (-1, -1), (2, 0), (-2, 0), (0, 2), (0, -2)].iter() {
                let (x, y) = (px + dx, py + dy);
                if x >= 0 && y >= 0 && x < N as i32 && y < N as i32 && s.cell[y as usize * N + x as usize] == -1 { return true; }
            }
        }
        slow = true;
    }
    if !slow { return false; }
    let mut ml = MoveList::new();
    gen_moves(b, s, &mut ml, false);
    ml.n > 0
}

fn finish(s: &mut State, winner: i8, reason: u8) { s.over = true; s.winner = winner; s.reason = reason; }

fn end_by_score(s: &mut State, reason: u8) {
    if s.score[0] != s.score[1] { return finish(s, if s.score[0] > s.score[1] { 0 } else { 1 }, reason); }
    if s.score[0] > 0 { return finish(s, 2, reason); }
    let best_of = |o: u8| {
        let (mut rows, mut st) = (i32::MAX, 0);
        for p in s.pieces.iter() {
            if p.o != o || p.st != ON_BOARD { continue; }
            let y = cy(p.pos as usize) as i32;
            let r = if o == 0 { N as i32 - y } else { y + 1 };
            let ps = STR[p.t as usize];
            if r < rows || (r == rows && ps > st) { rows = r; st = ps; }
        }
        (rows, st)
    };
    let (a, bb) = (best_of(0), best_of(1));
    if a.0 != bb.0 { s.tiebreak = 1; return finish(s, if a.0 < bb.0 { 0 } else { 1 }, reason); }
    if a.1 != bb.1 { s.tiebreak = 2; return finish(s, if a.1 > bb.1 { 0 } else { 1 }, reason); }
    finish(s, 2, reason);
}

pub fn apply_move(b: &Board, s0: &State, m: Move) -> State {
    let mut s = *s0;
    let z = &b.zob;
    let pi = m.pi as usize;
    let p = s.pieces[pi];
    let (o, t) = (p.o as usize, p.t as usize);
    s.cell[p.pos as usize] = -1;
    s.hash ^= z.piece[o][t][p.pos as usize];
    s.passed = false;
    s.hash ^= z.score[0][s.score[0].min(7) as usize] ^ z.score[1][s.score[1].min(7) as usize] ^ z.crossed[s.crossed.min(3) as usize];
    if m.kind == K_EXIT {
        s.pieces[pi].st = SCORED;
        s.score[o] += STR[t];
        s.crossed += 1;
        if s.crossed == 1 && p.t == SENTINEL { finish(&mut s, p.o as i8, R_SENTINEL); }
        else if s.crossed >= 2 { end_by_score(&mut s, R_TWO); }
    } else {
        if m.kind == K_ATTACK {
            let d = s.cell[m.to as usize] as usize;
            let dp = s.pieces[d];
            s.pieces[d].st = CAPTURED;
            s.hash ^= z.piece[dp.o as usize][dp.t as usize][m.to as usize];
        }
        s.cell[m.to as usize] = pi as i8;
        s.pieces[pi].pos = m.to;
        s.hash ^= z.piece[o][t][m.to as usize];
    }
    s.hash ^= z.score[0][s.score[0].min(7) as usize] ^ z.score[1][s.score[1].min(7) as usize] ^ z.crossed[s.crossed.min(3) as usize];
    s.ply += 1;
    if !s.over {
        if s.ply >= MAX_PLIES { end_by_score(&mut s, R_PLIES); }
        else {
            s.turn = 1 - s.turn;
            s.hash ^= z.turn;
            if !has_any_move(b, &s) {
                s.turn = 1 - s.turn;
                s.hash ^= z.turn;
                if !has_any_move(b, &s) { end_by_score(&mut s, R_STUCK); } else { s.passed = true; }
            }
        }
    }
    s
}

// Nombre minimal de tours (terrain seul, sans pièces) pour qu'une pièce de type t du camp o sorte depuis chaque case.
pub fn exit_turns(h: &[i8; NC], o: u8, t: u8) -> [u8; NC] {
    let mp = MOVE[t as usize];
    // atteignabilité en un tour depuis chaque case, plateau vide
    let mut one: Vec<Vec<(usize, i32)>> = vec![Vec::new(); NC];
    for s in 0..NC {
        let mut dist = [99i32; NC];
        dist[s] = 0;
        let mut changed = true;
        while changed {
            changed = false;
            for u in 0..NC {
                if dist[u] > mp { continue; }
                for v in neigh(u) {
                    let c = dist[u] + 1 + (h[u] as i32 - h[v] as i32).abs();
                    if c <= mp && c < dist[v] { dist[v] = c; changed = true; }
                }
            }
        }
        for v in 0..NC { if dist[v] <= mp { one[s].push((v, dist[v])); } }
        if t == EXPLORER {
            let (px, py) = (cx(s) as i32, cy(s) as i32);
            for &(dx, dy) in [(1, 1), (1, -1), (-1, 1), (-1, -1), (2, 0), (-2, 0), (0, 2), (0, -2)].iter() {
                let (x, y) = (px + dx, py + dy);
                if x >= 0 && y >= 0 && x < N as i32 && y < N as i32 { one[s].push((y as usize * N + x as usize, 99)); }
            }
        }
    }
    let gr = goal_row(o);
    let mut turns = [99u8; NC];
    for s in 0..NC {
        if one[s].iter().any(|&(v, d)| cy(v) == gr && d <= mp - 1) { turns[s] = 1; }
    }
    let mut changed = true;
    while changed {
        changed = false;
        for s in 0..NC {
            let mut best = turns[s];
            for &(v, _) in one[s].iter() {
                if turns[v] < 99 && turns[v] + 1 < best { best = turns[v] + 1; }
            }
            if best < turns[s] { turns[s] = best; changed = true; }
        }
    }
    turns
}
