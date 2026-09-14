import { deriveEvents } from '../events';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, NeutralEvent, SCHEMA_VERSION,
} from '../neutral-types';
import { GameLog } from '../../game/game-message';
import { StateLog } from '../../game/store/state/state-log';

// TA-415 (CF-60 / CF-73): `energyAttached.pokemon` named the wrong Pokemon when the attach target was
// Knocked Out in the same dispatch AND a same-name copy stayed in play. Gnawing Curse (Gengar ex
// tef-104) on a 40-damaged 60-HP Bellsprout with a second Bellsprout on the Bench: the log names the
// receiver by display name only, the receiver is gone from the after-state, and the after-state
// name->iid fallback (which wins over the before-state fill from 87fc3c67b) named the LIVE Bench copy.
// resolvePokemonIids now prefers a Pokemon that LEFT play this dispatch when the attached card left
// play with it (it is newly in the discard). Mutation: delete the `leftPlayNames` branch in `resolve`
// -> test 1 names `bb1`.

const BASIC = 'asc-004';
const GRASS = 'sve-001';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function inPlay(iid: string, energy: CardRef[] = [], damage = 0): PokemonInPlay {
  return { stack: [{ iid, printing: BASIC }], energy, tools: [], damage, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, turn: 4, activePlayer: 'B', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const NAMES = new Map<string, string>([
  ['b1', "Erika's Bellsprout"], ['bb1', "Erika's Bellsprout"], ['b9', 'Oddish'], ['bh2', 'Grass Energy'], ['a1', 'Gengar ex'],
]);
const ENERGY: CardRef = { iid: 'bh2', printing: GRASS };
const attachLog = (pokemon: string): StateLog =>
  ({ message: GameLog.LOG_PLAYER_ATTACHES_CARD, params: { name: 'B', card: 'Grass Energy', pokemon } } as unknown as StateLog);
const attached = (evs: NeutralEvent[]): NeutralEvent[] => evs.filter(e => e.kind === 'energyAttached');

describe('TA-415 — energyAttached names the KO\'d receiver, not a same-name copy still in play', () => {

  it('attach-then-KO with a same-name Bench copy: pokemon is the departed Active, not the live Bench copy', () => {
    const before = board(player({ active: inPlay('a1') }),
      player({ active: inPlay('b1', [], 40), bench: [inPlay('bb1')], hand: [ENERGY] }));
    // After: b1 and the Energy are in B's discard; bb1 is still on the Bench (not yet promoted).
    const after = board(player({ active: inPlay('a1') }),
      player({ active: null, bench: [inPlay('bb1')], discard: [{ iid: 'b1', printing: BASIC }, ENERGY] }));
    const evs = attached(deriveEvents(before, after, [attachLog("Erika's Bellsprout")], undefined, undefined, NAMES));
    expect(evs.length).toBe(1);
    expect(evs[0].pokemon).toBe('b1');
  });

  it('attach-then-KO with a UNIQUE name still resolves to the departed Pokemon (the 87fc3c67b path)', () => {
    const before = board(player({ active: inPlay('a1') }),
      player({ active: inPlay('b9', [], 40), bench: [inPlay('bb1')], hand: [ENERGY] }));
    const after = board(player({ active: inPlay('a1') }),
      player({ active: null, bench: [inPlay('bb1')], discard: [{ iid: 'b9', printing: BASIC }, ENERGY] }));
    const evs = attached(deriveEvents(before, after, [attachLog('Oddish')], undefined, undefined, NAMES));
    expect(evs.length).toBe(1);
    expect(evs[0].pokemon).toBe('b9');
  });

  it('control: a live receiver keeps the state-diff answer even when a same-name Pokemon left play', () => {
    // bb1 gains the Energy and survives; b1 (same name) is KO\'d by something else in the same dispatch.
    const before = board(player({ active: inPlay('a1') }),
      player({ active: inPlay('b1', [], 40), bench: [inPlay('bb1')], hand: [ENERGY] }));
    const after = board(player({ active: inPlay('a1') }),
      player({ active: null, bench: [inPlay('bb1', [ENERGY])], discard: [{ iid: 'b1', printing: BASIC }] }));
    const evs = attached(deriveEvents(before, after, [attachLog("Erika's Bellsprout")], undefined, undefined, NAMES));
    expect(evs.length).toBe(1);
    expect(evs[0].pokemon).toBe('bb1');
  });

  it('control: no KO, attach to the Active with a same-name Bench copy — the state diff names the Active', () => {
    const before = board(player({ active: inPlay('a1') }),
      player({ active: inPlay('b1'), bench: [inPlay('bb1')], hand: [ENERGY] }));
    const after = board(player({ active: inPlay('a1') }),
      player({ active: inPlay('b1', [ENERGY]), bench: [inPlay('bb1')] }));
    const evs = attached(deriveEvents(before, after, [attachLog("Erika's Bellsprout")], undefined, undefined, NAMES));
    expect(evs.length).toBe(1);
    expect(evs[0].pokemon).toBe('b1');
  });
});
