import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack } from './card-test-helpers';

// Prize count on KO reads the base-class `Card.tags` (game-effect.ts gameReducer, KnockOutEffect: an
// `ex`/V/GX tag => +1 prize). A Pokémon carrying its rule-box marker on the LEGACY `PokemonCard.cardTag`
// field (Excadrill ex blk-046), or omitting it entirely (Oricorio ex pfl-018), therefore reads as a
// NON-ex and gives up only 1 prize instead of 2 — a real, game-deciding bug surfaced by the CF-30
// card-data corroboration (`tags` on /v1/cards vs card-data/final: both were canonical-only `['ex']`).
//
// Repro: player1 KOs a pre-damaged ex; player1 must take TWO prizes (6 -> 4 non-empty piles). Pre-fix
// this took 1 (5 remained). player2 keeps a bench so the KO is non-terminal and prize logic runs.
beforeAll(() => { loadAllSets(); });

function prizesTakenKoingEx(exCard: string, hp: number): number {
  const game = setupGame({
    turn: 2,
    player1: {
      active: { card: 'Raichu SIT', energy: ['Lightning Energy SVE'] }, // "Ambushing Spark" 40 for 1 [L]
      deck: padDeck(10),
    },
    player2: {
      active: { card: exCard, damage: hp - 10 },     // 10 HP left -> the 40 lands lethal, any type
      bench: [{ card: 'Rufflet SIT' }],              // a bench to promote -> non-terminal KO
      deck: padDeck(10),
    },
  });
  useAttack(game.store, game.state, 0, 'Ambushing Spark');
  const remaining = game.player1.prizes.filter(p => p.cards.length > 0).length;
  return 6 - remaining;
}

describe('CF-30 — a rule-box ex gives up 2 prizes on KO (tag on the field the reducer reads)', () => {
  it('Excadrill ex (blk-046) — marker was on legacy cardTag', () => {
    expect(prizesTakenKoingEx('Excadrill ex SV11B', 270)).toBe(2);
  });
  it('Oricorio ex (pfl-018) — marker was missing entirely', () => {
    expect(prizesTakenKoingEx('Oricorio ex M2', 190)).toBe(2);
  });
});
