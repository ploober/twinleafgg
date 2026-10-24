import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-752 — when an attack Knocks Out the opponent's Active AND a Benched Pokémon of the same printing, the Bench's
 * `damaged` was reported on the Active.
 *
 * The KO batch attributes a placement to the KO'd Pokémon its log names (TA-252 for counters, TA-318 for attack
 * damage). Names collide across identical printings, so with two KO'd Erika's Bellsprout the name matched both and the
 * placement fell through to the positional "defender" dump: Obsidian ssp-119 emitted `damaged b1s0 130` twice and none
 * on bb1s0; Phantom Dive asc-160 one `damaged b1s0 260`. The state was right; the trace named the wrong Pokémon.
 * Pristine twinleaf attributes them correctly (its dispatch boundary diffs both hits as survivors).
 *
 * The KO log carries each Pokémon's damage at the Knock Out. Within a group of same-named KO'd, every assignment of
 * those logs to the Pokémon that leaves no placement negative gives the same per-Pokémon placement here (the Active's
 * lethal hit was already emitted in the prior batch, so its share is 0): the placement goes to the one whose share it is.
 *
 * Mutation guard: drop the KO-log disambiguation in events.ts (`koShareByName`) → tests 1 and 2 put the Bench damage
 * on b1s0 again. Test 3 is the control: different printings, which TA-318's name match already separates.
 */

const BELLSPROUT = 'asc-004';  // Erika's Bellsprout, 60 HP — B's Active and Bench
const ODDISH = 'asc-001';      // Erika's Oddish — the control's Bench, a different name
const PSY = 'sve-005', DARK = 'sve-007', METAL = 'sve-008', WATER = 'sve-003', FIRE = 'sve-002';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function pip(stack: CardRef[], energy: CardRef[] = []): PokemonInPlay {
  return { stack, energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(attacker: CardRef[], energy: CardRef[], benchPrinting: string): NeutralState {
  const withZones = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false })),
    deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: WATER })),
  });
  const A = player({ active: pip(attacker, energy), bench: [pip([{ iid: 'ab1s0', printing: BELLSPROUT }])] });
  const B = player({
    active: pip([{ iid: 'b1s0', printing: BELLSPROUT }], [{ iid: 'b1e1', printing: WATER }]),
    bench: [pip([{ iid: 'bb1s0', printing: benchPrinting }])],
  });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A: withZones(A, 'a'), B: withZones(B, 'b') },
  };
}

const HYDREIGON: CardRef[] = [{ iid: 'a1s0', printing: 'pal-138' }, { iid: 'a1s1', printing: 'pal-139' }, { iid: 'a1s2', printing: 'ssp-119' }];
const HYDREIGON_ENERGY: CardRef[] = [{ iid: 'a1e1', printing: PSY }, { iid: 'a1e2', printing: DARK }, { iid: 'a1e3', printing: METAL }, { iid: 'a1e4', printing: WATER }];
const DRAGAPULT: CardRef[] = [{ iid: 'a1s0', printing: 'asc-158' }, { iid: 'a1s1', printing: 'asc-159' }, { iid: 'a1s2', printing: 'asc-160' }];
const DRAGAPULT_ENERGY: CardRef[] = [{ iid: 'a1e1', printing: FIRE }, { iid: 'a1e2', printing: PSY }];

const attack = (name: string): NeutralAction => ({ actor: 'A', type: 'declareAttack', source: 'a1s0', name } as unknown as NeutralAction);
type Ev = { kind: string; target?: string; hp?: number };
const damagedBy = (r: ReturnType<typeof step>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const e of r.events as unknown as Ev[]) {
    if (e.kind === 'damaged' && e.target !== undefined) { out[e.target] = (out[e.target] ?? 0) + (e.hp ?? 0); }
  }
  return out;
};
const kos = (r: ReturnType<typeof step>): string[] =>
  (r.events as unknown as Ev[]).filter(e => e.kind === 'ko').map(e => e.target!).sort();

describe('TA-752 — a Bench KO of the same printing as the KO\'d Active is reported on the Bench Pokémon', () => {

  it('1. Obsidian (130 + 130 to a Benched Pokémon): b1s0 and bb1s0 each take 130', () => {
    const r = step(board(HYDREIGON, HYDREIGON_ENERGY, BELLSPROUT), [attack('Obsidian')]);
    expect(kos(r)).toEqual(['b1s0', 'bb1s0']);
    expect(damagedBy(r)).toEqual({ b1s0: 130, bb1s0: 130 });
  });

  it('2. Phantom Dive (200 + 6 counters on the only Benched Pokémon): b1s0 200, bb1s0 60', () => {
    const r = step(board(DRAGAPULT, DRAGAPULT_ENERGY, BELLSPROUT), [attack('Phantom Dive')]);
    expect(kos(r)).toEqual(['b1s0', 'bb1s0']);
    expect(damagedBy(r)).toEqual({ b1s0: 200, bb1s0: 60 });
  });

  it('3. control — Obsidian with a Bench of a different printing: already attributed by name', () => {
    const r = step(board(HYDREIGON, HYDREIGON_ENERGY, ODDISH), [attack('Obsidian')]);
    expect(kos(r)).toEqual(['b1s0', 'bb1s0']);
    expect(damagedBy(r)).toEqual({ b1s0: 130, bb1s0: 130 });
  });
});
