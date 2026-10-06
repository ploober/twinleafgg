import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-612 / B.52: the triggers one Energy attach raises are one simultaneous batch, and the CURRENT player orders it
 * ("During a turn, the current player can choose the order of multiple triggered effects when ... an energy is
 * attached"). Magearna jtg-107 Auto Heal ("Whenever you attach an Energy card from your hand to this Pokémon, heal 90
 * damage from it") and Gengar ex tef-104 Gnawing Curse ("Whenever your opponent attaches an Energy card from their
 * hand to 1 of their Pokémon, put 2 damage counters on that Pokémon") both trigger on A's attach to Magearna.
 * Twinleaf resolved them in card order with no decision (heal first: 20). One trigger alone is not a decision (B.49).
 */

const METAL = 'sve-008';

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
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, METAL).map(c => ({ ...c, faceUp: false }));
}
function board(aActive: string, bActive: string, bBench: string[] = [], energy = METAL): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: mon('a1', aActive), hand: [{ iid: 'ah0', printing: energy }], deck: cards('ad', 6, METAL), prizes: prizes('ap', 6) }),
      B: player({ active: mon('b1', bActive), bench: bBench.map((p, i) => mon(`bb${i + 1}`, p)), deck: cards('bd', 6, METAL), prizes: prizes('bp', 6) }),
    },
  };
}

const attach = { actor: 'A', type: 'attachEnergy', card: 'ah0', target: 'a1' } as never;
const next = (source: string, ability: string) =>
  ({ actor: 'A', type: 'resolveNext', source, subject: 'a1', ability, kind: 'abilityEffect' } as never);
const heal = next('a1', 'Auto Heal');
const curse = (src: string) => next(src, 'Gnawing Curse');
const nextSources = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? [])
  .filter(a => a.type === 'resolveNext').map(a => (a as { source?: string }).source).sort();

describe('TA-612: the Energy-attach window asks the current player to order its triggers (B.52)', () => {
  it('Auto Heal + Gnawing Curse: A is asked, with nothing applied yet [TA-612]', () => {
    const r = step(board('jtg-107', 'tef-104'), [attach]);
    expect(r.pending?.actor).toBe('A');
    expect(nextSources(r)).toEqual(['a1', 'b1']);
    expect(r.state.players.A.active?.damage).toBe(0);
    expect(r.state.players.A.active?.energy.map(c => c.iid)).toEqual(['ah0']);
  });

  it('Curse first, then Heal: Magearna ends at 0 [TA-612]', () => {
    expect(step(board('jtg-107', 'tef-104'), [attach, curse('b1')]).state.players.A.active?.damage).toBe(0);
  });

  it('Heal first, then Curse: Magearna ends at 20 [TA-612]', () => {
    expect(step(board('jtg-107', 'tef-104'), [attach, heal]).state.players.A.active?.damage).toBe(20);
  });

  it('two Gengar ex: three candidates; Curse, Heal, then the forced Curse ends at 20 [TA-612]', () => {
    const b = board('jtg-107', 'tef-104', ['tef-104']);
    expect(nextSources(step(b, [attach]))).toEqual(['a1', 'b1', 'bb1']);
    const r = step(b, [attach, curse('b1'), heal]);
    expect(r.state.players.A.active?.damage).toBe(20);
    expect(r.pending?.legalActions.some(a => a.type === 'resolveNext')).toBe(false);
  });

  it('control: Gnawing Curse alone is not a decision: 20 at once [TA-612]', () => {
    const r = step(board('asc-061', 'tef-104'), [attach]);
    expect(nextSources(r)).toEqual([]);
    expect(r.state.players.A.active?.damage).toBe(20);
  });

  it('control: Auto Heal alone is not a decision [TA-612]', () => {
    const r = step(board('jtg-107', 'asc-061'), [attach]);
    expect(nextSources(r)).toEqual([]);
    expect(r.state.players.A.active?.energy.map(c => c.iid)).toEqual(['ah0']);
  });

  it('Rich Energy ssp-191 (its own "when you attach this card" draw) + Gnawing Curse: both are candidates [TA-612]', () => {
    const b = board('asc-061', 'tef-104', [], 'ssp-191');
    const r = step(b, [attach]);
    expect(nextSources(r)).toEqual(['ah0', 'b1']);
    expect(r.state.players.A.hand.length).toBe(0);
    const rich = (r.pending?.legalActions ?? []).find(x => x.type === 'resolveNext' && (x as { source?: string }).source === 'ah0');
    expect(rich).toBeDefined();
    const done = step(b, [attach, rich as never]);
    expect(done.state.players.A.hand.length).toBe(4);
    expect(done.state.players.A.active?.damage).toBe(20);
  });

  it('control: Rich Energy alone is not a decision: it draws 4 at once [TA-612]', () => {
    const r = step(board('asc-061', 'asc-061', [], 'ssp-191'), [attach]);
    expect(nextSources(r)).toEqual([]);
    expect(r.state.players.A.hand.length).toBe(4);
  });

  it('control: Telepath Psychic Energy por-088 on a non-Psychic Pokemon (only its lock test runs) adds no candidate [TA-612]', () => {
    const r = step(board('asc-061', 'tef-104', [], 'por-088'), [attach]);
    expect(nextSources(r)).toEqual([]);
    expect(r.state.players.A.active?.damage).toBe(20);
  });
});
