import { Card } from '../game/store/card/card';
import { PokemonCard } from '../game/store/card/pokemon-card';
import { SpecialCondition, SuperType } from '../game/store/card/card-types';
import { State, GamePhase, GameWinner } from '../game/store/state/state';
import { Player } from '../game/store/state/player';
import { PokemonCardList } from '../game/store/state/pokemon-card-list';
import { CardList } from '../game/store/state/card-list';
import { StateUtils } from '../game/store/state-utils';
import { Prompt } from '../game/store/prompts/prompt';
import { Store } from '../game/store/store';
import { ConformanceStoreHandler } from './conformance-store-handler';
import {
  SCHEMA_VERSION, NeutralState, NeutralPlayerId, PlayerState, PlayerFlags,
  PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, ConditionToken, Phase, Outcome, StadiumRef,
  PlayerLastAttacks
} from './neutral-types';

// M0 reuses the test harness's set-loading/registration machinery (the impl doc's
// `ensureCardsRegistered`). A dedicated, non-test card-registry seam replaces this in a later
// milestone; for the headless adapter it is the same CardManager singleton either way.
import { getCardByName, getCardBySetAndNumber, ensureCardsRegistered } from '../sets/tests/test-helpers';
import { toPrinting, isFullName, printingCandidates } from './printing';

/**
 * Resolve a wire `printing` to a fresh twinleaf Card. The conformance form is a set-number
 * (`sit-060`); existing in-process test boards pass a `fullName` ("Ralts SIT"), still accepted for
 * back-compat. `getCardBySetAndNumber` returns the shared registry instance, so re-resolve by name to
 * get a clone (matching the `getCardByName` path, whose result is safe to stamp an `id` on).
 */
function resolveCard(printing: string): Card {
  if (isFullName(printing)) {
    return getCardByName(printing);
  }
  // A `printing` id may name an identity with several printings; load the first one twinleaf has.
  for (const c of printingCandidates(printing)) {
    const found = getCardBySetAndNumber(c.set, c.setNumber);
    if (found !== undefined) {
      return getCardByName(found.fullName);
    }
  }
  throw new Error(`[conformance] no card for printing "${printing}"`);
}

/**
 * The bidirectional iid <-> Card map for one imported game. Card identity is stable across
 * `store.dispatch` (its rollback clone keeps Card instances by reference — deepClone(state,[Card])),
 * so a Map keyed on object identity survives the whole replay. Rebuilt deterministically on each
 * import, so iids are stable across requests (import is a pure function of initialState).
 */
export interface IidContext {
  iidToCard: Map<string, Card>;
  cardToIid: Map<Card, string>;
  /** Import-origin owner (player index 0/1) of each Card, recorded at build time. `Card` has no owner
   *  field, so a decomposer that must re-home a card absent from every zone — e.g. the OrderCards
   *  temp pile (Fortunate Eye peeks the OPPONENT's deck; the prompt owner ≠ the cards' owner) — reads
   *  the source deck from here. Keyed on object identity, so it survives rollback deepClone like the
   *  iid maps above. */
  cardOwner: Map<Card, number>;
  /** The game-constant first player, echoed from `initialState.firstPlayer`. twinleaf's engine `State`
   *  has no first-player field (setup is out of scope), so it is carried here and projected verbatim. */
  firstPlayer: NeutralPlayerId;
}

export interface ImportedGame {
  store: Store;
  handler: ConformanceStoreHandler;
  state: State;
  ctx: IidContext;
}

// ── A/B <-> twinleaf player index convention ──────────────────────────────
// Neutral 'A' is twinleaf player index 0, 'B' is index 1. `firstPlayer` is a game constant the engine
// State doesn't track (setup is out of scope; initialState is post-setup), so it is carried through the
// import context (`IidContext.firstPlayer`) and projected verbatim from `initialState.firstPlayer`.

export function actorIndex(id: NeutralPlayerId): number {
  return id === 'A' ? 0 : 1;
}

function indexToPlayerId(index: number): NeutralPlayerId {
  return index === 0 ? 'A' : 'B';
}

const CONDITION_TO_TOKEN: ReadonlyArray<readonly [SpecialCondition, ConditionToken]> = [
  [SpecialCondition.POISONED, 'poisoned'],
  [SpecialCondition.BURNED, 'burned'],
  [SpecialCondition.ASLEEP, 'asleep'],
  [SpecialCondition.PARALYZED, 'paralyzed'],
  [SpecialCondition.CONFUSED, 'confused'],
];

function tokenToCondition(token: ConditionToken): SpecialCondition {
  const found = CONDITION_TO_TOKEN.find(([, t]) => t === token);
  if (!found) {
    throw new Error(`[conformance] Unknown condition token "${token}"`);
  }
  return found[0];
}

function conditionToToken(condition: SpecialCondition): ConditionToken {
  const found = CONDITION_TO_TOKEN.find(([c]) => c === condition);
  if (!found) {
    throw new Error(`[conformance] Unmapped special condition ${condition}`);
  }
  return found[1];
}

// ── IMPORT: neutral initialState -> twinleaf State ─────────────────────────

function collectPrintings(initial: NeutralState): string[] {
  const out: string[] = [];
  const pip = (p: PokemonInPlay | null) => {
    if (!p) { return; }
    p.stack.forEach(c => out.push(c.printing));
    p.energy.forEach(c => out.push(c.printing));
    p.tools.forEach(c => out.push(c.printing));
  };
  for (const id of ['A', 'B'] as NeutralPlayerId[]) {
    const ps = initial.players[id];
    pip(ps.active);
    ps.bench.forEach(pip);
    ps.hand.forEach(c => out.push(c.printing));
    ps.deck.forEach(c => out.push(c.printing));
    ps.discard.forEach(c => out.push(c.printing));
    ps.lostZone.forEach(c => out.push(c.printing));
    ps.prizes.forEach(c => out.push(c.printing));
  }
  if (initial.stadium) { out.push(initial.stadium.printing); }
  // CF-15: the last-attack source Pokemon must be loadable so its attack can be resolved on ingest,
  // even though it may not sit in any zone (it attacked last turn and could have left play).
  if (initial.playerLastAttack) {
    for (const id of ['A', 'B'] as NeutralPlayerId[]) {
      const la = initial.playerLastAttack[id];
      if (la) { out.push(la.source); }
    }
  }
  return out;
}

class Importer {
  private nextId = 1;
  /** Player index whose zone is currently being built; stamped onto every materialized card as its
   *  import-origin owner (see IidContext.cardOwner). buildPlayer sets it; the stadium passes an
   *  explicit owner. -1 = unknown (not recorded). */
  private owner = -1;
  constructor(private ctx: IidContext) { }

  /** Resolve a printing to a fresh Card instance and register it in the iid + owner maps. */
  materialize(ref: CardRef, owner: number = this.owner): Card {
    const card = resolveCard(ref.printing);
    card.id = this.nextId++;
    if (this.ctx.iidToCard.has(ref.iid)) {
      throw new Error(`[conformance] Duplicate iid "${ref.iid}" in initialState`);
    }
    this.ctx.iidToCard.set(ref.iid, card);
    this.ctx.cardToIid.set(card, ref.iid);
    if (owner >= 0) {
      this.ctx.cardOwner.set(card, owner);
    }
    return card;
  }

  buildPokemonSlot(slot: PokemonCardList, pip: PokemonInPlay): void {
    // Pokemon stack first (so getPokemons() returns [basic..top] in order), then energy, then tools.
    for (const ref of pip.stack) {
      slot.cards.push(this.materialize(ref));
    }
    const top = slot.getPokemonCard();
    if (top instanceof PokemonCard) {
      slot.hp = top.hp;
    }
    slot.damage = pip.damage;
    slot.specialConditions = pip.conditions.map(tokenToCondition);
    if (pip.poisonDamagePerTurn !== undefined) {
      slot.poisonDamage = pip.poisonDamagePerTurn;
    }
    slot.pokemonPlayedTurn = pip.markers.playedOnTurn;
    slot.cannotAttackNextTurn = pip.markers.cannotAttackNextTurn;

    for (const ref of pip.energy) {
      const energy = this.materialize(ref);
      slot.cards.push(energy);
      slot.energies.cards.push(energy);
    }
    for (const ref of pip.tools) {
      const tool = this.materialize(ref);
      // Tools live ONLY in `.tools`, never in `.cards` — this mirrors the real attach path
      // (AttachPokemonToolEffect splices the tool out of `.cards`). If a tool is also left in
      // `.cards`, store.propagateEffect (which walks `.cards` AND `.tools`) reduces the tool's
      // effect twice, so e.g. a pre-placed Muscle Band would add +40 instead of +20.
      slot.tools.push(tool);
    }
  }

  buildPlayer(index: number, ps: PlayerState, turn: number): Player {
    this.owner = index; // every card materialized below is owned by this player
    const player = new Player();
    player.id = index + 1;
    // Name = neutral id so game logs carry a recoverable actor (display-only in the engine;
    // the event mapper maps params.name -> 'A'/'B').
    player.name = indexToPlayerId(index);

    // 5 bench slots (matching production/test setup), occupied ones filled.
    player.bench = [];
    for (let i = 0; i < 5; i++) {
      const bench = new PokemonCardList();
      bench.isPublic = true;
      player.bench.push(bench);
    }

    player.active.isPublic = true;
    player.discard.isPublic = true;
    player.lostzone.isPublic = true;
    player.stadium.isPublic = true;
    player.supporter.isPublic = true;

    if (ps.active) {
      this.buildPokemonSlot(player.active, ps.active);
    }
    for (let i = 0; i < ps.bench.length && i < player.bench.length; i++) {
      this.buildPokemonSlot(player.bench[i], ps.bench[i]);
    }

    // CF-16: ingest `markers.movedToActiveOnTurn`. The runtime gate MOVED_TO_ACTIVE_THIS_TURN reads
    // `player.movedToActiveThisTurn` (a list of card ids, cleared at each turn start; prefabs.ts:213),
    // so a marker equal to the CURRENT turn means "this Pokemon moved to the Active Spot this turn" —
    // add its top card's id (and set the PokemonCard's cached flag, mirroring check-effect.ts:500-504).
    // A marker < turn (moved on an earlier turn) or the -1 default did NOT move this turn → not added.
    const ingestMovedToActive = (slot: PokemonCardList, pip: PokemonInPlay | null) => {
      if (pip === null || pip.markers.movedToActiveOnTurn !== turn) { return; }
      const top = slot.getPokemonCard();
      if (top instanceof PokemonCard) {
        if (!player.movedToActiveThisTurn.includes(top.id)) {
          player.movedToActiveThisTurn.push(top.id);
        }
        top.movedToActiveThisTurn = true;
      }
    };
    ingestMovedToActive(player.active, ps.active);
    for (let i = 0; i < ps.bench.length && i < player.bench.length; i++) {
      ingestMovedToActive(player.bench[i], ps.bench[i]);
    }

    ps.hand.forEach(ref => player.hand.cards.push(this.materialize(ref)));
    ps.deck.forEach(ref => player.deck.cards.push(this.materialize(ref)));
    player.deck.zoneTag = 'deck'; // CF-61: piles moved out of this list are stamped deck-sourced
    ps.discard.forEach(ref => player.discard.cards.push(this.materialize(ref)));
    ps.lostZone.forEach(ref => player.lostzone.cards.push(this.materialize(ref)));
    // CF-42: round-trip the staging zone. Optional on ingest — boards authored before 0.5.0, and
    // every board a human writes, simply omit it. Without this, export->import would silently DROP a
    // staged Trainer and break card conservation across the round trip.
    (ps.resolving ?? []).forEach(ref => player.supporter.cards.push(this.materialize(ref)));

    player.prizes = ps.prizes.map(ref => {
      const list = new CardList();
      list.isSecret = true;
      list.faceUpPrize = ref.faceUp;
      list.cards.push(this.materialize(ref));
      return list;
    });

    // Per-turn / per-game flags -> twinleaf counters (each engine maps its bookkeeping; design §6.2).
    player.energyPlayedTurn = ps.flags.energyAttachedThisTurn ? turn : 0;
    player.supporterTurn = ps.flags.supporterPlayedThisTurn ? 1 : 0;   // counter, not a turn number
    player.stadiumPlayedTurn = ps.flags.stadiumPlayedThisTurn ? turn : 0;
    player.stadiumUsedTurn = ps.flags.stadiumUsedThisTurn ? turn : 0;   // CF-37
    player.retreatedTurn = ps.flags.retreatedThisTurn ? turn : 0;
    player.prizesTakenThisTurn = ps.flags.prizesTakenThisTurn;
    player.prizesTakenLastTurn = ps.flags.prizesTakenLastTurn;
    // CF-17: cumulative prizes taken this game (prize-count-scaled cost/effect readers depend on it,
    // e.g. Radiant Charizard "Excited Heart"). Default to twinleaf's NATIVE semantics — a real counter
    // that is 0 on a fresh import — so the adapter stays faithful to its own engine (the native-vs-
    // adapter equivalence bench asserts exactly this). Do NOT derive 6−pile here: a synthetic board can
    // legitimately be dealt fewer than 6 prizes without any having been taken, and 6−pile would then
    // over-count (it broke 14 equivalence specs). Rotomancer keeps no counter and DERIVES 6−pile, so a
    // cross-engine scenario that needs a mid-game prize count must set flags.prizesTaken EXPLICITLY and
    // keep pile = 6 − prizesTaken (the cf17-excited-heart scenarios do); both engines then agree.
    player.prizesTaken = ps.flags.prizesTaken ?? 0;
    player.usedVSTAR = ps.flags.vstarUsed;
    // `cardsPlayedThisTurn` has no twinleaf per-turn counter yet — deferred (see projectFlags).

    return player;
  }
}

const PHASE_IMPORT: Record<Phase, GamePhase> = {
  setup: GamePhase.SETUP,
  main: GamePhase.PLAYER_TURN,
  checkup: GamePhase.BETWEEN_TURNS,
  gameOver: GamePhase.FINISHED,
};

const OUTCOME_IMPORT: Record<Outcome, GameWinner> = {
  ongoing: GameWinner.NONE,
  winA: GameWinner.PLAYER_1,
  winB: GameWinner.PLAYER_2,
  tie: GameWinner.DRAW,
};

/** Pre-load every set referenced by `initialState`, tolerating id, set-number, and fullName printings. */
function ensurePrintingsLoaded(printings: string[]): void {
  const fullNames: string[] = [];
  for (const printing of printings) {
    if (isFullName(printing)) {
      fullNames.push(printing);
      continue;
    }
    for (const c of printingCandidates(printing)) {
      if (getCardBySetAndNumber(c.set, c.setNumber) !== undefined) {
        break; // loaded the set twinleaf actually has for this id
      }
    }
  }
  ensureCardsRegistered(fullNames);
}

/**
 * CF-15: reconstruct `state.playerLastAttack` (keyed by twinleaf player.id) from the wire record.
 * The source printing resolves to a fresh PokemonCard whose named attack carries the real
 * cost/damage/effect (and the copycatAttack/gxAttack flags COPY_OPPONENTS_LAST_ATTACK checks). The
 * card need not be in play — the copy path calls `sourceCard.reduceEffect` directly (prefabs.ts:638).
 */
function ingestPlayerLastAttack(state: State, initial: NeutralState): void {
  if (!initial.playerLastAttack) { return; }
  for (const id of ['A', 'B'] as NeutralPlayerId[]) {
    const la = initial.playerLastAttack[id];
    if (!la) { continue; }
    const sourceCard = resolveCard(la.source);
    if (!(sourceCard instanceof PokemonCard)) {
      throw new Error(`[conformance] playerLastAttack.source "${la.source}" is not a Pokemon`);
    }
    const attack = sourceCard.attacks.find(a => a.name === la.name);
    if (attack === undefined) {
      throw new Error(`[conformance] playerLastAttack: "${la.source}" has no attack "${la.name}"`);
    }
    const playerId = state.players[actorIndex(id)].id;
    state.playerLastAttack[playerId] = { attack, sourceCard, turn: la.turn };
  }
}

export function importState(initial: NeutralState): ImportedGame {
  ensurePrintingsLoaded(collectPrintings(initial));

  const ctx: IidContext = { iidToCard: new Map(), cardToIid: new Map(), cardOwner: new Map(), firstPlayer: initial.firstPlayer };
  const importer = new Importer(ctx);

  const handler = new ConformanceStoreHandler();
  const store = new Store(handler);
  handler.setStore(store);

  const state = new State();
  state.phase = PHASE_IMPORT[initial.phase];
  state.turn = initial.turn;
  state.activePlayer = actorIndex(initial.activePlayer);
  state.winner = OUTCOME_IMPORT[initial.outcome];

  const playerA = importer.buildPlayer(0, initial.players.A, initial.turn);
  const playerB = importer.buildPlayer(1, initial.players.B, initial.turn);
  state.players = [playerA, playerB];

  if (initial.stadium) {
    const stadiumOwner = actorIndex(initial.stadium.owner);
    state.players[stadiumOwner].stadium.cards.push(importer.materialize(initial.stadium, stadiumOwner));
  }

  ingestPlayerLastAttack(state, initial); // CF-15

  store.state = state;
  return { store, handler, state, ctx };
}

// ── PROJECT: twinleaf State -> neutral observable projection ───────────────

const PHASE_PROJECT: Record<number, Phase> = {
  [GamePhase.SETUP]: 'setup',
  [GamePhase.PLAYER_TURN]: 'main',
  [GamePhase.ATTACK]: 'main',
  [GamePhase.AFTER_ATTACK]: 'main',
  [GamePhase.CHOOSE_PRIZES]: 'main',
  [GamePhase.BETWEEN_TURNS]: 'checkup',
  [GamePhase.FINISHED]: 'gameOver',
};

function projectOutcome(winner: GameWinner): Outcome {
  switch (winner) {
    case GameWinner.PLAYER_1: return 'winA';
    case GameWinner.PLAYER_2: return 'winB';
    case GameWinner.DRAW: return 'tie';
    default: return 'ongoing';
  }
}

function cardRef(ctx: IidContext, card: Card): CardRef {
  const iid = ctx.cardToIid.get(card);
  if (iid === undefined) {
    throw new Error(`[conformance] Card "${card.fullName}" (id ${card.id}) has no iid mapping`);
  }
  return { iid, printing: toPrinting(card) };
}

function projectPip(ctx: IidContext, slot: PokemonCardList, player: Player, turn: number): PokemonInPlay {
  const conditions = slot.specialConditions.map(conditionToToken);
  // CF-16: project the real "moved to Active this turn" marker. The runtime tracks membership in
  // `player.movedToActiveThisTurn` (cleared at turn start), so a member moved THIS turn → emit `turn`;
  // otherwise the -1 default (moved on an earlier turn / since setup / never). Round-trips the ingest.
  const top = slot.getPokemonCard();
  const movedToActiveOnTurn = (top !== undefined && player.movedToActiveThisTurn.includes(top.id)) ? turn : -1;
  const markers: PokemonMarkers = {
    playedOnTurn: slot.pokemonPlayedTurn,
    movedToActiveOnTurn,
    // The following are not tracked per-Pokemon-per-turn by twinleaf yet — deferred to a later
    // milestone (impl doc §4.7). M0 round-trips them at these documented defaults.
    damageTakenThisTurn: 0,
    abilitiesUsedThisTurn: [],
    cannotAttackNextTurn: slot.cannotAttackNextTurn,
  };
  // An "attach this card to 1 of your Pokémon" Trainer (PlusPower bs-084, Weakness Guard aq-141,
  // Defender …) lives in slot.cards without being a Pokémon, an Energy or a registered Tool, so the
  // three typed projections above it all skip it and the card VANISHED from the wire while attached
  // (G-44 residual, single-engine conservation). It is attached to this Pokémon, which is what the
  // `tools` slot means on the wire; project it there after the real Tools. TRAINERS ONLY, and only
  // while the card is in no settled zone of its player: an Energy that an attack is returning to the
  // deck (Sonic Ripper por-055) can still sit in slot.cards after it left slot.energies and is already
  // in player.deck — a stale membership, not an attachment — and projecting it here would double it.
  const pokemons = slot.getPokemons();
  const settled = [player.deck, player.hand, player.discard, player.lostzone];
  const attachedOther = slot.cards.filter(c =>
    c.superType === SuperType.TRAINER
    && !pokemons.includes(c as PokemonCard) && !slot.tools.includes(c) && !slot.energies.cards.includes(c)
    && !settled.some(z => z.cards.includes(c)));
  const pip: PokemonInPlay = {
    stack: pokemons.map(c => cardRef(ctx, c)),
    energy: slot.energies.cards.map(c => cardRef(ctx, c)),
    tools: [...slot.tools, ...attachedOther].map(c => cardRef(ctx, c)),
    damage: slot.damage,
    conditions,
    markers,
  };
  if (conditions.includes('poisoned') && slot.poisonDamage !== 10) {
    pip.poisonDamagePerTurn = slot.poisonDamage;
  }
  return pip;
}

function projectFlags(player: Player, turn: number): PlayerFlags {
  return {
    // `supporterTurn` is a per-turn COUNTER (0 = none played this turn; += 1 on each Supporter play;
    // reset to 0 each turn; the one-per-turn rule gates on `=== 0`) — NOT a turn number like the other
    // three flags. So the flag is "> 0", not "=== turn" (which compared the counter 1 to the turn no.).
    supporterPlayedThisTurn: player.supporterTurn > 0,
    energyAttachedThisTurn: player.energyPlayedTurn === turn,
    stadiumPlayedThisTurn: player.stadiumPlayedTurn === turn,
    // CF-37: emitted only when spent (optional field — same omit-the-default treatment as
    // `prizesTaken`, so the pre-CF-37 fixtures round-trip unchanged).
    ...(player.stadiumUsedTurn === turn ? { stadiumUsedThisTurn: true } : {}),
    retreatedThisTurn: player.retreatedTurn === turn,
    cardsPlayedThisTurn: 0, // deferred: no twinleaf per-turn counter yet
    prizesTakenThisTurn: player.prizesTakenThisTurn,
    prizesTakenLastTurn: player.prizesTakenLastTurn,
    // CF-17 / CF-48: cumulative prizes taken (has live readers, unlike the per-turn tallies).
    // ALWAYS EMITTED, including the 0. It used to be omitted while zero, to round-trip symmetrically
    // with the `?? 0` ingest — but symmetry on OUR wire is not the property that matters, because
    // rotomancer always emits it. Absent and `0` are the same board and a different wire, so anything
    // keyed on presence (or any consumer reading `flags.prizesTaken` without a default) splits the two
    // engines on every board where no Prize has yet been taken, and CF-48's comparison had to stay
    // switched off for it. A projected flags object that omits a DEFINED field is the weaker contract,
    // which is why ours is the side that moved. Ingest still defaults (`?? 0`), so seeded boards that
    // predate this and omit the field are unaffected.
    prizesTaken: player.prizesTaken ?? 0,
    vstarUsed: player.usedVSTAR,
  };
}

function projectPlayer(ctx: IidContext, player: Player, turn: number,
    resolvingExtra: Card[] = [], deckTopExtra: Card[] = []): PlayerState {
  // Dedup the look-pile extras against themselves (one pile is referenced by both a ChooseCards and an
  // AttachEnergy prompt during Waitress, arriving twice). The cross-zone dedup — a pile card that is
  // actually still in some settled zone (Iris's Fighting Spirit selects from the deck; an opponent-peek
  // pile holds the OTHER player's cards) or that a decomposer's fixupProjection re-homes — is applied
  // GLOBALLY by pruneResolvingDuplicates, which sees every player's zones and runs both at the end of
  // projectState and after the fixups in step(). A per-player filter here would miss the cross-player
  // case, so it is deliberately not done.
  const resolvingSeen = new Set<string>();
  const resolvingExtraKept = resolvingExtra.filter(c => {
    const iid = ctx.cardToIid.get(c);
    if (iid === undefined || resolvingSeen.has(iid)) { return false; }
    resolvingSeen.add(iid);
    return true;
  });
  // CF-61 (pinned 2026-09-07, option 1): a detached pile whose cards came FROM this player's deck (a
  // "look at the top/bottom N" window) projects at the TOP of `deck`, in pile order, ahead of the
  // un-looked remainder — rotomancer's shape, and the printed text's (the cards are still deck cards
  // until picked). `resolving` keeps the CF-42 meaning. Dedup within the pile here; the cross-zone
  // prune (a pile card a fixupProjection re-homed, or one still in a settled zone) is global, below.
  const deckTopSeen = new Set<string>();
  const deckTopKept = deckTopExtra.filter(c => {
    const iid = ctx.cardToIid.get(c);
    if (iid === undefined || deckTopSeen.has(iid) || resolvingSeen.has(iid)) { return false; }
    deckTopSeen.add(iid);
    return true;
  });

  const prizes: PrizeRef[] = [];
  for (const prize of player.prizes) {
    const card = prize.cards[0];
    if (card === undefined) { continue; }
    prizes.push({ ...cardRef(ctx, card), faceUp: prize.faceUpPrize });
  }
  return {
    active: player.active.getPokemonCard() ? projectPip(ctx, player.active, player, turn) : null,
    bench: player.bench
      .filter(b => b.getPokemonCard() !== undefined)
      .map(b => projectPip(ctx, b, player, turn)),
    hand: player.hand.cards.map(c => cardRef(ctx, c)),
    deck: [...deckTopKept, ...player.deck.cards].map(c => cardRef(ctx, c)),
    discard: player.discard.cards.map(c => cardRef(ctx, c)),
    lostZone: player.lostzone.cards.map(c => cardRef(ctx, c)),
    prizes,
    // CF-42 — a Trainer mid-resolution is staged in player.supporter (play-trainer-effect.ts) until
    // its effect finishes, and the API legitimately pauses there at an externalized flip/choose.
    //
    // This USED to be folded into `discard` because the DTO had no zone for it. The fold kept card
    // conservation, but the projection asserted something #919 forbids, and because the projection
    // was the UNION of the two zones an engine that correctly DEFERS the discard and one that
    // WRONGLY discards early produced a byte-identical state — the harness could not detect a #919
    // violation in either engine, by construction. Schema 0.5.0 added the zone; this is it.
    //
    // CF-42 GENERALISED (G-44 root cause): a "look at the top N of your deck" effect (Waitress
    // asc-215, Grimsley's Move pfl-090, Recon Directive asc-159 …) does `deck.moveTo(temp, N)` into a
    // LOCAL CardList that no settled zone holds, then pauses at a ChooseCardsPrompt/AttachEnergyPrompt
    // over it. Those cards are IN PLAY, not gone — `resolvingExtra` carries them (from the active
    // prompt's temp pile, see detachedResolvingCards) so single-engine conservation holds through the
    // pause instead of reading N cards as vanished.
    resolving: [...player.supporter.cards, ...resolvingExtraKept].map(c => cardRef(ctx, c)),
    flags: projectFlags(player, turn),
  };
}

function projectStadium(ctx: IidContext, state: State): StadiumRef | null {
  const stadiumCard = StateUtils.getStadiumCard(state);
  if (!stadiumCard) { return null; }
  const ownerIndex = state.players.findIndex(p => p.stadium.cards.includes(stadiumCard));
  if (ownerIndex === -1) { return null; }
  return { ...cardRef(ctx, stadiumCard), owner: indexToPlayerId(ownerIndex) };
}

/**
 * CF-15: project `state.playerLastAttack` (keyed by twinleaf player.id) back to the wire shape
 * (keyed A/B, source printing + attack name + turn). Undefined when neither side has a record, so
 * the optional field is omitted for the overwhelming majority of boards (no churn, round-trips ingest).
 */
function projectPlayerLastAttack(state: State): PlayerLastAttacks | undefined {
  const out: PlayerLastAttacks = {};
  for (const index of [0, 1]) {
    const player = state.players[index];
    const la = state.playerLastAttack[player.id];
    if (la && la.attack && la.sourceCard) {
      out[indexToPlayerId(index)] = { source: toPrinting(la.sourceCard), name: la.attack.name, turn: la.turn };
    }
  }
  return (out.A || out.B) ? out : undefined;
}

/**
 * basic iid → the slot's DISPLAY name (stack top), for attributing log targets (TA-252). Twinleaf's
 * damage logs name their target by the top card's display name — ambiguous across identical
 * printings, which is why KO COUNTING never matches on names (see events.ts). Attribution is the
 * one place a name is safe: the consumer requires an exactly-one match among the KO'd and skips
 * otherwise, so an ambiguous name degrades to the old behavior instead of guessing.
 */
export function basicIidDisplayNames(state: State, ctx: IidContext): Map<string, string> {
  const out = new Map<string, string>();
  for (const player of state.players) {
    for (const slot of [player.active, ...player.bench]) {
      const pokemons = slot.getPokemons();
      const top = slot.getPokemonCard();
      if (pokemons.length > 0 && top !== undefined) {
        const iid = ctx.cardToIid.get(pokemons[0]);
        if (iid !== undefined) {
          out.set(iid, top.name);
        }
      }
    }
  }
  return out;
}

/**
 * iid → display name for EVERY card the game knows, not just basic Pokemon. CF-60 forbids minting, so
 * `ctx.iidToCard` holds every card for the whole game (materialized once at initialState), which is why
 * this can name an energy/tool/evolution card by its iid at any step. Used by the observed-tier
 * derivations in events.ts (energyAttached/toolAttached/evolved) to carry the receiving Pokemon's basic
 * iid (the `pokemon` field is an iid everywhere on the wire, CF-60) alongside the attached/evolution
 * card's display name (the `card` field, a card type's name).
 */
export function allIidNames(ctx: IidContext): Map<string, string> {
  const out = new Map<string, string>();
  for (const [iid, card] of ctx.iidToCard) {
    out.set(iid, card.name);
  }
  return out;
}

/** The temp look pile an active prompt operates over, if any — the two field names it may carry. */
function promptTempPile(prompt: Prompt<unknown>): CardList | undefined {
  const p = prompt as unknown as { cards?: unknown; cardList?: unknown };
  if (p.cards instanceof CardList) { return p.cards; }
  if (p.cardList instanceof CardList) { return p.cardList; }
  return undefined;
}

/**
 * Per-player-index cards that are staged in an active prompt's temp pile but held in NO settled zone
 * — the "look at top N" limbo (Waitress `deck.moveTo(temp, 6)` then a ChooseCardsPrompt over `temp`).
 * CF-42 generalised: they are in play, so they belong in `resolving`, not vanished. Attributed to the
 * prompt's owning player; a pile card that still sits in a real zone (a prompt over the hand/discard)
 * is excluded, since it is already projected there.
 */
function detachedResolvingCards(state: State): { resolving: Card[][]; deckTop: Card[][] } {
  // Collect every card referenced by an active prompt's temp pile. NO settled-zone filter here:
  // pruneResolvingDuplicates applies it against the SAME snapshot it projects (a card can be back in
  // the deck while the prompt still references it), which is the only place the filter is guaranteed
  // consistent with the projected zones.
  //
  // CF-61: a pile stamped `fromZoneTag === 'deck'` (CardList.moveTo/moveCardsTo out of a tagged deck)
  // is a deck window and goes to `deckTop` of the deck's OWNER — resolved through `fromZoneRef` up the
  // prototype chain (deepClone builds clones with Object.create(source), so a cloned deck's chain
  // reaches the original) and falling back to the prompt's owner. Any other pile keeps the CF-42 home.
  const resolving: Card[][] = state.players.map(() => []);
  const deckTop: Card[][] = state.players.map(() => []);
  if (state.prompts.length === 0) { return { resolving, deckTop }; }
  const sameList = (a: object | undefined, b: object): boolean => {
    for (let x: object | null = a ?? null; x !== null && x !== Object.prototype; x = Object.getPrototypeOf(x)) {
      if (x === b) { return true; }
    }
    for (let y: object | null = b; y !== null && y !== Object.prototype; y = Object.getPrototypeOf(y)) {
      if (y === a) { return true; }
    }
    return false;
  };
  for (const prompt of state.prompts) {
    const pile = promptTempPile(prompt);
    if (pile === undefined) { continue; }
    const promptOwner = state.players.findIndex(p => p.id === prompt.playerId);
    if (promptOwner === -1) { continue; }
    if (pile.fromZoneTag === 'deck') {
      const ref = (pile as unknown as { fromZoneRef?: object }).fromZoneRef;
      let owner = state.players.findIndex(p => sameList(ref, p.deck));
      if (owner === -1) { owner = promptOwner; }
      deckTop[owner].push(...pile.cards);
    } else {
      resolving[promptOwner].push(...pile.cards);
    }
  }
  return { resolving, deckTop };
}

/**
 * I1 guard on a wire state: a `resolving` card whose iid appears in ANY other zone of EITHER player is
 * a duplicate and is dropped from `resolving`. The look-pile projection stages a mid-effect card into
 * `resolving`, but the same card may still sit in a settled zone — the prompt selects from the deck
 * without moving it (Iris), the pile is the OPPONENT's cards (a look-at-opponent effect: prompt owner
 * ≠ card owner), or a decomposer's `fixupProjection` (CF-1) re-homes it into the deck AFTER projection
 * (Waitress's "shuffle the rest back"). Global by design — the cross-player case needs both players'
 * zones. The settled zone is authoritative; resolving yields. Conservation holds: still projected once.
 * Idempotent, so it runs at the end of projectState and again after the fixups in step().
 */
export function pruneResolvingDuplicates(state: NeutralState): void {
  // CF-61: `deck` may now carry a projected look window (deck-sourced pile cards). Two guards, in
  // order: (1) a deck entry whose iid sits in a NON-deck settled zone — a fixupProjection put a picked
  // window card into the hand — yields to that zone; (2) `deck` is deduped by iid (the window copy and
  // a re-homed copy of the same card, Waitress's "shuffle the rest back"). Then `resolving` yields to
  // everything settled, deck included, exactly as before.
  const settled = new Set<string>();
  const add = (cards: { iid: string }[]) => cards.forEach(c => settled.add(c.iid));
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    const p = state.players[who];
    for (const slot of [p.active, ...p.bench]) {
      if (slot) { add(slot.stack); add(slot.energy); add(slot.tools); }
    }
    add(p.hand); add(p.discard); add(p.lostZone);
    p.prizes.forEach(pc => settled.add(pc.iid));
  }
  if (state.stadium) { settled.add(state.stadium.iid); }
  const elsewhere = new Set<string>(settled);
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    const p = state.players[who];
    const seen = new Set<string>();
    p.deck = p.deck.filter(c => {
      if (settled.has(c.iid) || seen.has(c.iid)) { return false; }
      seen.add(c.iid);
      return true;
    });
    add(p.deck);
    p.deck.forEach(c => elsewhere.add(c.iid));
  }
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    const p = state.players[who];
    if (p.resolving && p.resolving.length > 0) {
      p.resolving = p.resolving.filter(c => !elsewhere.has(c.iid));
    }
  }
}

export function projectState(state: State, ctx: IidContext): NeutralState {
  const lastAttack = projectPlayerLastAttack(state); // CF-15
  const detached = detachedResolvingCards(state);
  const out: NeutralState = {
    schemaVersion: SCHEMA_VERSION,
    turn: state.turn,
    activePlayer: indexToPlayerId(state.activePlayer),
    firstPlayer: ctx.firstPlayer, // game constant, echoed from initialState (engine State has no such field)
    phase: PHASE_PROJECT[state.phase] ?? 'main',
    outcome: projectOutcome(state.winner),
    stadium: projectStadium(ctx, state),
    players: {
      A: projectPlayer(ctx, state.players[0], state.turn, detached.resolving[0], detached.deckTop[0]),
      B: projectPlayer(ctx, state.players[1], state.turn, detached.resolving[1], detached.deckTop[1]),
    },
    // CF-15: OMIT the key entirely when neither side has a record — the field is optional, not nullable,
    // so `playerLastAttack: undefined` would still add the property and fail an exact-shape assertion.
    ...(lastAttack ? { playerLastAttack: lastAttack } : {}),
    activeEffects: [], // timed effects are deferred (design §6.3); emitted as [] per the contract default
  };
  // Drop any look-pile card from `resolving` that is really still in a settled zone (Iris selects in
  // place; an opponent-peek pile holds the other player's cards). The step() caller re-runs this after
  // fixupProjection, which can re-home a pile card into the deck (Waitress). Idempotent.
  pruneResolvingDuplicates(out);
  projectOrphans(out, ctx);
  return out;
}

/**
 * Conservation by construction (G-44 completion, the general case): every card the game knows is in
 * `ctx.iidToCard` (materialized once, CF-60 never mints), so any card that the projection above put in
 * NO zone is a card the engine is holding somewhere the adapter cannot see — a closure-local CardList
 * that no active prompt references (Rotom Dex bus-122 moves the top 4 into a local pile and then asks a
 * ConfirmPrompt, which carries no cards), or any future staging idiom. Such a card is IN PLAY and
 * mid-resolution, so it belongs in its owner's `resolving`, not vanished. Owner = the seeded owner
 * (`ctx.cardOwner`, the player whose initialState carried it). Runs AFTER pruneResolvingDuplicates so a
 * card is never both pruned and re-added; the step() caller's post-fixup prune only ever REMOVES, so an
 * orphan added here stays projected exactly once.
 */
export function projectOrphans(state: NeutralState, ctx: IidContext): void {
  const seen = new Set<string>();
  const add = (cards: { iid: string }[]) => cards.forEach(c => seen.add(c.iid));
  for (const who of ['A', 'B'] as NeutralPlayerId[]) {
    const p = state.players[who];
    for (const slot of [p.active, ...p.bench]) {
      if (slot) { add(slot.stack); add(slot.energy); add(slot.tools); }
    }
    add(p.hand); add(p.deck); add(p.discard); add(p.lostZone); add(p.resolving ?? []);
    p.prizes.forEach(pc => seen.add(pc.iid));
  }
  if (state.stadium) { seen.add(state.stadium.iid); }
  for (const [iid, card] of ctx.iidToCard) {
    if (seen.has(iid)) { continue; }
    const ownerIndex = ctx.cardOwner.get(card);
    const who: NeutralPlayerId = ownerIndex === 1 ? 'B' : 'A';
    const p = state.players[who];
    p.resolving = [...(p.resolving ?? []), { iid, printing: toPrinting(card) }];
    seen.add(iid);
  }
}
