import { CardManager } from '../../game/cards/card-manager';
import { loadAllSets } from '../../sets/tests/test-helpers';
import { TrainerCard } from '../../game/store/card/trainer-card';
import { SuperType, TrainerType } from '../../game/store/card/card-types';
import { toPrinting } from '../printing';
import { importState } from '../state-adapter';
import { topLevelMenu } from '../legal-actions';
import { materializeNeutral, BoardSpec } from './support/scenario-runner';

/**
 * TA-186 — MENU==DISPATCH for `playableCardIds`.
 *
 * `Store.calculatePlayability` -> `CAN_PLAY_CARD` -> `CAN_PLAY_TRAINER_CARD` fills
 * `player.playableCardIds`, which is what a real client GLOWS from (`ptcg-play`'s
 * `hand.component.isCardPlayable` feeds `[isPlayable]`). The conformance wire does not carry that
 * field, so NO scenario can guard it — a divergence here is invisible to the differential and only
 * a player would ever see it. That is exactly why this lives as a spec.
 *
 * The invariant is one-directional and self-normalizing:
 *
 *     if the top-level menu offers a play naming a card in hand,
 *     that card MUST also appear in playableCardIds.
 *
 * Cards the menu does not offer are simply skipped, so a board that happens not to satisfy a given
 * card's requirements costs nothing. The converse (in playableCardIds but not offered) is deliberately
 * NOT asserted here: `legal-actions.ts` documents that over-reporting on the menu side is
 * self-correcting, because the fuzzer's "never reject your own legalAction" invariant catches it.
 *
 * Before the fix, `CAN_PLAY_TRAINER_CARD` ended with `return false` for any Item or Supporter without
 * a `canPlay()` override — "err on the side of caution" — while `playCardAction` accepted them. The
 * 305-subject trainer census found 12 in-pool printings in that state; all 12 are pinned below.
 */

// The 12 printings the census caught. Named so a regression names the card, not an index.
const TA186_PRINTINGS: Record<string, string> = {
  'asc-258': 'Cheren',
  'wht-081': 'Cheren',
  'meg-130': 'Switch',
  'pfl-123': 'Switch',
  'meg-125': 'Rare Candy',
  'meg-175': 'Rare Candy',
  'dri-164': 'Energy Recycler',
  'por-108': 'Energy Recycler',
  'por-080': 'Poké Ball',
  'meg-126': 'Repel',
  'ssp-186': 'Scramble Switch',
  'twm-147': 'Cook',
};

// The catalog is populated lazily; without this the registry is empty in a bare spec run.
loadAllSets();

// `asc-004`'s fullName is "Erika's Bellsprout MC", NOT "... ASC" — it is a reprint subclass and
// carries its base's set code. Resolved by printing rather than guessed, because guessing it wrong
// is silent: the board just fails to materialize.
const BASIC = 'Erika\'s Bellsprout MC';
const WATER = 'Water Energy SVE';

/** Every implemented Trainer, indexed by its canonical printing. */
function trainersByPrinting(): Map<string, TrainerCard> {
  const out = new Map<string, TrainerCard>();
  for (const card of CardManager.getInstance().getAllCards()) {
    if (card.superType !== SuperType.TRAINER) { continue; }
    out.set(toPrinting(card), card as TrainerCard);
  }
  return out;
}

/**
 * Put `cards` in A's hand on an otherwise ordinary mid-game board and return
 * {offered, playable} as sets of fullName.
 */
function probe(cards: TrainerCard[]): { offered: Set<string>; playable: Set<string> } {
  const board: BoardSpec = {
    turn: 3,
    players: {
      // Two benched Pokemon so a "1 of your Benched Pokemon" target is a real choice rather than a
      // CF-14 forced single candidate, and a stocked deck/discard so search/recover cards can resolve.
      A: {
        active: { card: BASIC, energy: [WATER] },
        bench: [{ card: BASIC }, { card: BASIC }],
        hand: cards.map(c => c.fullName),
        deck: [WATER, WATER, BASIC],
        discard: [WATER, BASIC],
        prizeCount: 6,
      },
      B: {
        active: { card: BASIC },
        bench: [{ card: BASIC }],
        deck: [WATER, WATER],
        prizeCount: 6,
      },
    },
  };

  const g = importState(materializeNeutral(board));
  const state = (g.store as any).calculatePlayability(g.state);

  const idToFullName = new Map<number, string>();
  (g.ctx.cardToIid as Map<any, string>).forEach((_iid, card: any) => {
    idToFullName.set(card.id, card.fullName);
  });

  const p = state.players[0];
  const playable = new Set<string>(
    (p.playableCardIds as number[]).map(id => idToFullName.get(id)).filter(Boolean) as string[],
  );

  const iidToFullName = new Map<string, string>();
  (g.ctx.cardToIid as Map<any, string>).forEach((iid: string, card: any) => {
    iidToFullName.set(iid, card.fullName);
  });

  const offered = new Set<string>();
  const menu: any = topLevelMenu(g);
  for (const a of (menu && menu.legalActions) || []) {
    // ANY menu entry naming a hand card counts — a Tool surfaces as `attachTool`, not `play*`.
    if (a.card) {
      const fn = iidToFullName.get(a.card);
      if (fn) { offered.add(fn); }
    }
  }
  return { offered, playable };
}

describe('Conformance — trainer playability (TA-186: playableCardIds must not under-report)', () => {

  it('the 12 census printings are all still implemented', () => {
    const index = trainersByPrinting();
    const missing = Object.keys(TA186_PRINTINGS).filter(pr => !index.has(pr));
    // If a printing disappears this guard silently stops guarding it, so fail loudly instead.
    expect(missing).toEqual([]);
  });

  it('every offered hand play is also marked playable (the 12 TA-186 printings)', () => {
    const index = trainersByPrinting();
    const cards = Object.keys(TA186_PRINTINGS)
      .map(pr => index.get(pr))
      .filter((c): c is TrainerCard => c !== undefined);

    const { offered, playable } = probe(cards);

    // At least some of them must be offered, or the board is not exercising anything and the
    // assertion below would pass vacuously.
    expect(offered.size).toBeGreaterThan(0);

    const notGlowing = [...offered].filter(fn => !playable.has(fn)).sort();
    expect(notGlowing).toEqual([]);
  });

  it('holds for every implemented Item and Supporter, not just the 12', () => {
    // The class guard: the 12 were what one census board happened to reach, but the defect was in a
    // shared fallback, so the invariant is asserted over the whole population in batches.
    const all = [...trainersByPrinting().values()].filter(
      c => c.trainerType === TrainerType.ITEM || c.trainerType === TrainerType.SUPPORTER,
    );
    expect(all.length).toBeGreaterThan(100); // sanity: the catalog actually loaded

    const offenders: string[] = [];
    const BATCH = 8; // a hand of 8 keeps each board legal and the run quick
    for (let i = 0; i < all.length; i += BATCH) {
      const { offered, playable } = probe(all.slice(i, i + BATCH));
      for (const fn of offered) {
        if (!playable.has(fn)) { offenders.push(fn); }
      }
    }
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

});
