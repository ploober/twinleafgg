import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers,
  ConditionToken, CardRef, SCHEMA_VERSION
} from '../neutral-types';

// Behavioural regression guards for the src/sets fixes the 2026-07-06 set-reorg merge reverted and that
// were re-applied in twinleaf `1a886a3ad`. The fix-signature manifest checks each fix's line is still
// present; these specs assert the actual behaviour, so a refactor that keeps the line but breaks the
// effect fails too. Two dominant patterns are covered here (the complex-logic re-applies — zeraora,
// koraidon, slakoth, murkrow, moltres, miraidon — keep their signature guards + the run6 differential):
//
//   damage-before-post-damage-effect (TA-44 class): the base damage must be on the Defending Pokémon
//     BEFORE the attack's secondary prompt pauses the game.
//   whiff-is-a-no-op (offer-then-reject class): an attack whose effect can't be carried out is still
//     legal to declare — it must appear in the menu, not be hidden by a thrown rejection.

const WATER = 'sve-003';
const RALTS = 'Ralts SIT';
const TANKY = 'Wellspring Mask Ogerpon ex TWM';  // twm-064, 210 HP — survives ≤200 so the attack pauses

function markers(played = 1): PokemonMarkers {
  return { playedOnTurn: played, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(over: Partial<PlayerFlags> = {}): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0,
    vstarUsed: false, ...over,
  };
}
/** 3 of each of the 8 basic Energies — enough for any of these attacks' costs. */
function mixed(tag: string): CardRef[] {
  const out: CardRef[] = [];
  for (let t = 1; t <= 8; t++) { for (let i = 0; i < 3; i++) { out.push({ iid: `${tag}-e${t}-${i}`, printing: `sve-00${t}` }); } }
  return out;
}
function pip(iid: string, printing: string, energy: CardRef[] = [], played = 1, conditions: ConditionToken[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions, markers: markers(played) };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState, turn = 3): NeutralState {
  const withDefaults = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: ps.prizes.length ? ps.prizes : Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}-pz${i}`, printing: WATER, faceUp: false })),
    deck: ps.deck.length ? ps.deck : [{ iid: `${tag}-d`, printing: WATER }],
  });
  return {
    schemaVersion: SCHEMA_VERSION, turn, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: withDefaults(A, 'A'), B: withDefaults(B, 'B') },
  };
}
const attacksOffered = (res: ReturnType<typeof step>): string[] =>
  (res.pending?.legalActions ?? []).filter(a => a.type === 'declareAttack').map(a => (a as { name: string }).name);

// (printing, attackName) — each deals its base damage then pauses on a secondary prompt (discard/flip/
// put-to-hand). The base must already be on the ≤200-damage-surviving Defending Pokémon at the pause.
const DAMAGE_FIRST: Array<[string, string, string]> = [
  ['meg-034', 'Swirling Waves', 'kyogre'],        // 130 then discard 2 Energy from self
  ['tef-061', 'Volt Wave', 'iron-hands'],         // 30 then paralysis flip
  ['sfa-035', 'Destructive Beam', 'yveltal'],      // 100 then coin flip
  ['meg-086', 'Claw of Darkness', 'mega-absol-ex'],// 200 then opponent hand discard
  ['por-041', 'Screw Knuckle', 'landorus'],        // 120 then return Energy to hand
  ['scr-023', 'Ember', 'salandit'],                // then discard Energy from self
];

// (printing, attackName, cost-energy, note) — a whiff on an empty discard / no Stadium; must be OFFERED.
const WHIFF_OFFERED: Array<[string, string, string]> = [
  ['asc-048', 'Regi Charge', 'regice-ex'],         // attach up to 2 Water from discard — none present
  ['asc-145', 'Regi Charge', 'registeel-ex'],      // attach up to 2 Metal from discard — none present
  ['scr-057', 'Dangle Tail', 'slowpoke'],          // no Pokémon in discard
  ['twm-099', 'Blazing Destruction', 'hisuian-growlithe'], // no Stadium in play
  ['sfa-018', 'Come and Get You', 'duskull'],       // whiff on an empty discard
];

describe('Conformance — re-applied src/sets fix regression guards (merge-revert behaviour)', () => {

  // B.82 (owner 2026-10-05, #1834 / #2002): an attack's choice of its OWN Energy (Swirling Waves, Screw Knuckle,
  // Ember) is made before the damage, so those three now pause at 0; the flip / opponent-hand riders keep the order.
  const CHOICE_FIRST = new Set(['meg-034', 'por-041', 'scr-023']);
  for (const [printing, attack, name] of DAMAGE_FIRST) {
    it(`${name} "${attack}" ${CHOICE_FIRST.has(printing) ? 'asks its Energy choice BEFORE the damage (B.82)' : 'places its damage BEFORE the secondary prompt'} [${printing}]`, () => {
      const res = step(
        board(player({ active: pip('A-act', printing, mixed('a')) }),
              player({ active: pip('B-act', TANKY) })),   // 210 HP survives ≤200 → attack pauses
        [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: attack }],
      );
      expect(res.status).toBe('awaitingAction');
      if (CHOICE_FIRST.has(printing)) {
        expect(res.state.players.B.active!.damage).toBe(0);
      } else {
        // Pre-fix the secondary prompt surfaced with the Defending Pokémon still at 0.
        expect(res.state.players.B.active!.damage).toBeGreaterThan(0);
      }
    });
  }

  for (const [printing, attack, name] of WHIFF_OFFERED) {
    it(`${name} "${attack}" is a legal whiff — offered, not rejected [${printing}]`, () => {
      const res = step(
        board(player({ active: pip('A-act', printing, mixed('a')) }),   // empty discard, no Stadium
              player({ active: pip('B-act', RALTS) })),
        [],
      );
      expect(res.status).toBe('awaitingAction');
      // Pre-fix the handler threw CANNOT_USE_ATTACK, so the menu dropped the attack entirely.
      expect(attacksOffered(res)).toContain(attack);
    });
  }

  // Complex-logic re-applies whose full effect needs multi-turn / specific-bench setup to assert exactly.
  // A lighter guard still catches the three merge-revert failure modes: attack hidden from the menu,
  // attack wrongly rejected (e.g. pre-fix Zeraora "Thunder Raid" threw CANNOT_PLAY with no ex on the
  // Bench), or the handler faulting. Each must be offered on a bare board and declare to awaitingAction.
  const DECLARES_CLEANLY: Array<[string, string, string]> = [
    ['dri-078', 'Thunder Raid', 'zeraora'],
    ['ssp-116', 'Unrelenting Onslaught', 'koraidon'],
    ['ssp-145', 'Take It Easy', 'slakoth'],
    ['dri-127', 'Torment', 'team-rockets-murkrow'],
    ['dri-127', 'Deceit', 'team-rockets-murkrow'],
    ['dri-031', 'Flame Screen', 'team-rockets-moltres-ex'],
    ['tef-121', 'Sparking Strike', 'miraidon'],
  ];
  for (const [printing, attack, name] of DECLARES_CLEANLY) {
    it(`${name} "${attack}" is offered and declares without rejection [${printing}]`, () => {
      const start = board(player({ active: pip('A-act', printing, mixed('a')) }),
                          player({ active: pip('B-act', RALTS) }));
      expect(attacksOffered(step(start, []))).toContain(attack);
      const res = step(start, [{ actor: 'A', type: 'declareAttack', source: 'A-act', name: attack }]);
      expect(res.status).toBe('awaitingAction');   // accepted + resolving, not invalidAction / engineFault
    });
  }
});
