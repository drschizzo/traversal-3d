pub mod game;
pub mod search;

use game::*;
use search::*;

// ---------------------------------------------------------------- interface WebAssembly
// Échange par un tampon partagé d'entiers 32 bits :
//   [0..100)   hauteurs
//   [100..160) 12 pièces × (type, camp, x, y, statut)
//   160 trait, 161 ply, 162 score rouge, 163 score bleu, 164 pièces sorties
// Sortie de think() :
//   [200] profondeur atteinte, [201] nœuds, [202] évaluation (point de vue du camp au trait)
//   [210] nombre d'alternatives, puis [211..219) paires (coup, évaluation)
//   [230] longueur de la variante principale, puis [231..247) ses coups
//   [400..1000) tours minimaux pour sortir, indexés [camp][type][case] (terrain seul)
// Un coup est codé pi | kind << 8 | to << 16.

static mut BUF: [i32; 1024] = [0; 1024];
static mut ENGINE: Option<Engine> = None;

#[no_mangle]
pub extern "C" fn buf() -> *mut i32 { unsafe { BUF.as_mut_ptr() } }

fn read_state(b: &Board) -> State {
    let buf = unsafe { &BUF };
    let mut s = State::new_game(b);
    s.cell = [-1; NC];
    for k in 0..NP {
        let o = 100 + k * 5;
        let pos = (buf[o + 3] as usize) * N + buf[o + 2] as usize;
        s.pieces[k] = Piece { t: buf[o] as u8, o: buf[o + 1] as u8, pos: pos as u8, st: buf[o + 4] as u8 };
        if s.pieces[k].st == ON_BOARD { s.cell[pos] = k as i8; }
    }
    s.turn = buf[160] as u8;
    s.ply = buf[161];
    s.score = [buf[162], buf[163]];
    s.crossed = buf[164];
    s.hash = s.compute_hash(b);
    s
}

fn pack(m: Move) -> i32 { m.pi as i32 | (m.kind as i32) << 8 | (m.to as i32) << 16 }

// Cherche un coup. Renvoie le coup codé, ou -1 s'il n'y en a aucun.
#[no_mangle]
pub extern "C" fn think(time_ms: f64, max_depth: i32, noise: i32, quiesce: i32, seed: u32, multipv: i32) -> i32 {
    let mut h = [0i8; NC];
    for i in 0..NC { h[i] = unsafe { BUF[i] } as i8; }
    let eng = unsafe { &mut ENGINE };
    if eng.as_ref().map_or(true, |e| e.b.h != h) { *eng = Some(Engine::new(h, Params::default(), 19)); }
    let e = eng.as_mut().unwrap();
    e.seed(seed as u64 * 2654435761 + 1);
    let s = read_state(&e.b);
    let info = e.think(&s, Limits { max_depth, max_nodes: 0, time_ms, noise, quiesce: quiesce != 0, multipv: multipv.max(0) as usize });
    let pv = e.pv_line(&s, 16);
    let buf = unsafe { &mut BUF };
    buf[200] = info.depth;
    buf[201] = info.nodes.min(i32::MAX as u64) as i32;
    buf[202] = info.score;
    buf[210] = info.n_alts as i32;
    for k in 0..info.n_alts {
        buf[211 + 2 * k] = pack(info.alts[k].0);
        buf[212 + 2 * k] = info.alts[k].1;
    }
    buf[230] = pv.len() as i32;
    for (k, &m) in pv.iter().enumerate() { buf[231 + k] = pack(m); }
    let tt = e.turns_table();
    for o in 0..2 { for t in 0..3 { for c in 0..NC { buf[400 + (o * 3 + t) * NC + c] = tt[o][t][c] as i32; } } }
    if info.mv.is_none() { return -1; }
    pack(info.mv)
}
