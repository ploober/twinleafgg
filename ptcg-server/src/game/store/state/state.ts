import { Player } from './player';
import { Prompt } from '../prompts/prompt';
import { StateLog } from './state-log';
import { Rules } from './rules';
import { Attack, GameSettings, PokemonCard } from '../..';
import type { Effect } from '../effects/effect';

export enum GamePhase {
  WAITING_FOR_PLAYERS,
  SETUP,
  PLAYER_TURN,
  ATTACK,
  AFTER_ATTACK,
  CHOOSE_PRIZES,
  BETWEEN_TURNS,
  FINISHED,
  DRAW = 8,
}

export enum GameWinner {
  NONE = -1,
  PLAYER_1 = 0,
  PLAYER_2 = 1,
  DRAW = 3
}

export class State {

  public cardNames: string[] = [];

  public logs: StateLog[] = [];

  public rules: Rules = new Rules();

  public prompts: Prompt<any>[] = [];

  public phase: GamePhase = GamePhase.WAITING_FOR_PLAYERS;

  public turn = 0;

  public activePlayer: number = 0;

  public winner: GameWinner = GameWinner.NONE;

  public players: Player[] = [];

  public skipOpponentTurn = false;

  public lastAttack: Attack | null = null;

  public playerLastAttack: { [playerId: number]: { attack: Attack, sourceCard: PokemonCard, turn?: number } } = {};

  /** Prizes owed for KOs dispatched directly by card effects (outside the checkState sweep);
   * drained by the next executeCheckState into its prize-choice prompts. */
  public pendingDirectKoPrizes: { playerNum: number, count: number }[] = [];

  /** CF-74 / §B.53. While an attack pipeline arms this flag, a "when damaged by an attack" Ability
   * (e.g. Shell Spikes) does NOT resolve during the damage step: its `AfterDamageEffect` is queued on
   * `pendingAfterDamage` and drained after `AfterAttackEffect`, so the attack's own trailing effects
   * (e.g. Strafe's "you may switch") resolve first — and before the Knock Out check (the victim is
   * still on the board until checkState). Rulebook order: damage → the attack's other effects →
   * damage-response Abilities → KO (Advanced Rulebook II E-03, #2172). Every damage path that does not
   * arm the flag fires `AfterDamageEffect` immediately, exactly as before, so non-attack damage
   * (Abilities, Trainers, poison) is untouched. */
  public deferAfterDamage: boolean = false;
  public pendingAfterDamage: Effect[] = [];

  /**
   * B.82 (#1834, #2002, #2031): the AttackEffect whose damage step has not started yet. While it is set, a discard of
   * the attacker's own Energy that the attack's text chose is queued on its `afterDamageMoves` (the cards stay
   * attached through the damage), and an Energy choice the attacker is asked is marked `deferredMove`.
   */
  public preDamageAttack?: Effect;

  /**
   * B.82: true while the callback of a `deferredMove` prompt runs (the attacker's pre-damage choice of its own Energy).
   * The generic deferrals (DiscardCardsEffect, MOVE_CARDS) apply only then: B.82 is about CHOSEN cards; a move of ALL
   * the Energy (Phantasmal Barrage, Sonic Ripper) keeps its printed order.
   */
  public inChosenCallback?: boolean;

  public isSuddenDeath?: boolean;

  public benchSizeChangeHandled: boolean = false;

  public gameSettings: GameSettings = new GameSettings();

  /**
   * Monotonic counter for Active ability-lock activation order
   * (Emperor's Eyes vs Bide Barricade / Mischievous Lock "first in wins").
   */
  public abilityLockOrderCounter: number = 0;

  /**
   * When set, newly queued prompts are answered by this player while board
   * perspective stays on the original prompt.playerId (see Prompt.perspectivePlayerId).
   */
  public promptControllerId?: number;
}
