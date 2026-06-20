import { importState, ImportedGame } from '../state-adapter';
import { replay, projectGame } from '../driver';
import {
  NeutralState, LegalAction,
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

const PSY = 'Psychic Energy SVE';
const WATER = 'Water Energy SVE';
const LIGHT = 'Lightning Energy SVE';

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
  return { stack: [{ iid, printing: 'Ralts SIT' }], energy, tools: [], damage, conditions: [], markers: markers() };
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
function firstDecision(game: ImportedGame): LegalAction[] {
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

    // first decision: 3 candidates, no endChoice (fixed count)
    const la = firstDecision(game);
    expect(la.filter(a => a.type === 'choose').length).toBe(3);
    expect(la.some(a => a.type === 'endChoice')).toBe(false);

    const res = replay(game, [
      { actor: 'A', type: 'choose', target: 'h0' },
      { actor: 'A', type: 'choose', target: 'h1' },
    ]);
    expect(captured.map((c: any) => c.fullName)).toEqual([PSY, WATER]);
    expect(res.pending).toBeNull();
    const proj = projectGame(game);
    expect(proj.players.A.hand).toEqual([{ iid: 'h2', printing: LIGHT }]);
    expect(proj.players.A.discard.map(c => c.iid).sort()).toEqual(['h0', 'h1']);
  });

  it('ChooseCards: "up to 2" offers endChoice once min is met and stops early', () => {
    const game = importState(board(
      player({ active: ralts('A-act'), hand: [{ iid: 'h0', printing: PSY }, { iid: 'h1', printing: WATER }] }),
      player({ active: ralts('B-act') }),
    ));
    const p = game.state.players[0];
    let captured: any;
    game.store.prompt(game.state, new ChooseCardsPrompt(
      p, GameMessage.CHOOSE_CARD_TO_DISCARD, p.hand, {}, { min: 1, max: 2, allowCancel: false }
    ), cards => { captured = cards; });

    // decision 1: no endChoice yet (0 < min)
    expect(firstDecision(game).some(a => a.type === 'endChoice')).toBe(false);
    // decision 2 (after 1 pick): endChoice now offered
    const d2 = replay(game, [{ actor: 'A', type: 'choose', target: 'h0' }]).pending!.legalActions;
    expect(d2.some(a => a.type === 'endChoice')).toBe(true);

    const res = replay(game, [{ actor: 'A', type: 'choose', target: 'h0' }, { actor: 'A', type: 'endChoice' }]);
    expect(captured.map((c: any) => c.fullName)).toEqual([PSY]);
    expect(res.pending).toBeNull();
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
    const targets = firstDecision(game).filter(a => a.type === 'choose').map(a => (a as any).target);
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
    expect(res.pending).toBeNull();
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

    // only valid move: from B-active (has damage) to B-bench (can't move onto itself)
    const la = firstDecision(game).filter(a => a.type === 'moveCounter') as any[];
    expect(la).toEqual([{ type: 'moveCounter', from: 'B-act', to: 'B-b0' }]);

    replay(game, [{ actor: 'A', type: 'moveCounter', from: 'B-act', to: 'B-b0' }]);
    expect(captured!.length).toBe(1);
  });

  // ── System-prompt seam (M2/M3) ─────────────────────────────────────────────

  it('surfaces a chained ShuffleDeckPrompt as a system pending and stops (M2/M3 seam)', () => {
    const game = importState(board(
      player({ active: ralts('A-act'), hand: [{ iid: 'h0', printing: PSY }], deck: [{ iid: 'd0', printing: WATER }, { iid: 'd1', printing: PSY }] }),
      player({ active: ralts('B-act') }),
    ));
    const p = game.state.players[0];
    game.store.prompt(game.state, new ChooseCardsPrompt(
      p, GameMessage.CHOOSE_CARD_TO_DISCARD, p.hand, {}, { min: 1, max: 1, allowCancel: false }
    ), () => {
      // the card's callback chains into a deck shuffle (the system actor's job)
      game.store.prompt(game.state, new ShuffleDeckPrompt(p.id), (order: number[]) => { p.deck.applyOrder(order); });
    });

    const res = replay(game, [{ actor: 'A', type: 'choose', target: 'h0' }]);
    expect(res.pending).not.toBeNull();
    expect(res.pending!.actor).toBe('system');
    expect(res.pending!.legalActions[0].type).toBe('shuffle');
    expect((res.pending!.legalActions[0] as any).deck.sort()).toEqual(['d0', 'd1']);
  });
});
