import { Card, State, StateUtils, StoreLike } from '../..';
import { PokemonCard } from '../card/pokemon-card';
import { AttackEffect } from '../effects/game-effects';
import { SHOW_CARDS_TO_PLAYER, SHUFFLE_DECK } from './prefabs';

// =============================================================================
// Bug Out constants
// =============================================================================

export const BUG_OUT_ATTACK_NAME = 'Bug Out';

const BUG_OUT_REVEAL_COUNT = 7;

const BUG_OUT_DAMAGE_PER_POKEMON = 50;

// =============================================================================
// Bug Out helpers
// =============================================================================

function revealBottomDeckCards(deck: { cards: Card[] }, count: number): Card[] {
  const revealCount = Math.min(count, deck.cards.length);
  const revealed: Card[] = [];

  for (let i = 0; i < revealCount; i++) {
    const card = deck.cards.pop();
    if (card !== undefined) {
      revealed.push(card);
    }
  }

  return revealed;
}

function hasAttackNamed(card: Card, attackName: string): boolean {
  return card instanceof PokemonCard && card.attacks.some(attack => attack.name === attackName);
}

// =============================================================================
// Bug Out attack
// =============================================================================

/**
 * Reveal the bottom 7 cards of your deck. This attack does 50 damage for each Pokémon
 * revealed that has the Bug Out attack. Every revealed Pokémon is shuffled back into the
 * deck; the other revealed cards are discarded.
 */
export function BUG_OUT(
  store: StoreLike,
  state: State,
  effect: AttackEffect,
): void {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);
  const revealed = revealBottomDeckCards(player.deck, BUG_OUT_REVEAL_COUNT);

  // TA-397(a): ONE reveal. Showing the same cards to each player separately emitted the `reveal`
  // twice; a reveal is to the opponent (the player is looking at their own cards).
  SHOW_CARDS_TO_PLAYER(store, state, opponent, revealed);

  const bugOutPokemon = revealed.filter(card => hasAttackNamed(card, BUG_OUT_ATTACK_NAME));

  effect.damage = BUG_OUT_DAMAGE_PER_POKEMON * bugOutPokemon.length;

  // TA-557: "Then, shuffle any revealed Pokémon back into your deck. Discard the other cards." EVERY revealed
  // Pokémon goes back, whether or not it has Bug Out (only the damage counts Bug Out); only non-Pokémon are discarded.
  const revealedPokemon = revealed.filter(card => card instanceof PokemonCard);
  revealedPokemon.forEach(card => player.deck.cards.push(card));
  revealed
    .filter(card => !revealedPokemon.includes(card))
    .forEach(card => player.discard.cards.push(card));
  // TA-397(a): the shuffle's object is the set of revealed Pokemon; with none revealed there is nothing to
  // shuffle back (§B.33 row 2, #1979).
  if (revealedPokemon.length > 0) {
    SHUFFLE_DECK(store, state, player);
  }
}

