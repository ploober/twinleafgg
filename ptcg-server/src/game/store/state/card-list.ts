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
  }

  public moveTo(destination: CardList, count?: number): void {
    this.recordSource(destination);
    if (count === undefined) {
      count = this.cards.length;
    }

    count = Math.min(count, this.cards.length);
    const cards = this.cards.splice(0, count);
    destination.cards.push(...cards);
  }

  public moveCardsTo(cards: Card[], destination: CardList): void {
    this.recordSource(destination);
    // Defensive snapshot: callers frequently pass the live `this.cards` array itself (e.g.
    // `hand.moveCardsTo(hand.cards, discard)` to discard the whole hand). Splicing out of
    // `this.cards` while iterating that same array shrinks the loop bound as it goes, so only
    // every other card is moved (a 6-card list moves 3 and keeps 3). Iterate over a copy when
    // the input aliases our backing array — non-aliased callers are unaffected. (Amarys PRE.)
    const toMove = cards === this.cards ? cards.slice() : cards;
    for (let i = 0; i < toMove.length; i++) {
      let index = this.cards.indexOf(toMove[i]);
      if (index !== -1) {
        const card = this.cards.splice(index, 1);
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
  }

  public moveCardTo(card: Card, destination: CardList): void {
    this.moveCardsTo([card], destination);
  }

  public moveToTopOfDestination(destination: CardList): void {
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
