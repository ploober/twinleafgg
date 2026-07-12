import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack, getDamage, getEnergyCount } from './card-test-helpers';

// TA-93 — Armarouge ssp-034 "Crimson Blaster": "Discard all [R] Energy from this Pokémon, and this
// attack does 180 damage to 1 of your opponent's BENCHED Pokémon." It targets a Benched Pokémon
// only. With an empty opponent Bench the attack does nothing (compendium #2050). twinleaf used an
// any-target prefab, so with no Bench it hit the ACTIVE for 180 (×2 weakness => 360) — illegitimate.
beforeAll(() => { loadAllSets(); });

describe('Armarouge SSP — Crimson Blaster (TA-93)', () => {

  it('does nothing when the opponent has no Benched Pokemon (no Active hit)', () => {
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

    const attackerEnergyBefore = getEnergyCount(game.state, 0, 'active');

    useAttack(game.store, game.state, 0, 'Crimson Blaster');

    // No Benched target => the attack does nothing: opponent Active untouched...
    expect(getDamage(game.state, 1, 'active')).toBe(0);
    // ...and the attacker's Fire Energy is not discarded (whole attack no-ops per #2050).
    expect(getEnergyCount(game.state, 0, 'active')).toBe(attackerEnergyBefore);
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
