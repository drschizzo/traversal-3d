pub mod game;
pub mod search;

use game::*;
use search::*;

// ---------------------------------------------------------------- interface WebAssembly
// Échange par un tampon partagé d'entiers 32 bits, dont les positions sont définies dans layout.json
// (lu par build.rs, et importé tel quel par web/bot/wasm-bridge.js) :
//   entrée : hauteurs, 12 pièces × (type, camp, x, y, statut), trait, ply, scores, pièces sorties
//   sortie de think() : profondeur, nœuds, évaluation (point de vue du camp au trait), alternatives
//   (paires coup, évaluation), variante principale, tours minimaux pour sortir [camp][type][case] (terrain seul)
// Un coup est codé pi | kind << 8 | to << 16.
pub mod layout {
    include!(concat!(env!("OUT_DIR"), "/layout.rs"));
}
use layout::*;

const _: () = assert!(ALTS_MAX == 4, "SearchInfo garde 4 alternatives");
const _: () = assert!(IN_PIECES + NP * PIECE_STRIDE <= IN_TURN && IN_CROSSED < OUT_DEPTH);
const _: () = assert!(OUT_ALTS + 2 * ALTS_MAX <= OUT_PV_LEN && OUT_PV + PV_MAX <= OUT_TURNS && OUT_TURNS + 2 * 3 * NC <= SIZE);

static mut BUF: [i32; SIZE] = [0; SIZE];
static mut ENGINE: Option<Engine> = None;

#[no_mangle]
pub extern "C" fn buf() -> *mut i32 { unsafe { BUF.as_mut_ptr() } }

// version du contrat : le jeu refuse un moteur dont le tampon n'est pas organisé comme il l'attend
#[no_mangle]
pub extern "C" fn layout_version() -> i32 { VERSION as i32 }

fn read_state(b: &Board) -> State {
    let buf = unsafe { &BUF };
    let mut s = State::new_game(b);
    s.cell = [-1; NC];
    for k in 0..NP {
        let o = IN_PIECES + k * PIECE_STRIDE;
        let pos = (buf[o + 3] as usize) * N + buf[o + 2] as usize;
        s.pieces[k] = Piece { t: buf[o] as u8, o: buf[o + 1] as u8, pos: pos as u8, st: buf[o + 4] as u8 };
        if s.pieces[k].st == ON_BOARD { s.cell[pos] = k as i8; }
    }
    s.turn = buf[IN_TURN] as u8;
    s.ply = buf[IN_PLY];
    s.score = [buf[IN_SCORE], buf[IN_SCORE + 1]];
    s.crossed = buf[IN_CROSSED];
    s.hash = s.compute_hash(b);
    s
}

fn pack(m: Move) -> i32 { m.pi as i32 | (m.kind as i32) << 8 | (m.to as i32) << 16 }

// Cherche un coup. Renvoie le coup codé, ou -1 s'il n'y en a aucun.
#[no_mangle]
pub extern "C" fn think(time_ms: f64, max_depth: i32, noise: i32, quiesce: i32, seed: u32, multipv: i32) -> i32 {
    let mut h = [0i8; NC];
    for (i, x) in h.iter_mut().enumerate() { *x = unsafe { BUF[IN_HEIGHTS + i] } as i8; }
    let eng = unsafe { &mut ENGINE };
    if eng.as_ref().map_or(true, |e| e.b.h != h) { *eng = Some(Engine::new(h, Params::default(), 19)); }
    let e = eng.as_mut().unwrap();
    e.seed(seed as u64 * 2654435761 + 1);
    let s = read_state(&e.b);
    let info = e.think(&s, Limits { max_depth, max_nodes: 0, time_ms, noise, quiesce: quiesce != 0, multipv: multipv.max(0) as usize });
    let pv = e.pv_line(&s, PV_MAX);
    let buf = unsafe { &mut BUF };
    buf[OUT_DEPTH] = info.depth;
    buf[OUT_NODES] = info.nodes.min(i32::MAX as u64) as i32;
    buf[OUT_SCORE] = info.score;
    buf[OUT_ALTS_LEN] = info.n_alts as i32;
    for k in 0..info.n_alts {
        buf[OUT_ALTS + 2 * k] = pack(info.alts[k].0);
        buf[OUT_ALTS + 2 * k + 1] = info.alts[k].1;
    }
    buf[OUT_PV_LEN] = pv.len() as i32;
    for (k, &m) in pv.iter().enumerate() { buf[OUT_PV + k] = pack(m); }
    let tt = e.turns_table();
    for o in 0..2 { for t in 0..3 { for c in 0..NC { buf[OUT_TURNS + (o * 3 + t) * NC + c] = tt[o][t][c] as i32; } } }
    if info.mv.is_none() { return -1; }
    pack(info.mv)
}

#[cfg(test)]
mod tests {
    use super::*;

    // écrit une position dans le tampon comme le fait le jeu
    fn write_state(s: &State, h: &[i8; NC]) {
        let buf = unsafe { &mut BUF };
        for i in 0..NC { buf[IN_HEIGHTS + i] = h[i] as i32; }
        for (k, p) in s.pieces.iter().enumerate() {
            let o = IN_PIECES + k * PIECE_STRIDE;
            buf[o..o + 5].copy_from_slice(&[p.t as i32, p.o as i32, (p.pos as usize % N) as i32, (p.pos as usize / N) as i32, p.st as i32]);
        }
        buf[IN_TURN] = s.turn as i32;
        buf[IN_PLY] = s.ply;
        buf[IN_SCORE] = s.score[0];
        buf[IN_SCORE + 1] = s.score[1];
        buf[IN_CROSSED] = s.crossed;
    }

    #[test]
    fn think_renvoie_un_coup_legal_et_son_analyse() {
        let h = generate_terrain("valleys", 1234);
        let b = Board::new(h);
        let s = State::new_game(&b);
        write_state(&s, &h);
        let code = think(0.0, 4, 0, 1, 7, 4);
        assert!(code >= 0);
        let (pi, kind, to) = ((code & 255) as u8, ((code >> 8) & 255) as u8, (code >> 16) as u8);
        let mut ml = MoveList::new();
        gen_moves(&b, &s, &mut ml, false);
        assert!(ml.as_slice().iter().any(|m| m.pi == pi && m.kind == kind && m.to == to), "coup illégal");
        let buf = unsafe { &BUF };
        assert_eq!(buf[OUT_DEPTH], 4);
        assert!(buf[OUT_ALTS_LEN] >= 1 && buf[OUT_ALTS_LEN] as usize <= ALTS_MAX);
        assert_eq!(buf[OUT_ALTS], code, "la meilleure alternative est le coup joué");
        assert!(buf[OUT_PV_LEN] >= 1 && buf[OUT_PV] == code);
        // tours pour sortir : un seul depuis la rangée d’arrivée de Rouge (y = 9), pour chaque type
        for t in 0..3 { assert_eq!(buf[OUT_TURNS + t * NC + 95], 1); }
    }
}
