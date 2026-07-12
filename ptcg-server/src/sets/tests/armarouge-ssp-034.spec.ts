import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getDamage, getEnergyCount } from './card-test-helpers';

// TA-93 — Armarouge ssp-034 "Crimson Blaster": "Discard all [R] Energy from this Pokémon, and this
// attack does 180 damage to 1 of your opponent's BENCHED Pokémon." It targets a Benched Pokémon
// only. Compendium #2050 (SSP FAQ, TPCi 2024-11-07): with no opponent Bench you STILL discard all
// Fire Energy — only the 180 is skipped (and it never redirects to the Active). twinleaf originally
// used an any-target prefab (no Bench => hit the ACTIVE for 180 ×2 weakness = 360); the first TA-93
// fix then over-corrected to a full no-op (skipped the mandatory discard) — the cross-engine re-fuzz
// caught that against rotomancer, which correctly discards. This spec now pins #2050 exactly.
beforeAll(() => { loadAllSets(); });

describe('Armarouge SSP — Crimson Blaster (TA-93)', () => {

  it('discards all Fire Energy but deals no damage when the opponent has no Benched Pokemon (#2050)', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: {
          card: 'Armarouge SSP',
          energy: ['Fire Energy SVE', 'Fire Energy SVE', 'Fire Energy SVE'],
        },
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Arceus V BRS' },
        deck: padDeck(10),
      }
    });

    useAttack(game.store, game.state, 0, 'Crimson Blaster');

    // No Benched target => no damage anywhere; the Active is NOT redirected into (#2050)...
    expect(getDamage(game.state, 1, 'active')).toBe(0);
    // ...but all Fire Energy is STILL discarded — the discard is unconditional (#2050: "Yes").
    expect(getEnergyCount(game.state, 0, 'active')).toBe(0);
  });

  it('does 180 to a Benched Pokemon (not the Active) and discards Fire Energy', () => {
    const game = setupGame({
      turn: 2,
      player1: {
        active: {
          card: 'Armarouge SSP',
          energy: ['Fire Energy SVE', 'Fire Energy SVE', 'Fire Energy SVE'],
        },
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Arceus V BRS' },
        bench: [{ card: 'Arceus V BRS' }],
        deck: padDeck(10),
      }
    });

    useAttack(game.store, game.state, 0, 'Crimson Blaster');

    expect(getDamage(game.state, 1, 0)).toBe(180);   // benched target hit
    expect(getDamage(game.state, 1, 'active')).toBe(0); // Active untouched
    expect(getEnergyCount(game.state, 0, 'active')).toBe(0); // all Fire discarded
  });
});
