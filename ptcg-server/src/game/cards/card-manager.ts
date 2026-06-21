import { Card } from '../store/card/card';
import { deepClone } from '../../utils/utils';
import { CardsInfo } from '../../backend/interfaces/cards.interface';

export class CardManager {

  private static instance: CardManager;
  private cards: Card[] = [];
  private cardIndex: { [name: string]: number } = {};
  // O(1) lookup by set code + collector number (key: `${set}|${setNumber}`). First card defined for a
  // given key wins, matching the previous `getAllCards().find(...)` first-match semantics.
  private setNumberIndex: { [key: string]: number } = {};

  private static setNumberKey(set: string, setNumber: string | number): string {
    return `${set}|${String(setNumber)}`;
  }

  public static getInstance(): CardManager {
    if (!CardManager.instance) {
      CardManager.instance = new CardManager();
    }
    return CardManager.instance;
  }

  /**
   * Validates all sets for duplicate fullName and legacyFullName without loading.
   * Returns an array of error messages (one per duplicate). Empty if no issues.
   */
  public static validateAllSets(
    entries: Array<{ key: string; cards: Card[] }>
  ): string[] {
    const fullNameMap: { [name: string]: Array<{ key: string }> } = {};
    const legacyFullNameMap: { [name: string]: Array<{ key: string }> } = {};

    for (const { key, cards } of entries) {
      if (!Array.isArray(cards)) continue;
      for (const card of cards) {
        const fullName = card.fullName;
        if (!fullNameMap[fullName]) fullNameMap[fullName] = [];
        fullNameMap[fullName].push({ key });

        const p = card as { legacyFullName?: string };
        if (p.legacyFullName) {
          const legacyName = p.legacyFullName;
          if (!legacyFullNameMap[legacyName]) legacyFullNameMap[legacyName] = [];
          legacyFullNameMap[legacyName].push({ key });
        }
      }
    }

    const errors: string[] = [];
    for (const [name, entriesList] of Object.entries(fullNameMap)) {
      if (entriesList.length > 1) {
        const setKeys = [...new Set(entriesList.map((e) => e.key))];
        errors.push(`Duplicate fullName '${name}': in ${setKeys.join(', ')}`);
      }
    }
    for (const [name, entriesList] of Object.entries(legacyFullNameMap)) {
      if (entriesList.length > 1) {
        const setKeys = [...new Set(entriesList.map((e) => e.key))];
        errors.push(`Duplicate legacyFullName '${name}': in ${setKeys.join(', ')}`);
      }
    }
    return errors;
  }

  public defineSet(set: Card[]): void {
    for (const card of set) {
      if (this.cardIndex[card.fullName] !== undefined) {
        throw new Error('Multiple cards with the same name: ' + card.fullName);
      }

      const index = this.cards.length;
      this.cards.push(card);
      this.cardIndex[card.fullName] = index;

      const setNumberKey = CardManager.setNumberKey(card.set, card.setNumber);
      if (this.setNumberIndex[setNumberKey] === undefined) {
        this.setNumberIndex[setNumberKey] = index;
      }

      const p = card as any;
      if (p.legacyFullName) {
        if (this.cardIndex[p.legacyFullName] !== undefined) {
          throw new Error('Multiple cards with the same name: ' + p.legacyFullName);
        }
        this.cardIndex[p.legacyFullName] = index;
      }
    }
  }

  public loadCardsInfo(cardsInfo: CardsInfo) {
    this.cardIndex = {};
    this.setNumberIndex = {};
    this.cards = cardsInfo.cards;
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      this.cardIndex[card.fullName] = i;
      const setNumberKey = CardManager.setNumberKey(card.set, card.setNumber);
      if (this.setNumberIndex[setNumberKey] === undefined) {
        this.setNumberIndex[setNumberKey] = i;
      }
    }
  }

  public defineCard(card: Card): void {
    if (this.cardIndex[card.fullName] !== undefined) {
      throw new Error('Multiple cards with the same name: ' + card.fullName);
    }

    const index = this.cards.length;
    this.cards.push(card);
    this.cardIndex[card.fullName] = index;

    const setNumberKey = CardManager.setNumberKey(card.set, card.setNumber);
    if (this.setNumberIndex[setNumberKey] === undefined) {
      this.setNumberIndex[setNumberKey] = index;
    }
  }

  public getCardByName(name: string): Card | undefined {
    const index = this.cardIndex[name];
    if (index !== undefined) {
      return deepClone(this.cards[index]);
    }
  }

  public isCardDefined(name: string): boolean {
    return this.cardIndex[name] !== undefined;
  }

  /**
   * O(1) lookup of the shared registry instance by set code + collector number, or undefined if no
   * card is registered for that key. Returns the raw instance (not a clone) — mirroring the previous
   * `getAllCards().find(...)` behaviour; callers that need a mutable copy should re-resolve by name.
   */
  public getCardBySetAndNumber(set: string, setNumber: string | number): Card | undefined {
    const index = this.setNumberIndex[CardManager.setNumberKey(set, setNumber)];
    return index !== undefined ? this.cards[index] : undefined;
  }

  public getAllCards(): Card[] {
    return this.cards;
  }

}
