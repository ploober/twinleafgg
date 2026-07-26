import { setupGame, padDeck, loadAllSets } from './test-helpers';
import { useAttack } from './card-test-helpers';
import { ChoosePokemonPromptType, ChoosePokemonPrompt } from '../../game/store/prompts/choose-pokemon-prompt';
import { PlayerType, SlotType, CardTarget } from '../../game/store/actions/play-card-action';

// TA-141 (TA-139 wrong-perspective family) — Inteleon `meg-142` "Bring Down": *"The Pokémon in play
// that has the least HP remaining, EXCEPT FOR THIS POKEMON, is Knocked Out."*
//
// The card builds its `blocked` list with
//
//     player.forEachPokemon(PlayerType.TOP_PLAYER, (list, card, target) => ...)
//
// on the player's OWN Pokemon. `Player.forEachPokemon` stamps that PlayerType verbatim into every
// emitted CardTarget, so the attacker's own Active was blocked as `{TOP_PLAYER, ACTIVE, 0}` — the
// OPPONENT's Active. Net effect: the attacker itself stayed selectable (the card forbids it) while a
// slot on the other side was blocked instead.
//
//  (meg-142) extends  (MEP #2) -- the reprint-subclass pattern -- so the one
// base-class edit covers both printings. Checked deliberately: editing a base class silently rewrites
// every reprint, and here both printings carry the same attack text, so it is the right scope.
//
// Caught cross-engine: twinleaf offered `a1s0` (the attacker) where rotomancer offered only the two
// legal bench candidates.
beforeAll(() => { loadAllSets(); });

function keyOf(t: CardTarget): string {
  return `${t.player}:${t.slot}:${t.index}`;
}

describe('Inteleon MEG — Bring Down excludes THIS Pokemon, on the right side of the board (TA-141)', () => {
  it('blocks the attacker\'s own Active, not the opponent\'s', () => {
    const g = setupGame({
      turn: 2,
      player1: {
        active: { card: 'Inteleon2 MEG', energy: ['Water Energy SVE'] },
        bench: [{ card: 'Ralts SIT' }],       // low HP => a genuine least-HP candidate
        deck: padDeck(10),
      },
      player2: {
        active: { card: 'Raging Bolt ex TEF' },  // HP 240, never the least
        bench: [{ card: 'Ralts SIT' }],
        deck: padDeck(10),
      },
    });

    // The KO raises a FOLLOW-ON ChoosePokemonPrompt (promote), and this override is per-type, so it
    // fires more than once. Capture `blocked` from the first call only, and always resolve onto a
    // still-occupied slot so the later calls cannot throw and mask the assertion.
    let blocked: string[] | null = null;
    g.overridePrompt(ChoosePokemonPromptType, prompt => {
      if (blocked === null) {
        blocked = ((prompt as ChoosePokemonPrompt).options.blocked || []).map(keyOf);
      }
      // The handler must return CardTarget[], NOT live PokemonCardLists -- `decode` resolves targets
      // and silently yields undefined for anything else. KO the OPPONENT's benched Ralts: a genuine
      // least-HP candidate, never blocked, and its KO needs no promote (their Active survives).
      return [{ player: PlayerType.TOP_PLAYER, slot: SlotType.BENCH, index: 0 }];
    });

    useAttack(g.store, g.state, 0, 'Bring Down');

    const ownActive = keyOf({ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 });
    // RED: blocked was ['1:1:0', '1:1:0'] -- the attacker's own Active stamped TOP_PLAYER, colliding
    // with the opponent's Active entry, so `0:1:0` never appears and the attacker stays selectable.
    expect(blocked).toContain(ownActive);
  });
});
