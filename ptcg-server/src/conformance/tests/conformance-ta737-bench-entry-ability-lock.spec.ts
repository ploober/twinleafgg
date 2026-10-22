import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-737: an Ability that works "when you play this Pokémon from your hand onto your Bench" ignored Ability locks.
 *   Klefki svi-096 Mischievous Lock: "As long as this Pokémon is in the Active Spot, Basic Pokémon in play (both yours
 *     and your opponent's) have no Abilities, except for Mischievous Lock."
 * The Pokémon is in play when its Ability would be used (compendium #1991, Rapid Vernier under Mischievous Lock; #1536,
 * #80), so the lock applies. The card handlers saw PlayPokemonEffect while the card was still in the hand, and the lock
 * only reaches Pokémon in play, so IS_ABILITY_BLOCKED said "not blocked": Meowth ex's search ran, and Iron Leaves ex
 * offered a confirm that then did nothing. Found by bug report 1554694816728621086 (Tapu Lele-GX Wonder Tag under
 * Klefki). Each control puts Klefki on B's Bench instead, where it locks nothing.
 */

const KLEFKI = 'svi-096';
const GOTHITA = 'pal-090';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function board(played: string, klefkiActive: boolean): NeutralState {
  const deck = ['sve-003', 'pal-185', 'sve-003', 'pal-185', 'sve-003'];
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing',
    stadium: null,
    players: {
      A: player({ active: mon('a0', GOTHITA), hand: [{ iid: 'ah0', printing: played }], deck: cards('ad', deck), prizes: cards('ap', ['sve-003', 'sve-003', 'sve-003']).map(c => ({ ...c, faceUp: false })) }),
      B: player({
        active: mon('b0', klefkiActive ? KLEFKI : GOTHITA), bench: [mon('b1', klefkiActive ? GOTHITA : KLEFKI)],
        deck: cards('bd', deck), prizes: cards('bp', ['sve-003', 'sve-003', 'sve-003']).map(c => ({ ...c, faceUp: false })),
      }),
    },
  } as NeutralState;
}
const bench = { actor: 'A', type: 'benchBasic', card: 'ah0' } as never;
const yes = { actor: 'A', type: 'confirm', value: true } as never;

function offersConfirm(r: ReturnType<typeof step>): boolean {
  return (r.pending?.legalActions ?? []).some(a => a.type === 'confirm');
}

describe('TA-737 bench-entry Abilities obey Ability locks', () => {
  it('[TA-737 tef-025] Iron Leaves ex benched under Klefki: Rapid Vernier is not offered', () => {
    const r = step(board('tef-025', true), [bench]);
    expect(r.status).toBe('awaitingAction');
    expect(offersConfirm(r)).toBe(false);
    expect(r.state.players.A.bench.map(p => p.stack[0].printing)).toEqual(['tef-025']);
  });
  it('[TA-737 tef-025 control] Klefki on the Bench: Rapid Vernier is offered and switches', () => {
    const r = step(board('tef-025', false), [bench, yes]);
    expect(r.state.players.A.active!.stack[0].printing).toBe('tef-025');
  });
  it('[TA-737 por-062] Meowth ex benched under Klefki: the Supporter search is not offered', () => {
    const r = step(board('por-062', true), [bench]);
    expect(offersConfirm(r)).toBe(false);
    expect(r.pending?.descriptor).toBe('main');
    expect(r.state.players.A.hand.length).toBe(0);
  });
  it('[TA-737 por-062 control] Klefki on the Bench: the search is offered', () => {
    const r = step(board('por-062', false), [bench]);
    expect(offersConfirm(r)).toBe(true);
  });
  it('[TA-737 gri-060] Tapu Lele-GX benched under Klefki: Wonder Tag is not offered (bug report board)', () => {
    const r = step(board('gri-060', true), [bench]);
    expect(offersConfirm(r)).toBe(false);
    expect(r.state.players.A.hand.length).toBe(0);
  });
  it('[TA-737 gri-060 control] Klefki on the Bench: Wonder Tag is offered', () => {
    const r = step(board('gri-060', false), [bench]);
    expect(offersConfirm(r)).toBe(true);
  });
});
