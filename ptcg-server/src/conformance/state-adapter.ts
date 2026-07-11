import { Card } from '../game/store/card/card';
import { PokemonCard } from '../game/store/card/pokemon-card';
import { SpecialCondition } from '../game/store/card/card-types';
import { State, GamePhase, GameWinner } from '../game/store/state/state';
import { Player } from '../game/store/state/player';
import { PokemonCardList } from '../game/store/state/pokemon-card-list';
import { CardList } from '../game/store/state/card-list';
import { StateUtils } from '../game/store/state-utils';
import { Store } from '../game/store/store';
import { ConformanceStoreHandler } from './conformance-store-handler';
import {
  SCHEMA_VERSION, NeutralState, NeutralPlayerId, PlayerState, PlayerFlags,
  PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, ConditionToken, Phase, Outcome, StadiumRef
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

    ps.hand.forEach(ref => player.hand.cards.push(this.materialize(ref)));
    ps.deck.forEach(ref => player.deck.cards.push(this.materialize(ref)));
    ps.discard.forEach(ref => player.discard.cards.push(this.materialize(ref)));
    ps.lostZone.forEach(ref => player.lostzone.cards.push(this.materialize(ref)));

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
    player.retreatedTurn = ps.flags.retreatedThisTurn ? turn : 0;
    player.prizesTakenThisTurn = ps.flags.prizesTakenThisTurn;
    player.prizesTakenLastTurn = ps.flags.prizesTakenLastTurn;
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

function projectPip(ctx: IidContext, slot: PokemonCardList): PokemonInPlay {
  const conditions = slot.specialConditions.map(conditionToToken);
  const markers: PokemonMarkers = {
    playedOnTurn: slot.pokemonPlayedTurn,
    // The following are not tracked per-Pokemon-per-turn by twinleaf yet — deferred to a later
    // milestone (impl doc §4.7). M0 round-trips them at these documented defaults.
    movedToActiveOnTurn: -1,
    damageTakenThisTurn: 0,
    abilitiesUsedThisTurn: [],
    cannotAttackNextTurn: slot.cannotAttackNextTurn,
  };
  const pip: PokemonInPlay = {
    stack: slot.getPokemons().map(c => cardRef(ctx, c)),
    energy: slot.energies.cards.map(c => cardRef(ctx, c)),
    tools: slot.tools.map(c => cardRef(ctx, c)),
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
    retreatedThisTurn: player.retreatedTurn === turn,
    cardsPlayedThisTurn: 0, // deferred: no twinleaf per-turn counter yet
    prizesTakenThisTurn: player.prizesTakenThisTurn,
    prizesTakenLastTurn: player.prizesTakenLastTurn,
    vstarUsed: player.usedVSTAR,
  };
}

function projectPlayer(ctx: IidContext, player: Player, turn: number): PlayerState {
  const prizes: PrizeRef[] = [];
  for (const prize of player.prizes) {
    const card = prize.cards[0];
    if (card === undefined) { continue; }
    prizes.push({ ...cardRef(ctx, card), faceUp: prize.faceUpPrize });
  }
  return {
    active: player.active.getPokemonCard() ? projectPip(ctx, player.active) : null,
    bench: player.bench
      .filter(b => b.getPokemonCard() !== undefined)
      .map(b => projectPip(ctx, b)),
    hand: player.hand.cards.map(c => cardRef(ctx, c)),
    deck: player.deck.cards.map(c => cardRef(ctx, c)),
    // A Trainer mid-resolution is staged in player.supporter (play-trainer-effect.ts) until its
    // effect finishes; the API legitimately pauses there at an externalized flip/choose, and the
    // DTO has no "resolving" zone — so surface the staged card in discard now. It stays observable
    // (card conservation holds) and lands where it heads a moment later. player.supporter is empty
    // at every quiescent non-resolution boundary, so ordinary states are unaffected.
    discard: player.discard.cards.concat(player.supporter.cards).map(c => cardRef(ctx, c)),
    lostZone: player.lostzone.cards.map(c => cardRef(ctx, c)),
    prizes,
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

export function projectState(state: State, ctx: IidContext): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION,
    turn: state.turn,
    activePlayer: indexToPlayerId(state.activePlayer),
    firstPlayer: ctx.firstPlayer, // game constant, echoed from initialState (engine State has no such field)
    phase: PHASE_PROJECT[state.phase] ?? 'main',
    outcome: projectOutcome(state.winner),
    stadium: projectStadium(ctx, state),
    players: {
      A: projectPlayer(ctx, state.players[0], state.turn),
      B: projectPlayer(ctx, state.players[1], state.turn),
    },
    activeEffects: [], // timed effects are deferred (design §6.3); emitted as [] per the contract default
  };
}
