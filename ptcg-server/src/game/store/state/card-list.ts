import { CardManager } from '../../cards/card-manager';
import { GameError } from '../../game-error';
import { GameMessage } from '../../game-message';
import { Card } from '../card/card';
import { matchesCardFilter } from '../card/card-filter';
import { EnergyType, SuperType, TrainerType } from '../card/card-types';
import { EnergyCard } from '../card/energy-card';
import { TrainerCard } from '../card/trainer-card';

export enum StadiumDirection {
  UP = 'up',
  DOWN = 'down'
}

export class CardList {

  public cards: Card[] = [];

  public isPublic: boolean = false;

  public isSecret: boolean = false;

  public faceUpPrize: boolean = false;

  public stadiumDirection: StadiumDirection = StadiumDirection.UP;

  public markedAsNotSecret: boolean = false;

  /**
   * CF-61 (conformance projection; inert for gameplay). `zoneTag` names a SETTLED zone ('deck'), set by
   * the conformance importer on each player's zones and never on a temp pile. `fromZoneTag` is stamped
   * on a temp pile by moveTo/moveCardsTo with the tag of the settled zone its cards came from (propagated
   * pile-to-pile), so the wire projection can put a "look at the top/bottom N of your deck" window back
   * into `deck` at the top, in pile order, instead of `resolving`. A settled zone is never re-tagged.
   * `fromZoneRef` (non-enumerable, so deepClone skips it) is the source list itself, for owner lookup.
   */
  public zoneTag?: string;

  public fromZoneTag?: string;

  private recordSource(destination: CardList): void {
    if (destination.zoneTag !== undefined) { return; }
    const tag = this.zoneTag ?? this.fromZoneTag;
    if (tag === undefined) { return; }
    destination.fromZoneTag = tag;
    const ref = this.zoneTag !== undefined ? this : (this as unknown as { fromZoneRef?: CardList }).fromZoneRef;
    Object.defineProperty(destination, 'fromZoneRef', { value: ref, enumerable: false, configurable: true, writable: true });
  }

  /**
   * CF-61 residual (2026-09-14): per-CARD deck provenance, for DETACHED piles no active prompt
   * references. The LIST-level `fromZoneTag` above lets the projection route a prompt-referenced
   * look window back into `deck`, but a closure-local pile (Grimsley's Move's un-looked remainder
   * during its shuffle; Crobat's / Dialga's staging piles at their shuffle pauses) surfaces only as
   * ORPHAN CARDS — the list itself is unreachable from State. So each card that leaves the deck (or
   * a deck-stamped pile) for an untagged list records the ORDER it left; the projection uses it to
   * put deck-sourced orphans back into `deck` in the original relative order (rotomancer's shape —
   * see projectOrphans). Kept when the card re-enters the settled deck mid-effect (the restage half
   * of Grimsley's Move, so the window and the remainder sort back into one sequence); cleared by a
   * resolved shuffle (`applyOrder` — order provenance is dead) and by `moveToTopOfDestination` into
   * a settled zone. A card already stamped keeps its first seq (the earliest removal is the one that
   * matches the surviving deck order). WeakMap on the shared Card instances; inert for gameplay.
   */
  public static readonly deckStamp = new WeakMap<Card, number>();

  /**
   * G-63 / B.68(4) (conformance projection; inert for gameplay). A card the TEXT puts outside the
   * standard zones mid-effect ("put that Pokémon face down in front of you": Tyme) records where it came
   * from, where the text will put it when the effect completes, and its face, so its wire `resolving`
   * entry can say so. Set by the card that does it; read only by the projection, and only while the card
   * sits in no projected zone (the moment it lands in one, that zone is where it is projected). `order`, when set,
   * is the card's place in a lifted pile whose order is known (Iono's answered hand block); the projection lists
   * stamped cards by it.
   */
  public static readonly transit = new WeakMap<Card, { origin: string; destination?: string; visibility: 'public' | 'owner' | 'hidden'; order?: number }>();
  private static deckStampSeq = 0;

  /**
   * TA-593 (conformance; inert for gameplay — unset outside the conformance driver). Called once per POSITIONAL
   * take off the top of a list (`moveTo` with or without a count; MoveCardsEffect's `count` path), with the number
   * of cards taken. The driver keeps the takes from a player's own deck into that player's own hand: that is a
   * draw (rotomancer's definition too: a positional deck -> own-hand take; a search moves chosen cards, a look
   * window goes through a temp list, and neither is seen here).
   */
  public static topTake?: (from: CardList, to: CardList, count: number) => void;

  /**
   * Conformance only, inert for gameplay: called once a switch between the Active Spot and the Bench completes
   * (Player.switchPokemon, applyPromotion), with the player whose Pokémon swapped. The driver cuts the physical
   * `moved` legs there (B.81: a switch is an ordering point), so a Pokémon pushed to the Bench and Knocked Out in
   * the same dispatch shows its stop on the Bench.
   */
  public static legCut?: (player: unknown) => void;

  private stampMovedCards(cards: Card[], destination: CardList): void {
    if (destination.zoneTag !== undefined) { return; }   // re-entering the settled deck: stamps kept
    if (this.zoneTag !== 'deck' && this.fromZoneTag !== 'deck') { return; }
    for (const c of cards) {
      if (!CardList.deckStamp.has(c)) {
        CardList.deckStamp.set(c, CardList.deckStampSeq++);
      }
    }
  }

  public static fromList(names: string[]): CardList {
    const cardList = new CardList();
    const cardManager = CardManager.getInstance();
    cardList.cards = names.map(cardName => {
      const card = cardManager.getCardByName(cardName);
      if (card === undefined) {
        throw new GameError(GameMessage.UNKNOWN_CARD, cardName);
      }
      return card;
    });
    return cardList;
  }

  public applyOrder(order: number[]) {
    // Check if order is valid, same length
    if (this.cards.length !== order.length) {
      return;
    }
    // Contains all elements exacly one time
    const orderCopy = order.slice();
    orderCopy.sort((a, b) => a - b);
    for (let i = 0; i < orderCopy.length; i++) {
      if (i !== orderCopy[i]) {
        return;
      }
    }
    // Apply order
    const copy = this.cards.slice();
    for (let i = 0; i < order.length; i++) {
      this.cards[i] = copy[order[i]];
    }
    // CF-61 residual: a resolved shuffle/order invalidates removal-order provenance for these cards.
    this.cards.forEach(c => CardList.deckStamp.delete(c));
  }

  public moveTo(destination: CardList, count?: number): void {
    this.recordSource(destination);
    if (count === undefined) {
      count = this.cards.length;
    }

    count = Math.min(count, this.cards.length);
    const cards = this.cards.splice(0, count);
    this.stampMovedCards(cards, destination);
    destination.cards.push(...cards);
    if (cards.length > 0) {
      CardList.topTake?.(this, destination, cards.length);
    }
  }

  public moveCardsTo(cards: Card[], destination: CardList): void {
    this.recordSource(destination);
    // Defensive snapshot: callers frequently pass the live `this.cards` array itself (e.g.
    // `hand.moveCardsTo(hand.cards, discard)` to discard the whole hand). Splicing out of
    // `this.cards` while iterating that same array shrinks the loop bound as it goes, so only
    // every other card is moved (a 6-card list moves 3 and keeps 3). Iterate over a copy when
    // the input aliases our backing array — non-aliased callers are unaffected. (Amarys PRE.)
    const toMove = cards === this.cards ? cards.slice() : cards;
    const moved: Card[] = [];   // CF-61 residual: stamped once, after the loop settles what moved
    for (let i = 0; i < toMove.length; i++) {
      let index = this.cards.indexOf(toMove[i]);
      if (index !== -1) {
        const card = this.cards.splice(index, 1);
        moved.push(card[0]);
        // If this is a PokemonCardList with the energies property, remove the card from energies
        if ('energies' in this) {
          const pokemonList = this as any;
          if (pokemonList.energies && pokemonList.energies.cards) {
            const energyIndex = pokemonList.energies.cards.indexOf(card[0]);
            if (energyIndex !== -1) {
              pokemonList.energies.cards.splice(energyIndex, 1);
            }
          }
        }
        destination.cards.push(card[0]);
        // If destination is a PokemonCardList and card is an energy card (not a Pokemon), add to energies.cards
        if ('energies' in destination) {
          const destPkm = destination as any;
          if (destPkm.energies && destPkm.energies.cards) {
            // Only add actual energy cards (superType === ENERGY), not Pokemon cards that can act as energy
            const isEnergyCard = card[0].superType === SuperType.ENERGY;
            if (isEnergyCard && !destPkm.energies.cards.includes(card[0])) {
              destPkm.energies.cards.push(card[0]);
            }
          }
        }
      } else if ((this as any).tools && Array.isArray((this as any).tools)) {
        // If not found in cards, check tools (for robustness)
        index = (this as any).tools.indexOf(toMove[i]);
        if (index !== -1) {
          const card = (this as any).tools.splice(index, 1);
          moved.push(card[0]);
          destination.cards.push(card[0]);
          // If destination is a PokemonCardList and card is an energy card (not a Pokemon), add to energies.cards
          if ('energies' in destination) {
            const destPkm = destination as any;
            if (destPkm.energies && destPkm.energies.cards) {
              // Only add actual energy cards (superType === ENERGY), not Pokemon cards that can act as energy
              const isEnergyCard = card[0].superType === SuperType.ENERGY;
              if (isEnergyCard && !destPkm.energies.cards.includes(card[0])) {
                destPkm.energies.cards.push(card[0]);
              }
            }
          }
        }
      }
    }
    this.stampMovedCards(moved, destination);   // CF-61 residual
  }

  public moveCardTo(card: Card, destination: CardList): void {
    this.moveCardsTo([card], destination);
  }

  public moveToTopOfDestination(destination: CardList): void {
    if (destination.zoneTag !== undefined) {
      // CF-61 residual: landing on top of a settled zone in a chosen order ends the provenance
      // (Snack Seek's decline, an OrderCardsPrompt restack) — the stamp must not outlive the pause.
      this.cards.forEach(c => CardList.deckStamp.delete(c));
    }
    destination.cards = [...this.cards, ...destination.cards];
  }

  public filter(query: Partial<Card>): Card[] {
    // TA-335: array-valued query fields (`cardType: [X]`) match by containment, scalars strictly.
    return this.cards.filter(c => matchesCardFilter(c, query));
  }

  public count(query: Partial<Card>): number {
    return this.filter(query).length;
  }

  public sort(superType: SuperType = SuperType.POKEMON) {
    this.cards.sort((a, b) => {

      const result = this.compareSupertype(a.superType) - this.compareSupertype(b.superType);

      // not of the same supertype
      if (result !== 0) {
        return result;
      }

      // cards match supertype, so sort by subtype
      if ((<any>a).trainerType != null) {
        const cardA = a as TrainerCard;
        if (cardA.trainerType != null && (<any>b).trainerType != null) {
          const cardB = b as TrainerCard;
          const subtypeCompare = this.compareTrainerType(cardA.trainerType) - this.compareTrainerType(cardB.trainerType);
          if (subtypeCompare !== 0) {
            return subtypeCompare;
          }
        }
      }
      else if ((<any>a).energyType != null) {
        const cardA = a as EnergyCard;
        if (cardA.energyType != null && (<any>b).energyType != null) {
          const cardB = b as TrainerCard;
          const subtypeCompare = this.compareEnergyType(cardA.energyType) - this.compareEnergyType(cardB.energyType!);
          if (subtypeCompare !== 0) {
            return subtypeCompare;
          }
        }
      }

      // subtype matches, sort by name
      if (a.name < b.name) {
        return -1;
      } else {
        return 1;
      }
    });
  }

  private compareSupertype(input: SuperType) {
    if (input === SuperType.POKEMON) return 1;
    if (input === SuperType.TRAINER) return 2;
    if (input === SuperType.ENERGY) return 3;
    return Infinity;
  }

  private compareTrainerType(input: TrainerType) {
    if (input === TrainerType.SUPPORTER) return 1;
    if (input === TrainerType.ITEM) return 2;
    if (input === TrainerType.TOOL) return 3;
    if (input === TrainerType.STADIUM) return 4;
    return Infinity;
  }

  private compareEnergyType(input: EnergyType) {
    if (input === EnergyType.BASIC) return 1;
    if (input === EnergyType.SPECIAL) return 2;
    return Infinity;
  }
}
