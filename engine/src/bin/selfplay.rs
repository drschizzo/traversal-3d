// Banc d'essai natif : vérification des règles, matchs entre réglages, génération de parties pour les statistiques.
//
//   selfplay terrain mode=random seeds=0..100          hauteurs générées (comparaison avec game.js)
//   selfplay dump games=50                              parties aléatoires + coups légaux (comparaison avec game.js)
//   selfplay match games=200 a.nodes=200000 b.legacy=1  paires de parties, couleurs inversées
//   selfplay gen games=10000 nodes=150000 out=data.jsonl
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use traversal_engine::game::*;
use traversal_engine::search::*;

struct Args(HashMap<String, String>);
impl Args {
    fn get<T: std::str::FromStr>(&self, k: &str, d: T) -> T { self.0.get(k).and_then(|v| v.parse().ok()).unwrap_or(d) }
    fn s(&self, k: &str, d: &str) -> String { self.0.get(k).cloned().unwrap_or_else(|| d.to_string()) }
}

fn splitmix(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E3779B97F4A7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D049BB133111EB);
    x ^ (x >> 31)
}

fn params_from(a: &Args, pre: &str) -> Params {
    let mut p = Params::default();
    let g = |k: &str, d: i32| a.get(&format!("{pre}{k}"), d);
    p.val = [g("val0", p.val[0]), g("val1", p.val[1]), g("val2", p.val[2])];
    p.prog = [g("prog0", p.prog[0]), g("prog1", p.prog[1]), g("prog2", p.prog[2])];
    p.sent_prog0 = g("sent_prog0", p.sent_prog0);
    p.exit_bonus = g("exit_bonus", p.exit_bonus);
    p.score_w = g("score_w", p.score_w);
    p.race0 = g("race0", p.race0);
    p.race1 = g("race1", p.race1);
    p.legacy = g("legacy", 0) != 0;
    p
}

fn limits_from(a: &Args, pre: &str) -> Limits {
    Limits {
        max_depth: a.get(&format!("{pre}depth"), 64),
        max_nodes: a.get(&format!("{pre}nodes"), 100_000u64),
        time_ms: a.get(&format!("{pre}time"), 0.0),
        noise: a.get(&format!("{pre}noise"), 0),
        quiesce: a.get(&format!("{pre}quiesce"), 1) != 0,
    }
}

fn game_board(gi: usize, base: u64) -> (&'static str, u32) {
    let r = splitmix(base ^ (gi as u64 / 2));
    (MODES[(r % 6) as usize], (r >> 16) as u32)
}

fn main() {
    let mut it = std::env::args().skip(1);
    let cmd = it.next().unwrap_or_default();
    let args = Args(it.filter_map(|a| a.split_once('=').map(|(k, v)| (k.to_string(), v.to_string()))).collect());
    match cmd.as_str() {
        "terrain" => terrain(&args),
        "dump" => dump(&args),
        "match" => run_match(&args),
        "gen" => gen(&args),
        "bench" => bench(&args),
        _ => eprintln!("commandes : terrain | dump | match | gen | bench"),
    }
}

fn terrain(a: &Args) {
    let n: u32 = a.get("n", 200);
    for mode in MODES.iter() {
        for k in 0..n {
            let seed = k.wrapping_mul(2654435761);
            let h = generate_terrain(mode, seed);
            let v: Vec<String> = h.iter().map(|x| x.to_string()).collect();
            println!("{} {} {}", mode, seed, v.join(","));
        }
    }
}

// parties au hasard : à chaque ply, liste triée des coups légaux (format pi:kind:to)
fn dump(a: &Args) {
    let games: usize = a.get("games", 30);
    let mut rng = 12345u64;
    for g in 0..games {
        let mode = MODES[g % 6];
        let seed = (g as u32).wrapping_mul(7919).wrapping_add(1);
        let b = Board::new(generate_terrain(mode, seed));
        let mut s = State::new_game(&b);
        let mut plies = Vec::new();
        while !s.over {
            let mut ml = MoveList::new();
            gen_moves(&b, &s, &mut ml, false);
            let mut keys: Vec<String> = ml.as_slice().iter().map(|m| format!("{}:{}:{}", m.pi, m.kind, if m.kind == K_EXIT { 0 } else { m.to })).collect();
            keys.sort();
            rng = splitmix(rng);
            let m = ml.m[(rng % ml.n as u64) as usize];
            plies.push(format!("{{\"legal\":\"{}\",\"pick\":\"{}:{}:{}\",\"hash\":{}}}", keys.join(" "), m.pi, m.kind, m.to, s.hash == s.compute_hash(&b)));
            s = apply_move(&b, &s, m);
        }
        println!("{{\"mode\":\"{}\",\"seed\":{},\"plies\":[{}],\"winner\":{},\"reason\":{},\"score\":[{},{}]}}", mode, seed, plies.join(","), s.winner, s.reason, s.score[0], s.score[1]);
    }
}

fn bench(a: &Args) {
    let b = Board::new(generate_terrain("random", a.get("seed", 42u32)));
    let mut e = Engine::new(b.h, Params::default(), 20);
    let s = State::new_game(&b);
    let t = Instant::now();
    let info = e.think(&s, Limits { max_depth: a.get("depth", 64), max_nodes: 0, time_ms: a.get("time", 3000.0), noise: 0, quiesce: true });
    let dt = t.elapsed().as_secs_f64();
    println!("profondeur {} nœuds {} ({:.0} k/s) éval {} coup pi={} kind={} to={}", info.depth, info.nodes, info.nodes as f64 / dt / 1000.0, info.score, info.mv.pi, info.mv.kind, info.mv.to);
}

struct GameRecord { winner: i8, reason: u8, plies: i32, json: String }

// Joue une partie ; engines[0] joue Rouge, engines[1] Bleu.
fn play(mode: &str, seed: u32, cfg: [(Params, Limits); 2], rand_plies: i32, rng_seed: u64, record: bool) -> GameRecord {
    let h = generate_terrain(mode, seed);
    let mut eng = [Engine::new(h, cfg[0].0, 18), Engine::new(h, cfg[1].0, 18)];
    eng[0].seed(rng_seed);
    eng[1].seed(rng_seed ^ 0xABCDEF);
    let b = Board::new(h);
    let mut s = State::new_game(&b);
    let mut moves: Vec<String> = Vec::new();
    while !s.over {
        let side = s.turn as usize;
        let mut lim = cfg[side].1;
        if s.ply < rand_plies { lim.noise = lim.noise.max(12); }
        let t0 = Instant::now();
        let info = eng[side].think(&s, lim);
        let dt = t0.elapsed().as_secs_f64();
        if dt > 2.0 {
            eprintln!("coup lent : {:.1} s, {} {} ply {} profondeur {} nœuds {}", dt, mode, seed, s.ply, info.depth, info.nodes);
        }
        let m = info.mv;
        if m.is_none() { break; }
        if record { moves.push(move_json(&eng[side], &b, &s, m, &info)); }
        s = apply_move(&b, &s, m);
    }
    let json = if record {
        let hs: Vec<String> = h.iter().map(|x| x.to_string()).collect();
        format!("{{\"mode\":\"{}\",\"seed\":{},\"winner\":{},\"reason\":{},\"tiebreak\":{},\"plies\":{},\"score\":[{},{}],\"h\":[{}],\"moves\":[{}]}}",
            mode, seed, s.winner, s.reason, s.tiebreak, s.ply, s.score[0], s.score[1], hs.join(","), moves.join(","))
    } else { String::new() };
    GameRecord { winner: s.winner, reason: s.reason, plies: s.ply, json }
}

// Un coup et un instantané de la position avant lui
fn move_json(e: &Engine, b: &Board, s: &State, m: Move, info: &SearchInfo) -> String {
    let p = s.pieces[m.pi as usize];
    let from = p.pos as usize;
    let to = m.to as usize;
    // tours restants avant / après pour la pièce jouée (si elle reste sur le plateau)
    let tl0 = e.turns_left(&p);
    let tl1 = if m.kind == K_EXIT { 0 } else { e.turns_left(&Piece { pos: m.to, ..p }) };
    let mut extra = String::new();
    if m.kind == K_ATTACK {
        let d = s.pieces[s.cell[to] as usize];
        let vb = p.t == VANGUARD && m.cost == 4 && m.special == SP_NONE;
        let cb = combat(b, s, m.pi as usize, to, vb);
        extra = format!(",\"vt\":{},\"att\":{},\"def\":{},\"hgt\":{},\"al\":{},\"rf\":{},\"vb\":{}", d.t, cb.att, cb.def, cb.height, cb.allies, cb.reinf, cb.vb);
    }
    // instantané : par camp et par type, tours restants des pièces sur le plateau (99 = absente)
    let mut snap = Vec::new();
    for o in 0..2u8 {
        for t in 0..3u8 {
            let mut v: Vec<i32> = s.pieces.iter().filter(|q| q.o == o && q.t == t && q.st == ON_BOARD).map(|q| e.turns_left(q)).collect();
            v.sort();
            while v.len() < 2 { v.push(99); }
            snap.push(format!("{},{}", v[0], v[1]));
        }
    }
    // soutiens : alliés adjacents à la case d'arrivée (après le coup)
    let mut sup = 0;
    let mut foes = 0;
    if m.kind != K_EXIT {
        for n in neigh(to) {
            let q = s.cell[n];
            if q < 0 || q as usize == m.pi as usize || (m.kind == K_ATTACK && n == to) { continue; }
            if s.pieces[q as usize].o == p.o { sup += 1; } else { foes += 1; }
        }
    }
    format!("{{\"o\":{},\"t\":{},\"k\":{},\"sp\":{},\"f\":{},\"to\":{},\"c\":{},\"hf\":{},\"ht\":{},\"tl0\":{},\"tl1\":{},\"ev\":{},\"d\":{},\"sup\":{},\"foe\":{},\"snap\":[{}],\"sc\":[{},{}],\"x\":{}{}}}",
        p.o, p.t, m.kind, m.special, from, to, m.cost, b.h[from], b.h[to], tl0, tl1, info.score, info.depth, sup, foes, snap.join(","), s.score[0], s.score[1], s.crossed, extra)
}

fn run_parallel<F: Fn(usize) -> GameRecord + Sync + Send + 'static>(games: usize, threads: usize, f: F, out: Option<String>) -> Vec<(usize, GameRecord)> {
    let f = Arc::new(f);
    let next = Arc::new(AtomicUsize::new(0));
    let results = Arc::new(Mutex::new(Vec::new()));
    let writer = Arc::new(Mutex::new(out.map(|p| BufWriter::new(File::create(p).expect("fichier de sortie")))));
    let t0 = Instant::now();
    let mut hs = Vec::new();
    for _ in 0..threads {
        let (f, next, results, writer) = (f.clone(), next.clone(), results.clone(), writer.clone());
        hs.push(std::thread::spawn(move || loop {
            let gi = next.fetch_add(1, Ordering::SeqCst);
            if gi >= games { break; }
            let mut r = f(gi);
            if let Some(w) = writer.lock().unwrap().as_mut() { writeln!(w, "{}", r.json).unwrap(); }
            r.json = String::new();
            let mut res = results.lock().unwrap();
            res.push((gi, r));
            let n = res.len();
            if n % 50 == 0 || n == games {
                eprintln!("  {}/{} parties ({:.0} s)", n, games, t0.elapsed().as_secs_f64());
            }
        }));
    }
    for h in hs { h.join().unwrap(); }
    if let Some(w) = writer.lock().unwrap().as_mut() { w.flush().unwrap(); }
    let mut r = Arc::try_unwrap(results).ok().unwrap().into_inner().unwrap();
    r.sort_by_key(|x| x.0);
    r
}

fn threads(a: &Args) -> usize { a.get("threads", std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4)) }

// Match A contre B : chaque plateau est joué deux fois, couleurs inversées.
fn run_match(a: &Args) {
    let games: usize = a.get::<usize>("games", 100) / 2 * 2;
    let base: u64 = a.get("base", 1u64);
    let rp: i32 = a.get("rand_plies", 0);
    let ca = (params_from(a, "a."), limits_from(a, "a."));
    let cb = (params_from(a, "b."), limits_from(a, "b."));
    let res = run_parallel(games, threads(a), move |gi| {
        let (mode, seed) = game_board(gi, base);
        // gi pair : A joue Rouge ; gi impair : A joue Bleu
        let cfg = if gi % 2 == 0 { [ca, cb] } else { [cb, ca] };
        play(mode, seed, cfg, rp, splitmix(gi as u64 + base), false)
    }, None);
    let (mut w, mut d, mut l, mut plies) = (0, 0, 0, 0);
    let mut red = 0.0;
    for (gi, r) in res.iter() {
        let a_side = (gi % 2) as i8;
        plies += r.plies;
        if r.winner == 2 { d += 1; red += 0.5; }
        else {
            if r.winner == 0 { red += 1.0; }
            if r.winner == a_side { w += 1 } else { l += 1 }
        }
    }
    let n = games as f64;
    let sc = (w as f64 + 0.5 * d as f64) / n;
    let elo = if sc > 0.0 && sc < 1.0 { -400.0 * (1.0 / sc - 1.0).log10() } else if sc >= 1.0 { 999.0 } else { -999.0 };
    // erreur type sur le score (approximation par parties indépendantes)
    let var = (w as f64 * (1.0 - sc).powi(2) + d as f64 * (0.5 - sc).powi(2) + l as f64 * sc.powi(2)) / n;
    let se = (var / n).sqrt();
    let elo_lo = -400.0 * (1.0 / (sc - 1.96 * se).clamp(0.001, 0.999) - 1.0).log10();
    let elo_hi = -400.0 * (1.0 / (sc + 1.96 * se).clamp(0.001, 0.999) - 1.0).log10();
    let reasons = [1u8, 2, 3, 4].map(|k| res.iter().filter(|(_, r)| r.reason == k).count());
    println!("A : +{} ={} -{}  score {:.1}%  Elo {:+.0} [{:+.0} ; {:+.0}]  | Rouge {:.1}%  longueur moy {:.1}  fins S/2/200/bloqué {:?}",
        w, d, l, sc * 100.0, elo, elo_lo, elo_hi, red / n * 100.0, plies as f64 / n, reasons);
}

fn gen(a: &Args) {
    let games: usize = a.get("games", 1000);
    let base: u64 = a.get("base", 7u64);
    let rp: i32 = a.get("rand_plies", 2);
    let c = (params_from(a, ""), limits_from(a, ""));
    let out = a.s("out", "games.jsonl");
    run_parallel(games, threads(a), move |gi| {
        let r = splitmix(base.wrapping_mul(1_000_003) ^ gi as u64);
        let (mode, seed) = (MODES[(r % 6) as usize], (r >> 16) as u32);
        play(mode, seed, [c, c], rp, splitmix(r), true)
    }, Some(out));
}
