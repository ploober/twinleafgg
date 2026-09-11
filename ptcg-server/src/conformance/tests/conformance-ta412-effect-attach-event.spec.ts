import { deriveEvents } from '../events';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, NeutralEvent, SCHEMA_VERSION,
} from '../neutral-types';
import { GameLog } from '../../game/game-message';
import { StateLog } from '../../game/store/state/state-log';

// TA-412 (CF-73, contract v0.7.1): every Energy attachment emits `energyAttached`, whatever moved the
// card. The fork logs LOG_PLAYER_ATTACHES_CARD only in the AttachEnergyEffect reducer, so an
// effect-driven attach applied via MoveCardsEffect (AttachEnergyPrompt -> MOVE_CARDS: Roar of the
// Sword cel-016, Jolting Charge scr-050, Dynamotor blk-031, 42+ in-pool printings) — and the
// ChooseCardsPrompt+moveCardTo shape (Adornment cpa-023) — attaches the Energy in state but emits
// nothing. deriveEvents now emits it from the before/after state diff (the `healed` pattern), so the
// card's code path cannot matter. These guard the derivation directly (mutation: delete the leftover
// loop -> test 1 goes to 0 events).

const BASIC = 'sve-001';   // any printing string; the derivation keys on iids + allNames, not the DB
const FIRE = 'sve-002';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function inPlay(iid: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing: BASIC }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
// Names for every iid the diff touches: the Pokemon (fallback) and the Energy (queue key).
const NAMES = new Map<string, string>([['a1', 'Pikachu'], ['a2', 'Raichu'], ['a1e0', 'Fire Energy']]);
const attached = (evs: NeutralEvent[]): NeutralEvent[] => evs.filter(e => e.kind === 'energyAttached');

describe('TA-412 / CF-73 — energyAttached is derived from the state diff for effect attaches', () => {

  it('emits energyAttached for an attach that appears in state with NO attach log (the MOVE_CARDS path)', () => {
    const before = board(player({ active: inPlay('a1', []) }), player());
    const after = board(player({ active: inPlay('a1', [{ iid: 'a1e0', printing: FIRE }]) }), player());
    const evs = attached(deriveEvents(before, after, [], undefined, undefined, NAMES));
    expect(evs.length).toBe(1);
    expect(evs[0]).toEqual({ kind: 'energyAttached', player: 'A', card: 'Fire Energy', pokemon: 'a1' });
  });

  it('does NOT double-emit when the attach was already logged (the manual / AttachEnergyEffect path)', () => {
    const before = board(player({ active: inPlay('a1', []) }), player());
    const after = board(player({ active: inPlay('a1', [{ iid: 'a1e0', printing: FIRE }]) }), player());
    const log: StateLog = { message: GameLog.LOG_PLAYER_ATTACHES_CARD, params: { name: 'A', card: 'Fire Energy', pokemon: 'Pikachu' } } as unknown as StateLog;
    const evs = attached(deriveEvents(before, after, [log], undefined, undefined, NAMES));
    expect(evs.length).toBe(1);
    expect(evs[0].pokemon).toBe('a1');
  });

  it('does NOT emit for an in-play -> in-play relocation (moveEnergy is excluded by beforeEnergy)', () => {
    const before = board(player({ active: inPlay('a1', [{ iid: 'a1e0', printing: FIRE }]), bench: [inPlay('a2', [])] }), player());
    const after = board(player({ active: inPlay('a1', []), bench: [inPlay('a2', [{ iid: 'a1e0', printing: FIRE }])] }), player());
    const evs = attached(deriveEvents(before, after, [], undefined, undefined, NAMES));
    expect(evs.length).toBe(0);
  });
});
