import { State, GamePhase, GameWinner } from '../../../game/store/state/state';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';
import { SpecialCondition } from '../../../game/store/card/card-types';
import { Card } from '../../../game/store/card/card';
import { StateUtils } from '../../../game/store/state-utils';
import { IidContext } from '../../state-adapter';
import { NeutralState, PokemonInPlay, ConditionToken } from '../../neutral-types';

/**
 * Tier 1 (testing design doc §4): assert a neutral projection faithfully reflects the raw engine
 * `State` it was projected from. Independent traversal — reads engine fields directly here rather
 * than re-running `projectState` — so a projection that maps the wrong field, mis-resolves an iid,
 * drops a zone entry, or mis-derives a flag is caught. The four fields the adapter hardcodes to
 * defaults have no faithful engine source and are adjudicated separately (see the spec); they are
 * intentionally NOT checked here.
 */

// Independent condition↔token map (deliberately not the adapter's, so a wrong mapping is caught).
const TOKEN_OF: ReadonlyArray<readonly [SpecialCondition, ConditionToken]> = [
  [SpecialCondition.POISONED, 'poisoned'],
  [SpecialCondition.BURNED, 'burned'],
  [SpecialCondition.ASLEEP, 'asleep'],
  [SpecialCondition.PARALYZED, 'paralyzed'],
  [SpecialCondition.CONFUSED, 'confused'],
];
function tokenOf(c: SpecialCondition): ConditionToken {
  const found = TOKEN_OF.find(([k]) => k === c);
  if (!found) { throw new Error(`[projection-fidelity] unmapped condition ${c}`); }
  return found[1];
}

function iidOf(ctx: IidContext, card: Card): string {
  const iid = ctx.cardToIid.get(card);
  if (iid === undefined) { throw new Error(`[projection-fidelity] no iid for "${card.fullName}"`); }
  return iid;
}

function assertSlot(pip: PokemonInPlay, slot: PokemonCardList, ctx: IidContext): void {
  expect(pip.damage).toBe(slot.damage);
  expect(pip.stack.map(c => c.iid)).toEqual(slot.getPokemons().map(c => iidOf(ctx, c)));
  expect(pip.energy.map(c => c.iid)).toEqual(slot.energies.cards.map(c => iidOf(ctx, c)));
  expect(pip.tools.map(c => c.iid)).toEqual(slot.tools.map(c => iidOf(ctx, c)));
  expect(pip.conditions.slice().sort()).toEqual(slot.specialConditions.map(tokenOf).sort());
}

export function assertProjectionMatchesState(proj: NeutralState, state: State, ctx: IidContext): void {
  expect(proj.turn).toBe(state.turn);
  expect(proj.activePlayer).toBe(state.activePlayer === 0 ? 'A' : 'B');
  expect(proj.firstPlayer).toBe(ctx.firstPlayer); // game constant, echoed from initialState via ctx
  expect(proj.outcome === 'ongoing').toBe(state.winner === GameWinner.NONE);
  expect(proj.phase === 'gameOver').toBe(state.phase === GamePhase.FINISHED);

  (['A', 'B'] as const).forEach((id, i) => {
    const player = state.players[i];
    const pp = proj.players[id];

    // active
    if (player.active.getPokemonCard() !== undefined) {
      expect(pp.active).not.toBeNull();
      assertSlot(pp.active as PokemonInPlay, player.active, ctx);
    } else {
      expect(pp.active).toBeNull();
    }

    // bench (occupied slots, in order)
    const occupied = player.bench.filter(b => b.getPokemonCard() !== undefined);
    expect(pp.bench.length).toBe(occupied.length);
    occupied.forEach((slot, bi) => assertSlot(pp.bench[bi], slot, ctx));

    // zones — the projection preserves engine order, so compare exact order
    expect(pp.hand.map(c => c.iid)).toEqual(player.hand.cards.map(c => iidOf(ctx, c)));
    expect(pp.deck.map(c => c.iid)).toEqual(player.deck.cards.map(c => iidOf(ctx, c)));
    expect(pp.discard.map(c => c.iid)).toEqual(player.discard.cards.map(c => iidOf(ctx, c)));
    expect(pp.lostZone.map(c => c.iid)).toEqual(player.lostzone.cards.map(c => iidOf(ctx, c)));

    // prizes (non-empty prize piles, with face-up flag)
    const rawPrizes = player.prizes.filter(p => p.cards.length > 0);
    expect(pp.prizes.map(p => ({ iid: p.iid, faceUp: p.faceUp })))
      .toEqual(rawPrizes.map(p => ({ iid: iidOf(ctx, p.cards[0]), faceUp: p.faceUpPrize })));

    // faithful flags (the four deferred-default fields are excluded by design)
    expect(pp.flags.energyAttachedThisTurn).toBe(player.energyPlayedTurn === state.turn);
    expect(pp.flags.supporterPlayedThisTurn).toBe(player.supporterTurn === state.turn);
    expect(pp.flags.stadiumPlayedThisTurn).toBe(player.stadiumPlayedTurn === state.turn);
    expect(pp.flags.retreatedThisTurn).toBe(player.retreatedTurn === state.turn);
    expect(pp.flags.prizesTakenThisTurn).toBe(player.prizesTakenThisTurn);
    expect(pp.flags.prizesTakenLastTurn).toBe(player.prizesTakenLastTurn);
    expect(pp.flags.vstarUsed).toBe(player.usedVSTAR);
  });

  // stadium + owner
  const stadiumCard = StateUtils.getStadiumCard(state);
  if (stadiumCard) {
    expect(proj.stadium).not.toBeNull();
    expect(proj.stadium!.iid).toBe(iidOf(ctx, stadiumCard));
    const ownerIndex = state.players.findIndex(p => p.stadium.cards.includes(stadiumCard));
    expect(proj.stadium!.owner).toBe(ownerIndex === 0 ? 'A' : 'B');
  } else {
    expect(proj.stadium).toBeNull();
  }
}
