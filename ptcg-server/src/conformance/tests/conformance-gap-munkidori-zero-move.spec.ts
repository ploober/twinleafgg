import { setupGame, SetupGameResult } from '../../sets/tests/test-helpers';
import { useAbility } from '../../sets/tests/card-test-helpers';
import { PlayerType, SlotType, CardTarget } from '../../game/store/actions/play-card-action';
import { RemoveDamagePromptType } from '../../game/store/prompts/remove-damage-prompt';
import { DamageTransfer } from '../../game/store/prompts/move-damage-prompt';
import { Munkidori } from '../../sets/10-scarlet-and-violet/set-twilight-masquerade/munkidori';

/**
 * ENGINE GAP (TA-203 "Related engine gap"): Munkidori twm-095 Adrena-Brain can be spent for NO effect.
 *
 * Printed: "Once during your turn, if this Pokémon has any [D] Energy attached, you may move up to 3
 * damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon." Rule (compendium #13): an
 * Ability cannot be used for no effect — a Pokémon with no damage counters is not a legal source.
 *
 * Defect: `RemoveDamagePrompt.validate` (game/store/prompts/remove-damage-prompt.ts) never checks that a
 * transfer's `from` carries any damage, and munkidori.ts adds `ADRENA_BRAIN_MARKER` (and the
 * ABILITY_USED board effect) inside the transfer loop BEFORE its own `damageToMove > 0` check. So a
 * client that answers the prompt with an UNDAMAGED source passes validation (it satisfies the
 * mandatory `min: 1`), moves 0 counters, and still burns the once-per-turn Ability.
 *
 * Why the wire cannot show it: since TA-203 the conformance adapter filters undamaged sources out of
 * the `choose` menu, so /v1/step can no longer submit this answer. This spec answers the ENGINE prompt
 * directly (TestStoreHandler override -> decode + validate -> ResolvePromptAction), bypassing the
 * adapter, which is exactly what any other client of the engine can do.
 */

const ME = PlayerType.BOTTOM_PLAYER;
const OPP = PlayerType.TOP_PLAYER;
const t = (player: PlayerType, slot: SlotType, index: number): CardTarget => ({ player, slot, index });

const OPP_ACTIVE = t(OPP, SlotType.ACTIVE, 0);
const DAMAGED_BENCH = t(ME, SlotType.BENCH, 0);    // 30 damage
const UNDAMAGED_BENCH = t(ME, SlotType.BENCH, 1);  // 0 damage

function build(): SetupGameResult {
  return setupGame({
    turn: 3,
    player1: {
      active: { card: 'Munkidori TWM', energy: ['Darkness Energy SVE'] },
      bench: [
        { card: 'Ralts SIT', damage: 30 },
        { card: 'Ralts SIT' },
      ],
    },
    player2: {
      active: { card: 'Ralts SIT' },
    },
  });
}

function munkidoriMarkerSet(g: SetupGameResult): boolean {
  const m = g.player1.active.getPokemonCard() as Munkidori;
  return g.player1.marker.hasMarker(m.ADRENA_BRAIN_MARKER, m);
}

function answerWith(g: SetupGameResult, transfers: DamageTransfer[]): { seenType: string | undefined } {
  const seen: { seenType: string | undefined } = { seenType: undefined };
  g.overridePrompt(RemoveDamagePromptType, prompt => {
    seen.seenType = prompt.type;
    return transfers;
  });
  return seen;
}

describe('Conformance gap — Munkidori Adrena-Brain spent for a 0-counter move (RemoveDamagePrompt has no source-damage check)', () => {

  it('REPRO (open): answering with an UNDAMAGED source is accepted, moves 0 counters, and consumes the once-per-turn Ability', () => {
    // When this goes red, the bug is fixed: flip the assertion to the rule (the undamaged-source answer
    // is rejected by validate / the Ability stays unused and re-usable this turn).
    const g = build();
    expect(munkidoriMarkerSet(g)).toBe(false);

    const seen = answerWith(g, [{ from: UNDAMAGED_BENCH, to: OPP_ACTIVE }]);
    useAbility(g.store, g.state, 0, 'Adrena-Brain');

    expect(seen.seenType).toBe(RemoveDamagePromptType);       // the engine prompt was really answered
    expect(g.player1.bench[1].damage).toBe(0);                 // source had nothing to give
    expect(g.player1.bench[0].damage).toBe(30);                // the damaged Pokemon is untouched
    expect(g.player2.active.damage).toBe(0);                   // 0 counters landed on the opponent
    expect(g.state.prompts.filter(p => p.result === undefined).length).toBe(0);

    // DEFECT: the Ability is spent anyway.
    expect(munkidoriMarkerSet(g)).toBe(true);
    answerWith(g, [{ from: DAMAGED_BENCH, to: OPP_ACTIVE }]);
    // Refused as already used (engine ABILITY_USED gate), though a damaged source (30) and [D] Energy remain.
    expect(() => useAbility(g.store, g.state, 0, 'Adrena-Brain')).toThrow(jasmine.objectContaining({ message: 'POWER_ALREADY_USED' }));
    expect(g.player1.bench[0].damage).toBe(30);
    expect(g.player2.active.damage).toBe(0);
  });

  it('CONTROL: on the same board, answering with the DAMAGED source moves the counters (then, correctly, the Ability is spent)', () => {
    const g = build();
    expect(munkidoriMarkerSet(g)).toBe(false);                 // usable before any use

    answerWith(g, [
      { from: DAMAGED_BENCH, to: OPP_ACTIVE },
      { from: DAMAGED_BENCH, to: OPP_ACTIVE },
      { from: DAMAGED_BENCH, to: OPP_ACTIVE },
    ]);
    useAbility(g.store, g.state, 0, 'Adrena-Brain');

    expect(g.player1.bench[0].damage).toBe(0);                 // 3 counters left the source
    expect(g.player2.active.damage).toBe(30);                  // ... and landed on the opponent
    expect(g.player1.bench[1].damage).toBe(0);
    expect(munkidoriMarkerSet(g)).toBe(true);                  // a real use spends it
    expect(() => useAbility(g.store, g.state, 0, 'Adrena-Brain')).toThrow();
  });
});
