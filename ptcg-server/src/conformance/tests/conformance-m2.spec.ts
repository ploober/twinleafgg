import { importState, ImportedGame } from '../state-adapter';
import { replay, projectGame } from '../driver';
import { toPrinting } from '../printing';
import { getCardByName } from '../../sets/tests/test-helpers';
import {
  NeutralState, WireLegalAction,
  PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION
} from '../neutral-types';
import { GameMessage } from '../../game/game-message';
import { PlayerType, SlotType, CardTarget } from '../../game/store/actions/play-card-action';
import { SuperType } from '../../game/store/card/card-types';
import { StateUtils } from '../../game/store/state-utils';
import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { ChoosePokemonPrompt } from '../../game/store/prompts/choose-pokemon-prompt';
import { PutDamagePrompt } from '../../game/store/prompts/put-damage-prompt';
import { AttachEnergyPrompt, CardAssign } from '../../game/store/prompts/attach-energy-prompt';
import { DiscardEnergyPrompt, DiscardEnergyTransfer } from '../../game/store/prompts/discard-energy-prompt';
import { MoveDamagePrompt, DamageMap, DamageTransfer } from '../../game/store/prompts/move-damage-prompt';
import { ShuffleDeckPrompt } from '../../game/store/prompts/shuffle-prompt';
import { PokemonCardList } from '../../game/store/state/pokemon-card-list';

// ── board builders ──────────────────────────────────────────────────────────

// M2 works at the ENGINE level — decomposer results are engine Cards, asserted by `fullName`. Boards
// accept fullName printings (import resolves either form). Only the few PROJECTED-printing assertions
// use the set-number form (`*_PRINTING`).
const PSY = 'Psychic Energy SVE';
const WATER = 'Water Energy SVE';
const LIGHT = 'Lightning Energy SVE';
const RALTS = 'Ralts SIT';
const LIGHT_PRINTING = toPrinting(getCardByName('Lightning Energy SVE'));

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}
function ralts(iid: string, energy: Array<{ iid: string; printing: string }> = [], damage = 0): PokemonInPlay {
  return { stack: [{ iid, printing: RALTS }], energy, tools: [], damage, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  // Each side needs a prize, else checkState sees 0 prizes left and triggers a sudden-death re-setup.
  const withPrize = (ps: PlayerState, tag: string): PlayerState =>
    ps.prizes.length ? ps : { ...ps, prizes: [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }] };
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: withPrize(A, 'A'), B: withPrize(B, 'B') },
  };
}

/** The legalActions surfaced for the first decision of an open prompt (no actions consumed). */
function firstDecision(game: ImportedGame): WireLegalAction[] {
  const pending = replay(game, []).pending;
  if (pending === null) {
    throw new Error('no pending decision surfaced');
  }
  return pending.legalActions;
}

function opp(game: ImportedGame, target: CardTarget): PokemonCardList {
  return StateUtils.getTarget(game.state, game.state.players[0], target);
}

describe('Conformance M2 — prompt decomposers (single-decision granularity)', () => {

  // ── ChooseCardsPrompt ──────────────────────────────────────────────────────

  it('ChooseCards: "discard 2" surfaces 2 decisions and resolves to the chosen cards', () => {
    const game = importState(board(
      player({ active: ralts('A-act'), hand: [
        { iid: 'h0', printing: PSY }, { iid: 'h1', printing: WATER }, { iid: 'h2', printing: LIGHT },
      ] }),
      player({ active: ralts('B-act') }),
    ));
    const p = game.state.players[0];
    let captured: any;
    game.store.prompt(game.state, new ChooseCardsPrompt(
      p, GameMessage.CHOOSE_CARD_TO_DISCARD, p.hand, {}, { min: 2, max: 2, allowCancel: false }
    ), cards => {
      captured = cards;
      (cards || []).forEach((c: any) => p.hand.moveCardTo(c, p.discard));
    });

    // first decision: 3 candidates (fixed count, 2 of 3) — a discard pick surfaces
    // as `discard {owner, target}` (CF-8), not generic `choose`
    const la = firstDecision(game);
    expect(la.filter(a => a.type === 'discard').length).toBe(3);
    expect((la[0] as any).owner).toBe('A');

    const res = replay(game, [
      { actor: 'A', type: 'discard', target: 'h0', owner: 'A' },
      { actor: 'A', type: 'discard', target: 'h1', owner: 'A' },
    ]);
    expect(captured.map((c: any) => c.fullName)).toEqual([PSY, WATER]);
    expect(res.pending!.descriptor).toBe('main'); // resolved → back to A's main-phase menu (M5)
    const proj = projectGame(game);
    expect(proj.players.A.hand).toEqual([{ iid: 'h2', printing: LIGHT_PRINTING }]);
    expect(proj.players.A.discard.map(c => c.iid).sort()).toEqual(['h0', 'h1']);
  });

  it('ChooseCards: "up to 2" stops at one pick via the explicit stop; a non-pick action is invalid (CF-12, R1 deprecated)', () => {
    const game = importState(board(
      player({ active: ralts('A-act'), hand: [{ iid: 'h0', printing: PSY }, { iid: 'h1', printing: WATER }] }),
      player({ active: ralts('B-act') }),
    ));
    const p = game.state.players[0];
    let captured: any;
    game.store.prompt(game.state, new ChooseCardsPrompt(
      p, GameMessage.CHOOSE_CARD_TO_DISCARD, p.hand, {}, { min: 1, max: 2, allowCancel: false }
    ), cards => { captured = cards; });

    // After one pick (min satisfied, max not reached) the decision offers more `discard` picks PLUS
    // the advertised explicit stop `confirm{value:false}` (CF-4). The internal `endChoice` marker is
    // never on the wire — it surfaces as `confirm`.
    const d2 = replay(game, [{ actor: 'A', type: 'discard', target: 'h0', owner: 'A' }]).pending!.legalActions;
    expect(d2.some(a => (a as { type: string }).type === 'endChoice')).toBe(false);
    expect(d2.some(a => a.type === 'discard')).toBe(true);
    expect(d2.some(a => a.type === 'confirm' && (a as { value?: boolean }).value === false)).toBe(true);

    // CF-4/CF-12: the explicit stop finalizes the "up to 2" at one pick -> [PSY]; both actions consumed.
    const res = replay(game, [
      { actor: 'A', type: 'discard', target: 'h0', owner: 'A' },
      { actor: 'A', type: 'confirm', value: false },
    ]);
    expect(captured.map((c: any) => c.fullName)).toEqual([PSY]);
    expect(res.applied).toBe(2);

    // CF-12 (R1 deprecated): a non-pick, non-stop action (endTurn) is not offered here, so it is
    // rejected rather than implicitly completing the decision.
    const rej = replay(game, [
      { actor: 'A', type: 'discard', target: 'h0', owner: 'A' },
      { actor: 'A', type: 'endTurn' },
    ]);
    expect(rej.rejection).toBeDefined();
  });

  it('ChooseCards: blocked indices are not offered', () => {
    const game = importState(board(
      player({ active: ralts('A-act'), hand: [{ iid: 'h0', printing: PSY }, { iid: 'h1', printing: WATER }] }),
      player({ active: ralts('B-act') }),
    ));
    const p = game.state.players[0];
    game.store.prompt(game.state, new ChooseCardsPrompt(
      p, GameMessage.CHOOSE_CARD_TO_DISCARD, p.hand, {}, { min: 1, max: 1, blocked: [0] }
    ), () => { /* noop */ });
    const targets = firstDecision(game).filter(a => a.type === 'discard').map(a => (a as any).target);
    expect(targets).toEqual(['h1']); // h0 (index 0) blocked
  });

  // ── ChoosePokemonPrompt ────────────────────────────────────────────────────

  it('ChoosePokemon: enumerates both players and resolves the chosen Pokemon', () => {
    const game = importState(board(
      player({ active: ralts('A-act'), bench: [ralts('A-b0')] }),
      player({ active: ralts('B-act') }),
    ));
    const p = game.state.players[0];
    let captured: PokemonCardList[] | undefined;
    game.store.prompt(game.state, new ChoosePokemonPrompt(
      p.id, GameMessage.CHOOSE_POKEMON, PlayerType.ANY, [SlotType.ACTIVE, SlotType.BENCH], { min: 1, max: 1 }
    ), (result: PokemonCardList[]) => { captured = result; });

    const targets = firstDecision(game).filter(a => a.type === 'choose').map(a => (a as any).target).sort();
    expect(targets).toEqual(['A-act', 'A-b0', 'B-act']);

    replay(game, [{ actor: 'A', type: 'choose', target: 'B-act' }]);
    expect(captured![0]).toBe(game.state.players[1].active);
  });

  // ── PutDamagePrompt ────────────────────────────────────────────────────────

  it('PutDamage: N counters surface as N decisions; reassembles a summed DamageMap (spread)', () => {
    const game = importState(board(
      player({ active: ralts('A-act') }),
      player({ active: ralts('B-act'), bench: [ralts('B-b0')] }),
    ));
    const p = game.state.players[0];
    const max: DamageMap[] = [
      { target: { player: PlayerType.TOP_PLAYER, slot: SlotType.ACTIVE, index: 0 }, damage: 60 },
      { target: { player: PlayerType.TOP_PLAYER, slot: SlotType.BENCH, index: 0 }, damage: 60 },
    ];
    game.store.prompt(game.state, new PutDamagePrompt(
      p.id, GameMessage.CHOOSE_POKEMON_TO_DAMAGE, PlayerType.TOP_PLAYER, [SlotType.ACTIVE, SlotType.BENCH], 20, max
    ), (result: DamageMap[]) => {
      (result || []).forEach(dm => { opp(game, dm.target).damage += dm.damage; });
    });

    const res = replay(game, [
      { actor: 'A', type: 'placeCounter', target: 'B-act' },
      { actor: 'A', type: 'placeCounter', target: 'B-b0' },
    ]);
    expect(res.pending!.descriptor).toBe('main'); // resolved → back to A's main-phase menu (M5)
    const proj = projectGame(game);
    expect(proj.players.B.active!.damage).toBe(10);
    expect(proj.players.B.bench[0].damage).toBe(10);
  });

  it('PutDamage: all counters on one target sum into a single DamageMap', () => {
    const game = importState(board(
      player({ active: ralts('A-act') }),
      player({ active: ralts('B-act') }),
    ));
    const p = game.state.players[0];
    const max: DamageMap[] = [{ target: { player: PlayerType.TOP_PLAYER, slot: SlotType.ACTIVE, index: 0 }, damage: 100 }];
    let captured: DamageMap[] | undefined;
    game.store.prompt(game.state, new PutDamagePrompt(
      p.id, GameMessage.CHOOSE_POKEMON_TO_DAMAGE, PlayerType.TOP_PLAYER, [SlotType.ACTIVE, SlotType.BENCH], 30, max
    ), (result: DamageMap[]) => { captured = result; });

    replay(game, [
      { actor: 'A', type: 'placeCounter', target: 'B-act' },
      { actor: 'A', type: 'placeCounter', target: 'B-act' },
      { actor: 'A', type: 'placeCounter', target: 'B-act' },
    ]);
    expect(captured!.length).toBe(1);
    expect(captured![0].damage).toBe(30);
  });

  // ── AttachEnergyPrompt ─────────────────────────────────────────────────────

  it('AttachEnergy: surfaces (energy × target) pairs and resolves to a CardAssign', () => {
    const game = importState(board(
      player({ active: ralts('A-act'), discard: [{ iid: 'd0', printing: WATER }, { iid: 'd1', printing: PSY }] }),
      player({ active: ralts('B-act') }),
    ));
    const p = game.state.players[0];
    let captured: CardAssign[] | undefined;
    game.store.prompt(game.state, new AttachEnergyPrompt(
      p.id, GameMessage.CHOOSE_CARD_TO_HAND, p.discard, PlayerType.BOTTOM_PLAYER,
      [SlotType.ACTIVE, SlotType.BENCH], { superType: SuperType.ENERGY }, { min: 1, max: 1 }
    ), (result: CardAssign[]) => { captured = result; });

    // both energies are candidates, each paired with the only target (A-act)
    const la = firstDecision(game).filter(a => a.type === 'attachEnergy') as any[];
    expect(la.map(a => a.card).sort()).toEqual(['d0', 'd1']);
    expect(la.every(a => a.target === 'A-act')).toBe(true);

    replay(game, [{ actor: 'A', type: 'attachEnergy', card: 'd0', target: 'A-act' }]);
    expect(captured!.length).toBe(1);
    expect(captured![0].card.fullName).toBe(WATER);
  });

  // ── DiscardEnergyPrompt ────────────────────────────────────────────────────

  it('DiscardEnergy: surfaces attached energies and resolves to a DiscardEnergyTransfer', () => {
    const game = importState(board(
      player({ active: ralts('A-act', [{ iid: 'e0', printing: WATER }, { iid: 'e1', printing: PSY }]) }),
      player({ active: ralts('B-act') }),
    ));
    const p = game.state.players[0];
    let captured: DiscardEnergyTransfer[] | undefined;
    game.store.prompt(game.state, new DiscardEnergyPrompt(
      p.id, GameMessage.CHOOSE_CARD_TO_DISCARD, PlayerType.BOTTOM_PLAYER,
      [SlotType.ACTIVE, SlotType.BENCH], { superType: SuperType.ENERGY }, { min: 1, max: 1 }
    ), (result: DiscardEnergyTransfer[]) => { captured = result; });

    const targets = firstDecision(game).filter(a => a.type === 'discard').map(a => (a as any).target).sort();
    expect(targets).toEqual(['e0', 'e1']);

    replay(game, [{ actor: 'A', type: 'discard', target: 'e1' }]);
    expect(captured!.length).toBe(1);
    expect(captured![0].card.fullName).toBe(PSY);
  });

  // ── MoveDamagePrompt ───────────────────────────────────────────────────────

  it('MoveDamage: surfaces from→to pairs and resolves to a DamageTransfer', () => {
    const game = importState(board(
      player({ active: ralts('A-act') }),
      player({ active: ralts('B-act', [], 30), bench: [ralts('B-b0')] }),
    ));
    const p = game.state.players[0];
    const max: DamageMap[] = [{ target: { player: PlayerType.TOP_PLAYER, slot: SlotType.ACTIVE, index: 0 }, damage: 30 }];
    let captured: DamageTransfer[] | undefined;
    game.store.prompt(game.state, new MoveDamagePrompt(
      p.id, GameMessage.CHOOSE_POKEMON, PlayerType.TOP_PLAYER, [SlotType.ACTIVE, SlotType.BENCH], max, { min: 1, max: 1 }
    ), (result: DamageTransfer[]) => { captured = result; });

    // relocating a counter has no single Action (R2): pick the SOURCE (choose), then the
    // DESTINATION (placeCounter). Only B-active has damage; it can't move onto itself.
    const sources = firstDecision(game).filter(a => a.type === 'choose') as any[];
    expect(sources).toEqual([{ actor: 'A', type: 'choose', target: 'B-act' }]);

    const dests = replay(game, [{ actor: 'A', type: 'choose', target: 'B-act' }])
      .pending!.legalActions.filter(a => a.type === 'placeCounter') as any[];
    expect(dests).toEqual([{ actor: 'A', type: 'placeCounter', target: 'B-b0' }]);

    replay(game, [
      { actor: 'A', type: 'choose', target: 'B-act' },
      { actor: 'A', type: 'placeCounter', target: 'B-b0' },
    ]);
    expect(captured!.length).toBe(1);
  });

  // ── System-prompt seam (M2/M3) ─────────────────────────────────────────────

  it('surfaces a chained ShuffleDeckPrompt as a system pending and stops (M2/M3 seam)', () => {
    const game = importState(board(
      // 2-card hand → the CHOOSE_CARD_TO_DISCARD is a genuine choice that still SURFACES (a 1-card hand
      // is now a CF-8 forced-atomic discard that auto-resolves — see choose-cards.ts — which would bypass
      // this seam test); this test targets the chained-shuffle system seam, not discard granularity.
      player({ active: ralts('A-act'), hand: [{ iid: 'h0', printing: PSY }, { iid: 'h1', printing: PSY }], deck: [{ iid: 'd0', printing: WATER }, { iid: 'd1', printing: PSY }] }),
      player({ active: ralts('B-act') }),
    ));
    const p = game.state.players[0];
    game.store.prompt(game.state, new ChooseCardsPrompt(
      p, GameMessage.CHOOSE_CARD_TO_DISCARD, p.hand, {}, { min: 1, max: 1, allowCancel: false }
    ), () => {
      // the card's callback chains into a deck shuffle (the system actor's job)
      game.store.prompt(game.state, new ShuffleDeckPrompt(p.id), (order: number[]) => { p.deck.applyOrder(order); });
    });

    const res = replay(game, [{ actor: 'A', type: 'discard', target: 'h0', owner: 'A' }]);
    expect(res.pending).not.toBeNull();
    expect(res.pending!.actor).toBe('system');
    expect(res.pending!.legalActions[0].type).toBe('shuffle');
    expect((res.pending!.legalActions[0] as any).deck.sort()).toEqual(['d0', 'd1']);
  });

  it('resolving a chained shuffle emits a significant `shuffled` event for the deck owner', () => {
    const game = importState(board(
      // 2-card hand → the CHOOSE_CARD_TO_DISCARD is a genuine choice that still SURFACES (a 1-card hand
      // is now a CF-8 forced-atomic discard that auto-resolves — see choose-cards.ts — which would bypass
      // this seam test); this test targets the chained-shuffle system seam, not discard granularity.
      player({ active: ralts('A-act'), hand: [{ iid: 'h0', printing: PSY }, { iid: 'h1', printing: PSY }], deck: [{ iid: 'd0', printing: WATER }, { iid: 'd1', printing: PSY }] }),
      player({ active: ralts('B-act') }),
    ));
    const p = game.state.players[0];
    game.store.prompt(game.state, new ChooseCardsPrompt(
      p, GameMessage.CHOOSE_CARD_TO_DISCARD, p.hand, {}, { min: 1, max: 1, allowCancel: false }
    ), () => {
      game.store.prompt(game.state, new ShuffleDeckPrompt(p.id), (order: number[]) => { p.deck.applyOrder(order); });
    });

    const res = replay(game, [
      { actor: 'A', type: 'discard', target: 'h0', owner: 'A' },
      { actor: 'system', type: 'shuffle', order: ['d1', 'd0'] },
    ]);
    expect(res.events.some(e => e.kind === 'shuffled' && e.player === 'A')).toBe(true);
  });
});
