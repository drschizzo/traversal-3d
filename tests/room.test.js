import { describe, it, expect } from 'vitest';
import { RoomGame } from '../server/room.js';
import { PROTOCOL, REJECT, ERROR, END, allMoves, applyMove, startPosition, toWire, parseClientMessage, normalizeCode, CODE_RE } from '../core/index.js';

let n = 0;
const token = () => `t${++n}`;
const newRoom = (side = 0) => new RoomGame(RoomGame.create({ terrain: 'valleys', seed: 77, side, token: 'creator', now: 0 }));
const join = (room, t = null, v = PROTOCOL) => room.join({ v, token: t }, token);

describe('places dans un salon', () => {
  it('le créateur reprend sa place, l’invité prend la place libre, un troisième est refusé', () => {
    const room = newRoom(1);
    expect(join(room, 'creator')).toEqual({ side: 1 });
    const guest = join(room);
    expect(guest.side).toBe(0);
    expect(guest.patch.tokens[0]).toBe(room.meta.tokens[0]);
    expect(join(room, room.meta.tokens[0])).toEqual({ side: 0 }); // reconnexion de l'invité
    expect(join(room)).toEqual({ error: ERROR.FULL });
    expect(join(room, 'inconnu')).toEqual({ error: ERROR.FULL });
  });
  it('salon inconnu et client d’une autre version', () => {
    expect(join(new RoomGame())).toEqual({ error: ERROR.NOT_FOUND });
    expect(join(newRoom(), 'creator', PROTOCOL + 1)).toEqual({ error: ERROR.VERSION });
  });
});

describe('coups', () => {
  const first = toWire(allMoves(startPosition('valleys', 77))[0]);
  it('accepte un coup légal au bon tour et le garde', () => {
    const room = newRoom();
    const res = room.play(0, { ply: 0, ...first });
    expect(res).toEqual({ ply: 0, move: first, result: null });
    expect(room.moves).toEqual([first]);
    expect(room.game.ply).toBe(1);
  });
  it('refuse un coup hors tour, désynchronisé ou illégal', () => {
    const room = newRoom();
    expect(room.play(1, { ply: 0, ...first })).toEqual({ reject: REJECT.NOT_YOUR_TURN });
    expect(room.play(0, { ply: 3, ...first })).toEqual({ reject: REJECT.DESYNC });
    expect(room.play(0, { ply: 0, pi: 0, kind: 'move', to: 99 })).toEqual({ reject: REJECT.ILLEGAL });
    expect(room.moves).toHaveLength(0);
  });
  it('reconstruit la partie à partir des coups enregistrés (réveil du salon)', () => {
    const room = newRoom();
    let s = room.game;
    for (let k = 0; k < 6; k++) { const m = toWire(allMoves(s)[k]); room.play(s.turn, { ply: s.ply, ...m }); s = applyMove(s, m); }
    const woken = new RoomGame(structuredClone(room.meta), structuredClone(room.moves));
    expect(woken.game.ply).toBe(6);
    expect(woken.game.pieces).toEqual(room.game.pieces);
  });
});

describe('fin de partie et revanche', () => {
  it('abandon : l’autre camp gagne, une seule fois', () => {
    const room = newRoom();
    expect(room.resign(0)).toEqual({ winner: 1, reason: END.RESIGN, resigned: 0 });
    expect(room.resign(1)).toBeNull();
    expect(room.play(1, { ply: 0, pi: 6, kind: 'move', to: 80 })).toEqual({ reject: REJECT.OVER });
  });
  it('revanche quand les deux la demandent : nouveau monde, couleurs échangées', () => {
    const room = newRoom(0);
    join(room);
    const [a, b] = room.meta.tokens;
    expect(room.rematch(0, 5)).toBeNull(); // partie pas finie
    room.resign(1);
    expect(room.rematch(0, 5)).toEqual({ started: false });
    expect(room.rematch(1, 5)).toEqual({ started: true });
    expect(room.meta).toMatchObject({ seed: 5, tokens: [b, a], result: null, rematch: [false, false] });
    expect(room.moves).toEqual([]);
    expect(room.stateFor(0, true)).toMatchObject({ type: 'state', v: PROTOCOL, seed: 5, you: 0, token: b, turn: 0, opponent: true });
  });
});

describe('protocole', () => {
  it('valide les messages des clients', () => {
    expect(parseClientMessage('{"type":"join"}')).toEqual({ type: 'join', v: PROTOCOL, token: null });
    expect(parseClientMessage('{"type":"move","ply":3,"pi":2,"kind":"attack","to":45}')).toEqual({ type: 'move', ply: 3, pi: 2, kind: 'attack', to: 45 });
    for (const bad of ['', 'ping', '[]', '{"type":"move","ply":3,"pi":12,"kind":"move","to":4}', '{"type":"move","ply":0,"pi":1,"kind":"fly","to":4}',
      '{"type":"join","token":5}', '{"type":"hack"}', 'x'.repeat(600)]) expect(parseClientMessage(bad), bad).toBeNull();
  });
  it('normalise les codes de salon', () => {
    expect(normalizeCode(' abc-def gh')).toBe('ABCDEF');
    expect(CODE_RE.test('ABCDEF')).toBe(true);
    expect(CODE_RE.test('ABCDEI')).toBe(false);
  });
});
