import { GameMessage } from '../../game/game-message';
import { Card } from '../../game/store/card/card';
import { chooseAttackDecomposer } from '../decomposers/choose-attack';
import { ChooseAttackPrompt } from '../../game/store/prompts/choose-attack-prompt';
import { WirePick } from '../decomposers/decomposer';

/**
 * CF-71 / B.55 (pinned 2026-09-18) — a copy attack's (attack × Pokémon) selection is TWO sequential
 * picks (the Pokémon, then that Pokémon's attack), not ONE joint menu over every (attack × Pokémon)
 * pair. Skill Thief `pbl-054` ("Choose 1 of your opponent's Pokémon's attacks and use it as this
 * attack") is the exemplar; rotomancer lowers it as `pickPrinting` then `pickAttackFragment`, and B.55
 * pins that order. Adapter-only: `ChooseAttackPrompt` and the UI are untouched.
 *
 * This drives the decomposer directly (as CF-38's uniqueness test does), so it pins exactly the
 * changed logic without a full board. Mutation guard: revert `choose-attack.ts` to the joint menu
 * (step 1 emits `choose {target, name}` over every pair and `next` returns null after one pick) and
 * BOTH of these red:
 *   - step 1's options carry a `name` (they must be target-only), and
 *   - after one pick there is no second (attack) pending — `next` returns null.
 */

// Minimal Card stand-ins: the decomposer reads only `attacks[].name`.
function fakeCard(attackNames: string[]): Card {
  return { attacks: attackNames.map(name => ({ name })) } as unknown as Card;
}

const STRAFE = 'Strafe', ILLUSORY = 'Illusory Impulse', VINE_SLAP = 'Vine Slap';
const bActive = fakeCard([STRAFE, ILLUSORY]);   // opponent's Active: two attacks
const bBench = fakeCard([VINE_SLAP]);           // opponent's Bench: one attack

function prompt(): ChooseAttackPrompt {
  return new ChooseAttackPrompt(0, GameMessage.CHOOSE_ATTACK_TO_COPY, [bActive, bBench]);
}
function ctxFor(): { cardToIid: Map<Card, string> } {
  return { cardToIid: new Map<Card, string>([[bActive, 'b0'], [bBench, 'bb0']]) };
}
type Offer = { type: string; target?: string; name?: string };
const fakeState = { players: [{ id: 0 }, { id: 1 }] } as never;
const offers = (p: ReturnType<typeof prompt>, picks: WirePick[]) =>
  (chooseAttackDecomposer.next(p, picks, ctxFor() as never, fakeState)?.legalActions ?? []) as unknown as Offer[];

describe('CF-71 copy-attack selection is sequential (Pokémon, then attack)', () => {

  it('1. step 1 offers the Pokémon by `target` alone — no attack names on the first menu', () => {
    const o = offers(prompt(), []);
    expect(o.map(x => x.type)).toEqual(['choose', 'choose']);
    expect(o.map(x => x.target).sort()).toEqual(['b0', 'bb0']);
    // The joint menu keyed each option by BOTH target and name; sequential step 1 must not.
    expect(o.every(x => x.name === undefined)).toBe(true);
  });

  it('2. after the Pokémon is picked, step 2 offers THAT Pokémon\'s attacks by `name` (target constant)', () => {
    const p = p1Pick();
    const o = offers(prompt(), [p]);
    expect(o.map(x => x.type)).toEqual(['choose', 'choose']);
    expect(o.map(x => x.name).sort()).toEqual([ILLUSORY, STRAFE].sort());
    // Step 2 names the attack; the target is the (single) picked Pokémon, constant across options.
    expect(o.every(x => x.target === 'b0')).toBe(true);
  });

  it('3. a Pokémon with one attack offers only it at step 2', () => {
    const pick = chooseAttackDecomposer.toPick(prompt(), { actor: 'A', type: 'choose', target: 'bb0' } as never, ctxFor() as never, {} as never, []);
    const o = offers(prompt(), [pick]);
    expect(o.map(x => x.name)).toEqual([VINE_SLAP]);
  });

  it('4. the two picks assemble into the raw {index, attack} decode form', () => {
    const p = prompt();
    const step1 = chooseAttackDecomposer.toPick(p, { actor: 'A', type: 'choose', target: 'b0' } as never, ctxFor() as never, {} as never, []);
    expect(step1).toEqual({ kind: 'attack', index: 0, attack: '' });
    const step2 = chooseAttackDecomposer.toPick(p, { actor: 'A', type: 'choose', name: STRAFE } as never, ctxFor() as never, {} as never, [step1]);
    expect(step2).toEqual({ kind: 'attack', index: 0, attack: STRAFE });
    // Both picks made → the decision is complete.
    expect(chooseAttackDecomposer.next(p, [step1, step2], ctxFor() as never, fakeState)).toBeNull();
    expect(chooseAttackDecomposer.assemble(p, [step1, step2])).toEqual({ index: 0, attack: STRAFE });
  });

  it('5. an unknown attack on the picked Pokémon throws (malformed log)', () => {
    const p = prompt();
    const step1 = chooseAttackDecomposer.toPick(p, { actor: 'A', type: 'choose', target: 'b0' } as never, ctxFor() as never, {} as never, []);
    expect(() => chooseAttackDecomposer.toPick(p, { actor: 'A', type: 'choose', name: VINE_SLAP } as never, ctxFor() as never, {} as never, [step1]))
      .toThrowError(/no attack/);
  });
});

function p1Pick(): WirePick {
  return chooseAttackDecomposer.toPick(prompt(), { actor: 'A', type: 'choose', target: 'b0' } as never, ctxFor() as never, {} as never, []);
}
