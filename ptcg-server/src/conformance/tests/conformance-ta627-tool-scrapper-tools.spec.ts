import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-627: Tool Scrapper (class in set-dragons-exalted/tool-scrapper.ts; asc-212, wht-085, cri-115 and the RCL prints
 * inherit it). Printed text: "Choose up to 2 Pokémon Tools attached to Pokémon (yours or your opponent's) and discard
 * them." The objects chosen are the Tools themselves, up to 2 in total, from any Pokémon in play on either side (both
 * may come off one Pokémon). The card picked up to 2 BEARERS and discarded tools[0] of each, so the second Tool on a
 * Pokémon could not be chosen and 2 could not come off one Pokémon (the TA-579 Minccino shape).
 *
 * "Up to" on a Trainer is 1..2 (compendium #2301, B.18): the first pick has no stop, the second has one. Rotomancer
 * 766f5b3e7 offers one `discard {tool}` per Tool (owner = the Tool's side) and adds `confirm` after the first pick.
 * With no Tool in play the card is not playable (TA-118 / RE-57).
 */

const ENERGY = 'sve-003';
function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, ENERGY).map(c => ({ ...c, faceUp: false }));
}
function mon(iid: string, printing: string, energy: CardRef[], tools: CardRef[]): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools, damage: 0, conditions: [], markers: markers() };
}
/** A holds Tool Scrapper `scrapper` (ah0); `ownTools` on A's Active; B Active Rotom ex pfl-029 / B Bench svi-070 Tools. */
function board(scrapper: string, ownTools: string[], activeTools: string[], benchTools: string[]): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon('a1', 'tef-136', cards('ae', 2, ENERGY), ownTools.map((p, i) => ({ iid: `a1t${i}`, printing: p }))),
        hand: [{ iid: 'ah0', printing: scrapper }],
        deck: cards('ad', 8, ENERGY), prizes: prizes('ap', 6),
      }),
      B: player({
        active: mon('b1', 'pfl-029', [{ iid: 'be0', printing: 'sve-004' }], activeTools.map((p, i) => ({ iid: `b1t${i}`, printing: p }))),
        bench: [mon('bb1', 'svi-070', [], benchTools.map((p, i) => ({ iid: `bb1t${i}`, printing: p })))],
        deck: cards('bd', 8, ENERGY), prizes: prizes('bp', 6),
      }),
    },
  } as NeutralState;
}

const play = { actor: 'A', type: 'playItem', card: 'ah0' } as never;
const discard = (target: string, owner: 'A' | 'B' = 'B') => ({ actor: 'A', type: 'discard', target, owner } as never);
const stop = { actor: 'A', type: 'confirm', value: false } as never;
const offered = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? [])
  .map(a => a.type === 'discard' ? `discard:${(a as { target?: string }).target}` : a.type === 'confirm' ? 'confirm' : a.type).sort();
const toolsOf = (r: ReturnType<typeof step>) => ({
  own: r.state.players.A.active?.tools.map(t => t.iid) ?? [],
  active: r.state.players.B.active?.tools.map(t => t.iid) ?? [],
  bench: r.state.players.B.bench[0]?.tools.map(t => t.iid) ?? [],
  discardA: r.state.players.A.discard.map(c => c.iid).sort(),
  discardB: r.state.players.B.discard.map(c => c.iid).sort(),
});

const TWO_EACH: [string[], string[]] = [['svi-193', 'svi-197'], ['svi-169', 'svi-174']];

for (const scrapper of ['asc-212', 'wht-085', 'cri-115']) {
  describe(`TA-627: Tool Scrapper ${scrapper} discards up to 2 Tools, chosen as Tools, from either side`, () => {
    it('every Tool on both sides is offered at the first pick, with no stop (Trainer "up to" = 1..2) [TA-627]', () => {
      const r = step(board(scrapper, ['svi-174'], ...TWO_EACH), [play]);
      expect(r.pending?.actor).toBe('A');
      expect(offered(r)).toEqual(['discard:a1t0', 'discard:b1t0', 'discard:b1t1', 'discard:bb1t0', 'discard:bb1t1']);
    });

    it('both Tools off the opponent\'s Active: discarded, the rest kept, Tool Scrapper discarded [TA-627]', () => {
      const mid = step(board(scrapper, ['svi-174'], ...TWO_EACH), [play, discard('b1t0')]);
      expect(offered(mid)).toEqual(['confirm', 'discard:a1t0', 'discard:b1t1', 'discard:bb1t0', 'discard:bb1t1']);
      const r = step(board(scrapper, ['svi-174'], ...TWO_EACH), [play, discard('b1t0'), discard('b1t1')]);
      expect(toolsOf(r)).toEqual({ own: ['a1t0'], active: [], bench: ['bb1t0', 'bb1t1'], discardA: ['ah0'], discardB: ['b1t0', 'b1t1'] });
      expect(r.pending?.actor).toBe('A');
      expect(r.state.activePlayer).toBe('A');
    });

    it('one of yours and one of the opponent\'s: each goes to its owner\'s discard pile [TA-627]', () => {
      const r = step(board(scrapper, ['svi-174'], ...TWO_EACH), [play, discard('a1t0', 'A'), discard('bb1t1')]);
      expect(toolsOf(r)).toEqual({ own: [], active: ['b1t0', 'b1t1'], bench: ['bb1t0'], discardA: ['a1t0', 'ah0'], discardB: ['bb1t1'] });
    });

    it('one Tool then stop: only that Tool is discarded [TA-627]', () => {
      const r = step(board(scrapper, ['svi-174'], ...TWO_EACH), [play, discard('b1t1'), stop]);
      expect(toolsOf(r)).toEqual({ own: ['a1t0'], active: ['b1t0'], bench: ['bb1t0', 'bb1t1'], discardA: ['ah0'], discardB: ['b1t1'] });
    });

    it('control, a single Tool in play (yours): the forced pick collapses (CF-14) and it is discarded [TA-627]', () => {
      const r = step(board(scrapper, ['svi-174'], [], []), [play]);
      expect(offered(r)).not.toContain('discard:a1t0');
      expect(toolsOf(r)).toEqual({ own: [], active: [], bench: [], discardA: ['a1t0', 'ah0'], discardB: [] });
    });

    it('control, no Tool in play: Tool Scrapper is not offered (TA-118) [TA-627]', () => {
      const r = step(board(scrapper, [], [], []), []);
      expect((r.pending?.legalActions ?? []).some(a => a.type === 'playItem')).toBe(false);
    });
  });
}
