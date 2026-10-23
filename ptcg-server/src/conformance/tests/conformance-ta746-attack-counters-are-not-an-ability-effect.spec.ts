import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-746: damage counters an ATTACK places were treated as an effect of an Ability.
 *   Mega Clefable ex por-031 Luminous Wing: "Prevent all effects of your opponent's Pokémon's Abilities done to this
 *     Pokémon."
 *   Sinistcha pbl-006 Matcha Spin (attack): "If you have 6 or more Pokémon that have the Hide 'n' Sneak Ability in your
 *     discard pile, place 4 damage counters on each of your opponent's Pokémon."
 * Upstream's PREVENT_EFFECTS_OF_OPPONENTS_ABILITIES (2026-10-22 merge) counted every counter placement sourced from an
 * opposing Pokémon as an Ability's, so Luminous Wing stopped Matcha Spin. A placement is an Ability's when it names the
 * Ability (sourcePower), the rule the engine's own EffectOfAbilityEffect probe keeps. Control: Gengar ex tef-104
 * Gnawing Curse (an Ability) on Mega Clefable ex stays prevented.
 */

const CLEFABLE = 'por-031';
const GOTHITA = 'pal-090';
const FILL = 'sve-003';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function board(activePlayer: 'A' | 'B', a: Partial<PlayerState>, b: Partial<PlayerState>): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer, firstPlayer: 'B', phase: 'main', outcome: 'ongoing',
    stadium: null,
    players: {
      A: player({ deck: cards('ad', 6, FILL), prizes: cards('ap', 6, FILL).map(c => ({ ...c, faceUp: false })), ...a }),
      B: player({ deck: cards('bd', 6, FILL), prizes: cards('bp', 6, FILL).map(c => ({ ...c, faceUp: false })), ...b }),
    },
  } as NeutralState;
}

describe('TA-746 attack-placed damage counters are not an effect of an Ability', () => {
  it('[TA-746 pbl-006] Matcha Spin places 4 counters on Mega Clefable ex (Luminous Wing names Abilities only)', () => {
    const r = step(board('A',
      { active: mon('a0', 'pbl-006', [{ iid: 'ae0', printing: 'sve-001' }]), discard: cards('dis', 6, 'pbl-006') },
      { active: mon('b0', CLEFABLE), bench: [mon('b1', GOTHITA)] },
    ), [{ actor: 'A', type: 'declareAttack', source: 'a0', name: 'Matcha Spin' } as never]);
    expect(r.state.players.B.active!.damage).toBe(40);
    expect(r.state.players.B.bench[0].damage).toBe(40);
  });

  it('[TA-746 tef-104 control] Gnawing Curse (an Ability) on Mega Clefable ex stays prevented', () => {
    const attach = (target: string) => step(board('B',
      { active: mon('a0', 'tef-104') },
      { active: mon('b0', target), hand: [{ iid: 'bh0', printing: 'sve-005' }] },
    ), [{ actor: 'B', type: 'attachEnergy', card: 'bh0', target: 'b0' } as never]);
    expect(attach(CLEFABLE).state.players.B.active!.damage).toBe(0);
    expect(attach(GOTHITA).state.players.B.active!.damage).toBe(20);
  });
});
