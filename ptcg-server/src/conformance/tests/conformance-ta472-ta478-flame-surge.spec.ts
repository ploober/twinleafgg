import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * Chi-Yu ex pal-040 Flame Surge: "Choose up to 3 of your Benched Pokémon. For each of those Pokémon, search your
 * deck for a Basic [R] Energy card and attach it to that Pokémon. Then, shuffle your deck."
 *
 * TA-472 — the rider resolved BEFORE the 100 base damage; #649 / #543: attack effects apply after damage.
 * TA-478 — the printed recipient decision ("choose up to 3 of your Benched Pokémon", a CF-4 aggregate) was folded
 *          into one AttachEnergyPrompt over (card, target) pairs; it is its own decision, followed by one search per
 *          recipient with the target fixed (min 0: a search may fail to find, A.9).
 * B.44 — "for each of those Pokémon, search" is gated by the choice: zero recipients = no search = no shuffle; a
 *          performed search (even one that finds nothing) owes the shuffle.
 *
 * Mutation guards: move the rider back to WAS_ATTACK_USED and the damage cell goes red; restore the folded
 * AttachEnergyPrompt and the recipient cells go red.
 */

const CHI_YU = 'pal-040';
const MUNKIDORI = 'twm-095';
const FIRE = 'sve-002';
const GRASS = 'sve-001';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, energy: string[] = []): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })), tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function board(): NeutralState {
  const A: PlayerState = { active: mon('a0', CHI_YU, [FIRE, FIRE]), bench: [mon('bb0', MUNKIDORI), mon('bb1', MUNKIDORI)],
    hand: [{ iid: 'ah0', printing: GRASS }],
    deck: [{ iid: 'ad0', printing: FIRE }, { iid: 'ad1', printing: FIRE }, { iid: 'ad2', printing: FIRE }, { iid: 'ad3', printing: GRASS }],
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b0', MUNKIDORI), bench: [], hand: [], deck: [{ iid: 'bd0', printing: GRASS }],
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 5, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const attack = act({ actor: 'A', type: 'declareAttack', source: 'a0', name: 'Flame Surge' });
const choose = (t: string) => act({ actor: 'A', type: 'choose', target: t });
const stop = act({ actor: 'A', type: 'confirm', value: false });
const attach = (c: string, t: string) => act({ actor: 'A', type: 'attachEnergy', card: c, target: t });

function legal(r: ReturnType<typeof step>): string[] {
  const p = (r as any).pending;
  return p ? p.legalActions.map((a: any) => [a.type, a.card, a.target, a.value].filter(x => x !== undefined && x !== null).join(':')).sort() : [];
}
function energyOf(r: ReturnType<typeof step>, iid: string): string[] {
  const slot = r.state.players.A.bench.find(s => s.stack.some(c => c.iid === iid));
  return slot ? slot.energy.map(e => e.iid) : [];
}

describe('TA-472 / TA-478 Chi-Yu ex Flame Surge', () => {
  it('the recipients are chosen before the 100 (Step D); the searches come after it [TA-671 pal-040, supersedes TA-472]', () => {
    // TA-671 / B.89 (1), B.101 (2): "Choose up to 3 of your Benched Pokemon" is a Step-D choice; TA-472's "damage before
    // the first rider decision" still holds for the searches.
    const r = step(board(), [attack]);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.B.active!.damage).toBe(0);
    const r2 = step(board(), [attack, choose('bb0'), choose('bb1')]);
    expect(r2.state.players.B.active!.damage).toBe(100);
  });

  it('the first rider decision is the recipient pick: choose a Benched Pokemon or stop [TA-478 pal-040]', () => {
    const r = step(board(), [attack]);
    expect(legal(r)).toEqual(['choose:bb0', 'choose:bb1', 'confirm:false']);
  });

  it('each chosen recipient gets its own search, target fixed, and the search may fail to find [TA-478 pal-040]', () => {
    const r = step(board(), [attack, choose('bb0'), choose('bb1')]);
    expect(legal(r)).toEqual(['attachEnergy:ad0:bb0', 'attachEnergy:ad1:bb0', 'attachEnergy:ad2:bb0', 'confirm:false']);
    const r2 = step(board(), [attack, choose('bb0'), choose('bb1'), attach('ad1', 'bb0')]);
    expect(legal(r2)).toEqual(['attachEnergy:ad0:bb1', 'attachEnergy:ad2:bb1', 'confirm:false']);
    const r3 = step(board(), [attack, choose('bb0'), choose('bb1'), attach('ad1', 'bb0'), attach('ad2', 'bb1')]);
    expect(energyOf(r3, 'bb0')).toEqual(['ad1']);
    expect(energyOf(r3, 'bb1')).toEqual(['ad2']);
    expect(JSON.stringify((r3 as any).pending)).toContain('shuffle');
  });

  it('a performed search that finds nothing still shuffles (B.44 / #2303) [TA-478 pal-040]', () => {
    const r = step(board(), [attack, choose('bb0'), stop, stop]);
    expect(energyOf(r, 'bb0')).toEqual([]);
    expect(JSON.stringify((r as any).pending)).toContain('shuffle');
  });

  it('zero recipients: no search, no shuffle, the turn passes (B.44) [TA-478 pal-040]', () => {
    const r = step(board(), [attack, stop]);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.activePlayer).toBe('B');
    expect(JSON.stringify((r as any).events || [])).not.toContain('shuffled');
  });
});
