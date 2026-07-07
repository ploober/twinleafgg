import { Store } from '../../game/store/store';
import { State } from '../../game/store/state/state';
import { PokemonCard } from '../../game/store/card/pokemon-card';
import { PokemonCardList } from '../../game/store/state/pokemon-card-list';
import { CardList } from '../../game/store/state/card-list';
import { SpecialCondition } from '../../game/store/card/card-types';
import { GameWinner } from '../../game/store/state/state';
import { AttackAction, PassTurnAction, RetreatStartAction, UseAbilityAction, RetreatAction } from '../../game/store/actions/game-actions';
import { PlayCardAction, PlayerType, SlotType, CardTarget } from '../../game/store/actions/play-card-action';
import { Card } from '../../game/store/card/card';
import { AttackEffect } from '../../game/store/effects/game-effects';
import { DealDamageEffect, PutDamageEffect } from '../../game/store/effects/attack-effects';
import { SetupGameResult } from './test-helpers';

// ── Action helpers ──

export function useAttack(store: Store, state: State, playerIndex: number, attackName: string): void {
  const player = state.players[playerIndex];
  store.dispatch(new AttackAction(player.id, attackName));
}

export function useAbility(store: Store, state: State, playerIndex: number, abilityName: string): void {
  const player = state.players[playerIndex];

  // Search active and bench for the card with this ability
  let foundTarget: CardTarget | undefined;

  const pokemonCard = player.active.getPokemonCard();
  if (pokemonCard && pokemonCard.powers.some(p => p.name === abilityName)) {
    foundTarget = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
  }

  if (!foundTarget) {
    for (let i = 0; i < player.bench.length; i++) {
      const benchPokemon = player.bench[i].getPokemonCard();
      if (benchPokemon && benchPokemon.powers.some(p => p.name === abilityName)) {
        foundTarget = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: i };
        break;
      }
    }
  }

  if (!foundTarget) {
    throw new Error(`No Pokemon with ability "${abilityName}" found for player ${playerIndex}`);
  }

  store.dispatch(new UseAbilityAction(player.id, abilityName, foundTarget));
}

export function endTurn(store: Store, state: State): void {
  const player = state.players[state.activePlayer];
  store.dispatch(new PassTurnAction(player.id));
}

export function retreatStart(store: Store, state: State, playerIndex: number): void {
  const player = state.players[playerIndex];
  store.dispatch(new RetreatStartAction(player.id));
}

export function playTrainerCard(store: Store, state: State, playerIndex: number, cardFullName: string): void {
  const player = state.players[playerIndex];
  const handIndex = player.hand.cards.findIndex(c => c.fullName === cardFullName);
  if (handIndex === -1) {
    throw new Error(`Card "${cardFullName}" not found in player ${playerIndex}'s hand`);
  }
  const target: CardTarget = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
  store.dispatch(new PlayCardAction(player.id, handIndex, target));
}

/**
 * Plays a card from hand onto a target slot — the general form behind trainers, energy
 * attachment, evolution, and benching a Basic. Target defaults to the player's own active.
 */
export function playCardFromHand(
  store: Store, state: State, playerIndex: number, cardFullName: string, target?: CardTarget
): void {
  const player = state.players[playerIndex];
  const handIndex = player.hand.cards.findIndex(c => c.fullName === cardFullName);
  if (handIndex === -1) {
    throw new Error(`Card "${cardFullName}" not found in player ${playerIndex}'s hand`);
  }
  const slot = target ?? { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
  store.dispatch(new PlayCardAction(player.id, handIndex, slot));
}

export function retreat(store: Store, state: State, playerIndex: number, benchIndex: number): void {
  const player = state.players[playerIndex];
  store.dispatch(new RetreatAction(player.id, benchIndex));
}

// ── Reusable effect factories ──

export function createDamageEffect(
  game: SetupGameResult,
  attackerIndex: number,
  options?: { benchIndex?: number; damage?: number }
): PutDamageEffect {
  const attacker = game.state.players[attackerIndex];
  const defender = game.state.players[1 - attackerIndex];
  const damage = options?.damage ?? 30;
  const attack = { name: 'Test Attack', cost: [], damage, text: '' };
  const attackEffect = new AttackEffect(attacker, defender, attack);
  const putDamage = new PutDamageEffect(attackEffect, damage);
  if (options?.benchIndex !== undefined) {
    putDamage.target = defender.bench[options.benchIndex];
  }
  return putDamage;
}

export function createActiveDamageEffect(
  game: SetupGameResult,
  attackerIndex: number,
  options?: { damage?: number }
): DealDamageEffect {
  const attacker = game.state.players[attackerIndex];
  const defender = game.state.players[1 - attackerIndex];
  const damage = options?.damage ?? 30;
  const attack = { name: 'Test Attack', cost: [], damage, text: '' };
  const attackEffect = new AttackEffect(attacker, defender, attack);
  return new DealDamageEffect(attackEffect, damage);
}

export function createAttackEffect(
  game: SetupGameResult,
  attackerIndex: number,
  options?: { damage?: number }
): AttackEffect {
  const attacker = game.state.players[attackerIndex];
  const defender = game.state.players[1 - attackerIndex];
  const damage = options?.damage ?? 30;
  const attack = { name: 'Test Attack', cost: [], damage, text: '' };
  return new AttackEffect(attacker, defender, attack);
}

// ── Query helpers ──

function getSlot(state: State, playerIndex: number, slot?: 'active' | number): PokemonCardList {
  const player = state.players[playerIndex];
  if (slot === undefined || slot === 'active') {
    return player.active;
  }
  return player.bench[slot];
}

export function getDamage(state: State, playerIndex: number, slot?: 'active' | number): number {
  return getSlot(state, playerIndex, slot).damage;
}

export function getEnergyCount(state: State, playerIndex: number, slot?: 'active' | number): number {
  return getSlot(state, playerIndex, slot).energies.cards.length;
}

export type ZoneName = 'hand' | 'deck' | 'discard' | 'lostzone';

function getZoneCards(state: State, playerIndex: number, zone: ZoneName): Card[] {
  const player = state.players[playerIndex];
  switch (zone) {
    case 'hand': return player.hand.cards;
    case 'deck': return player.deck.cards;
    case 'discard': return player.discard.cards;
    case 'lostzone': return player.lostzone.cards;
  }
}

export function getZoneCount(state: State, playerIndex: number, zone: ZoneName): number {
  return getZoneCards(state, playerIndex, zone).length;
}

export function hasSpecialCondition(state: State, playerIndex: number, slot: 'active' | number | undefined, condition: SpecialCondition): boolean {
  return getSlot(state, playerIndex, slot).specialConditions.includes(condition);
}

export function zoneContains(state: State, playerIndex: number, zone: ZoneName, cardFullName: string): boolean {
  return getZoneCards(state, playerIndex, zone).some(c => c.fullName === cardFullName);
}

export function getActivePokemon(state: State, playerIndex: number): PokemonCard {
  const pokemonCard = state.players[playerIndex].active.getPokemonCard();
  if (!pokemonCard) {
    throw new Error(`No active Pokemon for player ${playerIndex}`);
  }
  return pokemonCard;
}

/** True while the player has a Pokémon in the active slot (false once it is knocked out and cleared). */
export function hasActivePokemon(state: State, playerIndex: number): boolean {
  return state.players[playerIndex].active.getPokemonCard() !== undefined;
}

/** Number of occupied bench slots. */
export function getBenchSize(state: State, playerIndex: number): number {
  return state.players[playerIndex].bench.filter(b => b.getPokemonCard() !== undefined).length;
}

export function getWinner(state: State): GameWinner {
  return state.winner;
}

export function isGameOver(state: State): boolean {
  return state.winner !== GameWinner.NONE;
}

// ── Zone / card-list access ──

/** The underlying CardList for a player zone, for reading card order or building effects. */
export function getZone(state: State, playerIndex: number, zone: ZoneName): CardList {
  const player = state.players[playerIndex];
  switch (zone) {
    case 'hand': return player.hand;
    case 'deck': return player.deck;
    case 'discard': return player.discard;
    case 'lostzone': return player.lostzone;
  }
}

/** Ordered card ids for a player zone (index 0 = top of pile for deck/discard). */
export function getZoneCardIds(state: State, playerIndex: number, zone: ZoneName): number[] {
  return getZone(state, playerIndex, zone).cards.map(c => c.id);
}

/** Ordered card ids for any CardList (e.g. one captured before an effect ran). */
export function getCardIds(cardList: CardList): number[] {
  return cardList.cards.map(c => c.id);
}

// ── Card-conservation helpers (zone-integrity regression checks) ──

// Every CardList that physically holds cards. Attached energy/tools already live in each
// Pokemon's `.cards`, so we skip the `.energies`/`.tools` mirrors to avoid double-counting.
function collectAllCardLists(state: State): CardList[] {
  const lists: CardList[] = [];
  for (const player of state.players) {
    lists.push(player.deck, player.hand, player.discard, player.lostzone, player.stadium, player.supporter);
    lists.push(player.active);
    lists.push(...player.bench);
    lists.push(...player.prizes);
  }
  return lists;
}

/** Multiset of every card id present anywhere in the game, sorted for stable comparison. */
export function collectAllCardIds(state: State): number[] {
  const ids: number[] = [];
  for (const list of collectAllCardLists(state)) {
    for (const card of list.cards) {
      ids.push(card.id);
    }
  }
  return ids.sort((a, b) => a - b);
}

/** Card ids that appear in more than one place (i.e. were duplicated by a buggy move). */
export function findDuplicateCardIds(state: State): number[] {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const id of collectAllCardIds(state)) {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  return Array.from(duplicates).sort((a, b) => a - b);
}

/** Throws if any card id appears in more than one zone. */
export function expectNoDuplicateCards(state: State): void {
  const duplicates = findDuplicateCardIds(state);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate card ids found across zones: ${duplicates.join(', ')}`);
  }
}

/** Throws if the set of cards differs from a `collectAllCardIds` snapshot (card created or lost). */
export function expectCardsConserved(state: State, idsBefore: number[]): void {
  const idsAfter = collectAllCardIds(state);
  const before = idsBefore.slice().sort((a, b) => a - b);
  if (before.length !== idsAfter.length || before.some((id, i) => id !== idsAfter[i])) {
    throw new Error(
      `Card set changed (not conserved).\n  before: [${before.join(', ')}]\n  after:  [${idsAfter.join(', ')}]`
    );
  }
}
