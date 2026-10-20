pub mod game;
pub mod search;

use game::*;
use search::*;

// ---------------------------------------------------------------- interface WebAssembly
// Échange par un tampon partagé d'entiers 32 bits :
//   [0..100)   hauteurs
//   [100..160) 12 pièces × (type, camp, x, y, statut)
//   160 trait, 161 ply, 162 score rouge, 163 score bleu, 164 pièces sorties
// Sortie de think() : [200] profondeur atteinte, [201] nœuds, [202] évaluation.

static mut BUF: [i32; 256] = [0; 256];
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

// Cherche un coup. Renvoie pi | kind << 8 | to << 16, ou -1 s'il n'y en a aucun.
#[no_mangle]
pub extern "C" fn think(time_ms: f64, max_depth: i32, noise: i32, quiesce: i32, seed: u32) -> i32 {
    let mut h = [0i8; NC];
    for i in 0..NC { h[i] = unsafe { BUF[i] } as i8; }
    let eng = unsafe { &mut ENGINE };
    if eng.as_ref().map_or(true, |e| e.b.h != h) { *eng = Some(Engine::new(h, Params::default(), 19)); }
    let e = eng.as_mut().unwrap();
    e.seed(seed as u64 * 2654435761 + 1);
    let s = read_state(&e.b);
    let info = e.think(&s, Limits { max_depth, max_nodes: 0, time_ms, noise, quiesce: quiesce != 0 });
    unsafe {
        BUF[200] = info.depth;
        BUF[201] = info.nodes.min(i32::MAX as u64) as i32;
        BUF[202] = info.score;
    }
    if info.mv.is_none() { return -1; }
    info.mv.pi as i32 | (info.mv.kind as i32) << 8 | (info.mv.to as i32) << 16
}
