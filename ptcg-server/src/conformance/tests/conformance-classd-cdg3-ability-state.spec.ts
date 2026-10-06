import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * Seven class-D card findings (2026-09-30 batch), each re-driven on twinleaf c6ea52669 before the fix. Printed text
 * is quoted from card-data/final/<set>.json.
 *
 *   TA-526 Venusaur ex mew-003 Tranquil Flower: "Once during your turn, if this Pokémon is in the Active Spot, you
 *     may heal 60 damage from 1 of your Pokémon." The Active test read `player.active.cards[0]` (the Basic at the
 *     bottom of the stack), so an evolved Venusaur ex was never "in the Active Spot".
 *   TA-530 Articuno mew-144 Ice Float / TA-552 Moltres mew-146 Flare Float: "If this Pokémon has any [W] / [Fire]
 *     Energy attached, it has no Retreat Cost." CheckRetreatCostEffect is always the Active's retreat; the handler
 *     looked for itself anywhere in play, so a Benched Articuno / Moltres zeroed the Active's cost.
 *   TA-531 Alakazam mep-003 Psychic Draw: "Once during your turn, when you play this Pokémon from your hand to
 *     evolve 1 of your Pokémon, you may use this Ability. Draw 3 cards." An accepted use set no ABILITY_USED, so no
 *     abilitiesUsedThisTurn label (CF-77); the stored text also dropped "Once during your turn".
 *   TA-545 Mega Venusaur ex meg-003 Solar Transfer: "Move a Basic [Grass] Energy from 1 of your Pokémon to another of
 *     your Pokémon." The guard counted Pokémon holding ANY Energy, so it was offered with no Basic Grass Energy in
 *     play (B.29: an Ability whose operand set is empty and public cannot be used).
 *   TA-534 Toedscool par-016: Kick (20, no text); Absorb (40) "Heal 20 damage from this Pokémon." The heal was on
 *     attack index 0 (Kick).
 *   TA-538 Hydreigon pal-140 Tri Howl: "...attach any number of Energy cards you find there to your Pokémon in any
 *     way you like. Discard the other cards." The leftover discard iterated temp.cards while MOVE_CARDS removed from
 *     it, skipping every other card.
 */

const GRASS = 'sve-001';
const FIRE = 'sve-002';
const WATER = 'sve-003';
const PSYCHIC = 'sve-005';
const BELLSPROUT = 'asc-004'; // Basic, retreat [C]
const BIG = 'mew-003'; // Venusaur ex, 340 HP: a defender that survives

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, stack: string[], energy: string[] = [], damage = 0): PokemonInPlay {
  return {
    stack: stack.map((printing, i) => ({ iid: i === 0 ? iid : `${iid}s${i}`, printing })),
    energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })),
    tools: [], damage, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((printing, i) => ({ iid: `${tag}${i}`, printing }));
}
function board(active: PokemonInPlay, bench: PokemonInPlay[], opts: { hand?: string[]; deck?: string[]; bActive?: PokemonInPlay } = {}): NeutralState {
  const A: PlayerState = { active, bench, hand: cards('ah', opts.hand ?? []), deck: cards('ad', opts.deck ?? Array(8).fill(GRASS)),
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: opts.bActive ?? mon('b1', [BELLSPROUT]), bench: [], hand: [], deck: cards('bd', Array(8).fill(GRASS)),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
type Act = { type: string; [k: string]: unknown };
function menu(s: NeutralState, actions: unknown[] = []): Act[] {
  return (step(s, actions as never).pending?.legalActions ?? []) as unknown as Act[];
}
function offersAbility(s: NeutralState, ability: string): boolean {
  return menu(s).some(a => a.type === 'useAbility' && a.ability === ability);
}
function offersRetreat(s: NeutralState): boolean {
  return menu(s).some(a => a.type === 'retreat');
}

// ---------------------------------------------------------------- TA-526
describe('TA-526 Venusaur ex Tranquil Flower on an evolved Venusaur ex', () => {
  const VENUSAUR = ['meg-001', 'meg-002', 'mew-003'];
  it('evolved Venusaur ex in the Active Spot with 20 damage on it: Tranquil Flower is offered and heals it [TA-526]', () => {
    const s = board(mon('a1', VENUSAUR, [GRASS], 20), [mon('a2', [BELLSPROUT])]);
    expect(offersAbility(s, 'Tranquil Flower')).toBe(true);
    const use = { actor: 'A', type: 'useAbility', source: 'a1', ability: 'Tranquil Flower' };
    const paused = menu(s, [use]);
    const pick = paused.find(a => a.target === 'a1');
    const r = step(s, (pick ? [use, pick] : [use]) as never);
    expect(r.state.players.A.active!.damage).toBe(0);
  });
  it('control: evolved Venusaur ex on the Bench (Active damaged) is not offered Tranquil Flower [TA-526]', () => {
    const s = board(mon('a1', [BELLSPROUT], [], 20), [mon('a2', VENUSAUR, [GRASS])]);
    expect(offersAbility(s, 'Tranquil Flower')).toBe(false);
  });
  it('control: evolved Venusaur ex Active with no damaged Pokémon is not offered Tranquil Flower (B.29) [TA-526]', () => {
    const s = board(mon('a1', VENUSAUR, [GRASS]), [mon('a2', [BELLSPROUT])]);
    expect(offersAbility(s, 'Tranquil Flower')).toBe(false);
  });
});

// ---------------------------------------------------------------- TA-530 / TA-552
for (const [id, card, own, other, ability] of [
  ['TA-530', 'mew-144', WATER, FIRE, 'Ice Float'],
  ['TA-552', 'mew-146', FIRE, WATER, 'Flare Float'],
] as const) {
  describe(`${id} ${ability} changes only its own Retreat Cost`, () => {
    it(`Benched ${card} with ${own} x3, Active Bellsprout with no Energy: retreat is not offered [${id}]`, () => {
      const s = board(mon('a1', [BELLSPROUT]), [mon('a2', [card], [own, own, own])]);
      expect(offersRetreat(s)).toBe(false);
    });
    it(`control: Active ${card} with one ${own} retreats for free, keeping its Energy [${id}]`, () => {
      const s = board(mon('a1', [card], [own]), [mon('a2', [BELLSPROUT])]);
      expect(offersRetreat(s)).toBe(true);
      const r = step(s, [{ actor: 'A', type: 'retreat', to: 0 }] as never);
      expect(r.pending?.legalActions.some(a => (a as Act).type === 'discard') ?? false).toBe(false);
      expect(r.state.players.A.active!.stack[0].printing).toBe(BELLSPROUT);
      expect(r.state.players.A.bench[0].energy.length).toBe(1);
      expect(r.state.players.A.discard.length).toBe(0);
    });
    it(`control: Active ${card} with only ${other} attached still pays its [C][C] Retreat Cost [${id}]`, () => {
      const s = board(mon('a1', [card], [other]), [mon('a2', [BELLSPROUT])]);
      expect(offersRetreat(s)).toBe(false);
    });
  });
}

// ---------------------------------------------------------------- TA-531
describe('TA-531 Alakazam Psychic Draw records its use', () => {
  const s = board(mon('a1', ['meg-054', 'meg-055']), [mon('a2', [BELLSPROUT])], { hand: ['mep-003'] });
  const EVOLVE = { actor: 'A', type: 'evolve', card: 'ah0', target: 'a1' };
  it('accepted on evolve: 3 cards drawn and the Active carries [Psychic Draw] [TA-531]', () => {
    const r = step(s, [EVOLVE, { actor: 'A', type: 'confirm', value: true }] as never);
    expect(r.state.players.A.hand.length).toBe(3);
    expect(r.state.players.A.active!.markers.abilitiesUsedThisTurn).toEqual(['Psychic Draw']);
  });
  it('control: declined on evolve: nothing drawn and no label [TA-531]', () => {
    const r = step(s, [EVOLVE, { actor: 'A', type: 'confirm', value: false }] as never);
    expect(r.state.players.A.hand.length).toBe(0);
    expect(r.state.players.A.active!.markers.abilitiesUsedThisTurn).toEqual([]);
  });
});

// ---------------------------------------------------------------- TA-545
describe('TA-545 Mega Venusaur ex Solar Transfer needs a Basic Grass Energy in play', () => {
  const MEGA = ['meg-001', 'meg-002', 'meg-003'];
  it('only a Fire Energy in play (on Mega Venusaur ex), two Pokémon: Solar Transfer is not offered [TA-545]', () => {
    const s = board(mon('a1', [BELLSPROUT]), [mon('a2', MEGA, [FIRE])]);
    expect(offersAbility(s, 'Solar Transfer')).toBe(false);
  });
  it('control: a Basic Grass Energy on the Active, two Pokémon: Solar Transfer is offered [TA-545]', () => {
    const s = board(mon('a1', [BELLSPROUT], [FIRE, GRASS]), [mon('a2', MEGA)]);
    expect(offersAbility(s, 'Solar Transfer')).toBe(true);
  });
});

// ---------------------------------------------------------------- TA-534
describe('TA-534 Toedscool par-016: Absorb heals, Kick does not', () => {
  const s = board(mon('a1', ['par-016'], [GRASS, GRASS, GRASS], 20), [], { bActive: mon('b1', [BIG]) });
  it('Absorb: 40 to the defender and Toedscool heals 20 [TA-534]', () => {
    const r = step(s, [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Absorb' }] as never);
    expect(r.state.players.B.active!.damage).toBe(40);
    expect(r.state.players.A.active!.damage).toBe(0);
  });
  it('Kick: 20 to the defender and no heal [TA-534]', () => {
    const r = step(s, [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Kick' }] as never);
    expect(r.state.players.B.active!.damage).toBe(20);
    expect(r.state.players.A.active!.damage).toBe(20);
  });
});

// ---------------------------------------------------------------- TA-538
describe('TA-538 Hydreigon Tri Howl discards every card it does not attach', () => {
  const HYD = ['pal-138', 'pal-139', 'pal-140'];
  const USE = { actor: 'A', type: 'useAbility', source: 'a1', ability: 'Tri Howl' };
  it('top 3 Water, Grass, Psychic Energy; attach the Water and stop: the Grass and the Psychic are both discarded [TA-538]', () => {
    const s = board(mon('a1', HYD), [mon('a2', [BELLSPROUT])], { deck: [WATER, GRASS, PSYCHIC, BELLSPROUT, BELLSPROUT, BELLSPROUT] });
    const r = step(s, [USE, { actor: 'A', type: 'attachEnergy', card: 'ad0', target: 'a1' }, { actor: 'A', type: 'confirm', value: false }] as never);
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['ad1', 'ad2']);
    expect(r.state.players.A.deck.length).toBe(3);
    expect(r.state.players.A.active!.energy.map(c => c.iid)).toEqual(['ad0']);
  });
  it('top 3 Water and two non-Energy; attach the Water: both others are discarded [TA-538]', () => {
    const s = board(mon('a1', HYD), [mon('a2', [BELLSPROUT])], { deck: [WATER, BELLSPROUT, BELLSPROUT, GRASS, GRASS, GRASS] });
    const r = step(s, [USE, { actor: 'A', type: 'attachEnergy', card: 'ad0', target: 'a1' }] as never);
    const after = r.pending?.legalActions.some(a => (a as Act).type === 'confirm')
      ? step(s, [USE, { actor: 'A', type: 'attachEnergy', card: 'ad0', target: 'a1' }, { actor: 'A', type: 'confirm', value: false }] as never)
      : r;
    expect(after.state.players.A.discard.map(c => c.iid).sort()).toEqual(['ad1', 'ad2']);
  });
  it('control: no Energy in the top 3: all three are discarded [TA-538]', () => {
    const s = board(mon('a1', HYD), [mon('a2', [BELLSPROUT])], { deck: [BELLSPROUT, BELLSPROUT, BELLSPROUT, GRASS, GRASS, GRASS] });
    const r = step(s, [USE] as never);
    expect(r.state.players.A.discard.length).toBe(3);
    expect(r.state.players.A.deck.length).toBe(3);
  });
  it('all three attached: Tri Howl is not offered again this turn [TA-538]', () => {
    const s = board(mon('a1', HYD), [mon('a2', [BELLSPROUT])], { deck: [WATER, GRASS, PSYCHIC, BELLSPROUT, BELLSPROUT, BELLSPROUT] });
    const acts: unknown[] = [USE, { actor: 'A', type: 'attachEnergy', card: 'ad0', target: 'a1' },
      { actor: 'A', type: 'attachEnergy', card: 'ad1', target: 'a1' }, { actor: 'A', type: 'attachEnergy', card: 'ad2', target: 'a1' }];
    const r = step(s, acts as never);
    expect(r.state.players.A.active!.energy.length).toBe(3);
    expect((r.pending?.legalActions ?? []).some(a => (a as Act).type === 'useAbility' && (a as Act).ability === 'Tri Howl')).toBe(false);
  });
});
