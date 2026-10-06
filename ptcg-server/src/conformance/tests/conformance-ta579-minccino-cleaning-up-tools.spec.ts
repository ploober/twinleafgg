import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-579: Minccino tef-136 / tef-182 "Cleaning Up" — printed text (minccino.ts): "Discard up to 2 Pokémon Tools from
 * your opponent's Pokémon." The objects chosen are the Tools themselves, up to 2 in total, from any of the opponent's
 * Pokémon (both may come off one Pokémon). The card picked up to 2 BEARERS, then raised a ChooseCardsPrompt per bearer
 * inside a forEach with no yield (over the bearer's whole card list), so a bearer with 2 Tools lost nothing.
 * Rotomancer offers one `discard {tool}` per Tool plus `confirm:false`, and stops after 2; this spec pins that shape.
 *
 * Boards: B Active Rotom ex pfl-029 (Multi Adapter: 2 Tools) and B Bench svi-070, as in
 * docs/side-observations-step3-20261001/boards/w3/I-minccino.json.
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
/** `activeTools` / `benchTools`: printings of the Tools on B's Active (Rotom ex) and B's Bench Pokémon. */
function board(minccino: string, activeTools: string[], benchTools: string[]): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: mon('a1', minccino, cards('ae', 2, ENERGY), []), deck: cards('ad', 8, ENERGY), prizes: prizes('ap', 6) }),
      B: player({
        active: mon('b1', 'pfl-029', [{ iid: 'be0', printing: 'sve-004' }], activeTools.map((p, i) => ({ iid: `b1t${i}`, printing: p }))),
        bench: [mon('bb1', 'svi-070', [], benchTools.map((p, i) => ({ iid: `bb1t${i}`, printing: p })))],
        deck: cards('bd', 8, ENERGY), prizes: prizes('bp', 6),
      }),
    },
  } as NeutralState;
}

const attack = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Cleaning Up' } as never;
const discard = (target: string) => ({ actor: 'A', type: 'discard', target, owner: 'B' } as never);
const stop = { actor: 'A', type: 'confirm', value: false } as never;
const offered = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? [])
  .map(a => a.type === 'discard' ? `discard:${(a as { target?: string }).target}` : a.type === 'confirm' ? 'confirm' : a.type).sort();
const toolsOf = (r: ReturnType<typeof step>) => ({
  active: r.state.players.B.active?.tools.map(t => t.iid) ?? [],
  bench: r.state.players.B.bench[0]?.tools.map(t => t.iid) ?? [],
  discard: r.state.players.B.discard.map(c => c.iid).sort(),
});

const TWO_EACH: [string[], string[]] = [['svi-193', 'svi-197'], ['svi-169', 'svi-174']];

for (const minccino of ['tef-136', 'tef-182']) {
  describe(`TA-579: Minccino ${minccino} Cleaning Up discards up to 2 Tools, chosen as Tools`, () => {
    it('two Tools on each Pokémon: every Tool is offered, plus the stop [TA-579]', () => {
      const r = step(board(minccino, ...TWO_EACH), [attack]);
      expect(r.pending?.actor).toBe('A');
      expect(offered(r)).toEqual(['confirm', 'discard:b1t0', 'discard:b1t1', 'discard:bb1t0', 'discard:bb1t1']);
    });

    it('both Tools off the Active: discarded, the Bench keeps its 2, the turn ends [TA-579]', () => {
      const mid = step(board(minccino, ...TWO_EACH), [attack, discard('b1t0')]);
      expect(offered(mid)).toEqual(['confirm', 'discard:b1t1', 'discard:bb1t0', 'discard:bb1t1']);
      const r = step(board(minccino, ...TWO_EACH), [attack, discard('b1t0'), discard('b1t1')]);
      expect(toolsOf(r)).toEqual({ active: [], bench: ['bb1t0', 'bb1t1'], discard: ['b1t0', 'b1t1'] });
      expect(r.state.activePlayer).toBe('B');
    });

    it('one Tool off each Pokémon [TA-579]', () => {
      const r = step(board(minccino, ...TWO_EACH), [attack, discard('b1t1'), discard('bb1t0')]);
      expect(toolsOf(r)).toEqual({ active: ['b1t0'], bench: ['bb1t1'], discard: ['b1t1', 'bb1t0'] });
      expect(r.state.activePlayer).toBe('B');
    });

    it('one Tool then stop: only that Tool is discarded [TA-579]', () => {
      const r = step(board(minccino, ...TWO_EACH), [attack, discard('bb1t1'), stop]);
      expect(toolsOf(r)).toEqual({ active: ['b1t0', 'b1t1'], bench: ['bb1t0'], discard: ['bb1t1'] });
    });

    it('stop at once ("up to"): nothing is discarded [TA-579]', () => {
      const r = step(board(minccino, ...TWO_EACH), [attack, stop]);
      expect(toolsOf(r)).toEqual({ active: ['b1t0', 'b1t1'], bench: ['bb1t0', 'bb1t1'], discard: [] });
      expect(r.state.activePlayer).toBe('B');
    });

    it('control, one Tool on each Pokémon: both offered, both discarded [TA-579]', () => {
      const b = board(minccino, ['svi-193'], ['svi-169']);
      expect(offered(step(b, [attack]))).toEqual(['confirm', 'discard:b1t0', 'discard:bb1t0']);
      expect(toolsOf(step(b, [attack, discard('b1t0'), discard('bb1t0')]))).toEqual({ active: [], bench: [], discard: ['b1t0', 'bb1t0'] });
    });
  });
}
