import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-749 — Knock Off asc-134 ("Discard a random card from your opponent's hand.") and Astonish pfl-078 / twm-051
 * ("Choose a random card from your opponent's hand. Your opponent reveals that card and shuffles it into their deck.")
 * picked the card with an inline Math.random: no system pick was pending, so the same replay discarded or shuffled a
 * different card, and all three sat in EXCLUDED_RANDOM_CARDS (B.12).
 *
 * Tyranitar ex pre-064's shape: the random card is a secret ChooseCardsPrompt, which the adapter raises as a `system`
 * pick; the replay supplies it. Mutation guard: restore the Math.random pick on any card → its test sees no system
 * pending (the step goes straight to B's main).
 */

const WATER = 'sve-003', DARK = 'sve-007', FILLER = 'pal-090';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function pip(stack: CardRef[], energy: CardRef[] = []): PokemonInPlay {
  return { stack, energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(tag: string, over: Partial<PlayerState>): PlayerState {
  return {
    active: null, bench: [], hand: [], discard: [], lostZone: [],
    deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: WATER })),
    prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false })),
    flags: flags(), ...over,
  };
}
function board(attacker: string, energy: string[]): NeutralState {
  const A = player('a', { active: pip([{ iid: 'a1s0', printing: attacker }], energy.map((p, i) => ({ iid: `a1e${i}`, printing: p }))) });
  const B = player('b', {
    active: pip([{ iid: 'b1s0', printing: FILLER }]),
    hand: [{ iid: 'bh2', printing: WATER }, { iid: 'bh3', printing: DARK }],
  });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B },
  };
}
const attack = (name: string): NeutralAction => ({ actor: 'A', type: 'declareAttack', source: 'a1s0', name } as unknown as NeutralAction);
const pick = (target: string): NeutralAction => ({ actor: 'system', type: 'pick', target } as unknown as NeutralAction);
type La = { actor?: string; type: string; target?: string };
const offered = (r: ReturnType<typeof step>): string[] =>
  ((r.pending?.legalActions ?? []) as unknown as La[]).map(a => `${a.type}:${a.target}`).sort();
const iids = (cs: CardRef[]): string[] => cs.map(c => c.iid).sort();

describe('TA-749 — a random card from the opponent\'s hand is a system pick', () => {
  const cases: Array<[string, string, string, string[], 'discard' | 'deck']> = [
    ['Knock Off [TA-749 asc-134]', 'asc-134', 'Knock Off', [DARK, WATER], 'discard'],
    ['Astonish (Aipom) [TA-749 pfl-078]', 'pfl-078', 'Astonish', [WATER, WATER], 'deck'],
    ['Astonish (Snorunt) [TA-749 twm-051]', 'twm-051', 'Astonish', [WATER, WATER], 'deck'],
  ];
  for (const [label, printing, name, energy, to] of cases) {
    it(`${label} ${printing}: the attack pends a system pick over the two hand cards`, () => {
      const r = step(board(printing, energy), [attack(name)]);
      expect(r.pending?.actor).toBe('system');
      expect(offered(r)).toEqual(['pick:bh2', 'pick:bh3']);
    });
    it(`${label} ${printing}: the supplied pick decides the card, every time`, () => {
      for (const target of ['bh2', 'bh3']) {
        const r = step(board(printing, energy), [attack(name), pick(target)]);
        const B = r.state.players.B;
        // B has since drawn for its turn, so the hand holds the other card plus one from the deck.
        const other = target === 'bh2' ? 'bh3' : 'bh2';
        expect(B.hand.map(c => c.iid)).toContain(other);
        expect(B.hand.map(c => c.iid)).not.toContain(target);
        if (to === 'discard') {
          expect(iids(B.discard)).toEqual([target]);
        } else {
          expect(iids(B.discard)).toEqual([]);
          expect(B.deck.map(c => c.iid)).toContain(target);
        }
      }
    });
  }
});
