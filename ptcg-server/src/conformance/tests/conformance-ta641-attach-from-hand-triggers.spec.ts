import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION, StadiumRef,
} from '../neutral-types';

/**
 * TA-641: triggers printed "attaches an Energy card from (your / their) hand" fired on an attach from any zone.
 *   Gengar ex tef-104 Gnawing Curse: "Whenever your opponent attaches an Energy card from their hand to 1 of their
 *     Pokémon, put 2 damage counters on that Pokémon."
 *   Magearna jtg-107 Auto Heal: "As long as this Pokémon is in the Active Spot, whenever you attach an Energy card from
 *     your hand to 1 of your Pokémon, heal 90 damage from that Pokémon."
 *   Minun par-061 Buddy Pulse: "If you have Plusle in play, whenever your opponent attaches an Energy card from their
 *     hand to 1 of their Pokémon, put 2 damage counters on that Pokémon. The effect of Buddy Pulse doesn't stack."
 *   Calamitous Snowy Mountain pal-174: "Whenever any player attaches an Energy card from their hand to 1 of their Basic
 *     non-[Water] Pokémon, put 2 damage counters on that Pokémon."
 * The non-hand attach is Eelektrik asc-060 Dynamotor ("attach a Basic [Lightning] Energy card from your discard pile to
 * 1 of your Benched Pokémon"); each board has one Lightning in the discard and one Benched Pokémon, so it resolves with
 * no pick. Each control attaches the same Energy from the hand to the same Pokémon.
 */

const LIGHTNING = 'sve-004';
const METAL = 'sve-008';
const EELEKTRIK = 'asc-060';
const PLUSLE = 'par-060';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string, damage = 0): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, METAL).map(c => ({ ...c, faceUp: false }));
}
interface Board { aActive: PokemonInPlay; aBench: PokemonInPlay; bActive: string; bBench?: string[]; stadium?: StadiumRef | null }
/** A holds one Basic Lightning in the hand (ah0) and one in the discard (ax0). */
function board(b: Board): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing',
    stadium: b.stadium ?? null,
    players: {
      A: player({
        active: b.aActive, bench: [b.aBench], hand: [{ iid: 'ah0', printing: LIGHTNING }],
        discard: [{ iid: 'ax0', printing: LIGHTNING }], deck: cards('ad', 6, METAL), prizes: prizes('ap', 6),
      }),
      B: player({
        active: mon('b1', b.bActive), bench: (b.bBench ?? []).map((p, i) => mon(`bb${i + 1}`, p)),
        deck: cards('bd', 6, METAL), prizes: prizes('bp', 6),
      }),
    },
  };
}
const dynamotor = (source: string) => ({ actor: 'A', type: 'useAbility', source, ability: 'Dynamotor' } as never);
const fromHand = { actor: 'A', type: 'attachEnergy', card: 'ah0', target: 'a2' } as never;

describe('TA-641: "attaches an Energy card from (your / their) hand" triggers need an attach from the hand', () => {
  // ------------------------------------------------------------------ Gengar ex
  const gengar = () => board({ aActive: mon('a1', EELEKTRIK), aBench: mon('a2', EELEKTRIK), bActive: 'tef-104' });

  it('Dynamotor attaches from the discard while B\'s Gengar ex is Active: no Gnawing Curse counters [TA-641 tef-104]', () => {
    const r = step(gengar(), [dynamotor('a1')]);
    expect(r.state.players.A.bench[0].energy.map(c => c.iid)).toEqual(['ax0']);
    expect(r.state.players.A.bench[0].damage).toBe(0);
  });

  it('control: attaching the Energy from the hand still puts 2 counters on it [TA-641 tef-104]', () => {
    const r = step(gengar(), [fromHand]);
    expect(r.state.players.A.bench[0].energy.map(c => c.iid)).toEqual(['ah0']);
    expect(r.state.players.A.bench[0].damage).toBe(20);
  });

  // ------------------------------------------------------------------ Magearna
  const magearna = () => board({ aActive: mon('a1', 'jtg-107'), aBench: mon('a2', EELEKTRIK, 30), bActive: PLUSLE });

  it('Dynamotor attaches from the discard while Magearna is Active: no Auto Heal [TA-641 jtg-107]', () => {
    const r = step(magearna(), [dynamotor('a2')]);
    expect(r.state.players.A.bench[0].energy.map(c => c.iid)).toEqual(['ax0']);
    expect(r.state.players.A.bench[0].damage).toBe(30);
  });

  it('control: attaching the Energy from the hand still heals it [TA-641 jtg-107]', () => {
    const r = step(magearna(), [fromHand]);
    expect(r.state.players.A.bench[0].energy.map(c => c.iid)).toEqual(['ah0']);
    expect(r.state.players.A.bench[0].damage).toBe(0);
  });

  // ------------------------------------------------------------------ Minun
  const minun = () => board({ aActive: mon('a1', EELEKTRIK), aBench: mon('a2', PLUSLE), bActive: 'par-061', bBench: [PLUSLE] });

  it('Dynamotor attaches from the discard while B has Minun and Plusle: no Buddy Pulse counters [TA-641 par-061]', () => {
    const r = step(minun(), [dynamotor('a1')]);
    expect(r.state.players.A.bench[0].energy.map(c => c.iid)).toEqual(['ax0']);
    expect(r.state.players.A.bench[0].damage).toBe(0);
  });

  it('control: attaching the Energy from the hand still puts 2 counters on it [TA-641 par-061]', () => {
    const r = step(minun(), [fromHand]);
    expect(r.state.players.A.bench[0].energy.map(c => c.iid)).toEqual(['ah0']);
    expect(r.state.players.A.bench[0].damage).toBe(20);
  });

  // ------------------------------------------------------------------ Calamitous Snowy Mountain
  const mountain = () => board({
    aActive: mon('a1', EELEKTRIK), aBench: mon('a2', PLUSLE), bActive: PLUSLE,
    stadium: { iid: 'st0', printing: 'pal-174', owner: 'B' },
  });

  it('Dynamotor attaches from the discard to a Basic Plusle under Calamitous Snowy Mountain: no counters [TA-641 pal-174]', () => {
    const r = step(mountain(), [dynamotor('a1')]);
    expect(r.state.players.A.bench[0].energy.map(c => c.iid)).toEqual(['ax0']);
    expect(r.state.players.A.bench[0].damage).toBe(0);
  });

  it('control: attaching the Energy from the hand still puts 2 counters on it [TA-641 pal-174]', () => {
    const r = step(mountain(), [fromHand]);
    expect(r.state.players.A.bench[0].energy.map(c => c.iid)).toEqual(['ah0']);
    expect(r.state.players.A.bench[0].damage).toBe(20);
  });
});
