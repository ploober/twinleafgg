import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-791 (B.31): Community Center twm-146 "Once during each player's turn, if that player has already played a Supporter
 * from their hand, they may heal 10 damage from each of their Pokémon." Advanced Player's Rulebook I.B-04: "you can't
 * use the effect of that Stadium if going through the actions of Step 3 below would not change the game state in any
 * way." With none of the player's Pokémon damaged, the heal changes nothing, so the Stadium is neither offered nor
 * usable, and the player keeps their use for later in the turn. Same rule and shape as Celebratory Fanfare (TA-589).
 * The Supporter is actually played (Professor's Research svi-189), not flagged.
 */

const GRASS = 'sve-001';
const STADIUM = 'twm-146';
const RESEARCH = 'svi-189';
const BELLSPROUT = 'asc-004';
const GOTHITA = 'pal-090';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, damage = 0): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: [], tools: [], damage, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function side(tag: string, active: PokemonInPlay, bench: PokemonInPlay[], hand: string[]): PlayerState {
  return { active, bench, hand: hand.map((printing, i) => ({ iid: `${tag}h${i}`, printing })),
    deck: Array.from({ length: 10 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS })),
    discard: [], lostZone: [], prizes: prizes(tag), flags: flags() };
}
function board(activeDamage: number, benchDamage: number, hand: string[] = [RESEARCH], oppDamage = 0): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: { iid: 'st0', printing: STADIUM, owner: 'A' },
    players: {
      A: side('a', mon('a1', BELLSPROUT, activeDamage), [mon('a2', BELLSPROUT, benchDamage)], hand),
      B: side('b', mon('b1', GOTHITA, oppDamage), [], []),
    } };
}
const act = (a: object) => a as unknown as NeutralAction;
const research = act({ actor: 'A', type: 'playSupporter', card: 'ah0' });
const use = act({ actor: 'A', type: 'useStadium' });
const offered = (r: ReturnType<typeof step>) =>
  (r.pending?.legalActions ?? []).some(a => (a as { type: string }).type === 'useStadium');

describe('TA-791 Community Center: a heal that changes nothing is not a use', () => {
  it('Supporter played, nothing damaged: not offered [TA-791 twm-146 offer]', () => {
    const r = step(board(0, 0), [research]);
    expect(r.status).toBe('awaitingAction');
    expect(offered(r)).toBe(false);
  });
  it('Supporter played, nothing damaged: useStadium is refused and the use is not spent [TA-791 twm-146 refuse]', () => {
    const r = step(board(0, 0), [research, use]);
    expect(r.status).toBe('invalidAction');
    expect(r.index).toBe(1);
  });
  it('only the OPPONENT is damaged: still nothing of ours to heal, refused [TA-791 twm-146 opponent]', () => {
    const r = step(board(0, 0, [RESEARCH], 30), [research, use]);
    expect(r.status).toBe('invalidAction');
  });
  it('control: Active damaged, the Stadium heals it and spends the use [TA-791 twm-146 active]', () => {
    const r = step(board(20, 0), [research, use]);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.active!.damage).toBe(10);
    expect(r.state.players.A.flags.stadiumUsedThisTurn).toBe(true);
    expect(offered(r)).toBe(false);
  });
  it('control: only a Benched Pokémon damaged, still usable [TA-791 twm-146 bench]', () => {
    const r0 = step(board(0, 20), [research]);
    expect(offered(r0)).toBe(true);
    const r = step(board(0, 20), [research, use]);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.bench[0].damage).toBe(10);
  });
  it('control: no Supporter played, refused as before [TA-791 twm-146 no-supporter]', () => {
    const r = step(board(20, 0, [GRASS]), [use]);
    expect(r.status).toBe('invalidAction');
    expect(r.state.players.A.active!.damage).toBe(20);
  });
});
