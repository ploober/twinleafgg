import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-779 (B.120 amended, owner 2026-10-25): Magnetic Charge pal-065 "Attach up to 2 Basic [L] Energy cards from your
 * discard pile to 1 of your Benched Pokémon." and Flare Bringer par-029 / svp-057 "... to 1 of your Pokémon." send every
 * card to ONE Pokémon, so every card is asked first (the stop in the same pending: an attack's "up to" spans zero), then
 * the one Pokémon. Twinleaf offered attachEnergy (card, Pokémon) pairs and let the two cards land on two Pokémon (the
 * AttachEnergyPrompt had no sameTarget).
 * TA-780 (B.120 amended; B.18 / #2301): Philippe cri-079 / cri-110 "Attach up to 2 Basic [M] Energy cards from your
 * discard pile to 1 of your [M] Pokémon." asked the Pokémon first, then 0..2 cards. Now the cards first (a Trainer's
 * "up to 2" is 1..2: no stop before the first), then one of the [M] Pokémon; one [M] Pokémon is not asked.
 * Mutation guards: drop sameTarget from Magnemite / Chi-Yu -> the pair cells red; restore Philippe's
 * ChoosePokemonPrompt-first script -> the Philippe cells red.
 */

const FIRE = 'sve-002';
const LIGHTNING = 'sve-004';
const METAL = 'sve-008';
const GRASS = 'sve-001';
const FILLER = 'pal-090';
const METAL_MON = 'svi-142';

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
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((p, i) => ({ iid: `${tag}${i}`, printing: p }));
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function board(active: PokemonInPlay, bench: PokemonInPlay[], discard: string[], hand: string[] = []): NeutralState {
  const A: PlayerState = { active, bench, hand: cards('ah', hand), deck: cards('ad', [GRASS, GRASS, GRASS, GRASS]),
    discard: cards('adc', discard), lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', FILLER), bench: [], hand: [], deck: cards('bd', [GRASS, GRASS, GRASS, GRASS]),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const choose = (target: string) => act({ actor: 'A', type: 'choose', target });
const stop = act({ actor: 'A', type: 'confirm', value: false });
const attack = (name: string) => act({ actor: 'A', type: 'declareAttack', source: 'a1', name });

function legal(r: ReturnType<typeof step>): string[] {
  const p = (r as any).pending;
  return p ? p.legalActions.map((a: any) => [a.actor, a.type, a.card, a.target, a.value].filter(x => x !== undefined && x !== null).join(':')).sort() : [];
}
function energyOn(r: ReturnType<typeof step>, iid: string): string[] {
  const A = r.state.players.A;
  const slot = [A.active, ...A.bench].find(s => s && s.stack.some(c => c.iid === iid));
  return slot ? slot.energy.map(e => e.iid).sort() : [];
}

// The cell labels are literal (the registry links each one): [first, second, pokemon, pair refused].
function suite(printing: string, name: string, own: string, disc: string, pokemon: string[], cells: string[]) {
  describe(`TA-779 — ${name} ${printing}: every card, then the one Pokémon`, () => {
    const b = () => board(mon('a1', printing, [own, own]), [mon('ab1', FILLER), mon('ab2', FILLER)], [disc, disc, disc]);
    it(`first pending: the cards and the stop, no pairs ${cells[0]}`, () => {
      expect(legal(step(b(), [attack(name)]))).toEqual(['A:choose:adc0', 'A:choose:adc1', 'A:choose:adc2', 'A:confirm:false']);
    });
    it(`after one card: the others and the stop ${cells[1]}`, () => {
      expect(legal(step(b(), [attack(name), choose('adc0')]))).toEqual(['A:choose:adc1', 'A:choose:adc2', 'A:confirm:false']);
    });
    it(`after two: the one Pokémon, and both land on it ${cells[2]}`, () => {
      expect(legal(step(b(), [attack(name), choose('adc0'), choose('adc2')]))).toEqual(pokemon);
      const r = step(b(), [attack(name), choose('adc0'), choose('adc2'), choose('ab2')]);
      expect(r.status).not.toBe('invalidAction');
      expect(energyOn(r, 'ab2')).toEqual(['adc0', 'adc2']);
      expect(energyOn(r, 'ab1')).toEqual([]);
    });
    it(`a pair is refused ${cells[3]}`, () => {
      const r = step(b(), [attack(name), act({ actor: 'A', type: 'attachEnergy', card: 'adc0', target: 'ab1' })]);
      expect(r.status).toBe('invalidAction');
    });
  });
}

suite('pal-065', 'Magnetic Charge', LIGHTNING, LIGHTNING, ['A:choose:ab1', 'A:choose:ab2'],
  ['[TA-779 pal-065]', '[TA-779 pal-065 second]', '[TA-779 pal-065 pokemon]', '[TA-779 pal-065 pair refused]']);
suite('par-029', 'Flare Bringer', FIRE, FIRE, ['A:choose:a1', 'A:choose:ab1', 'A:choose:ab2'],
  ['[TA-779 par-029]', '[TA-779 par-029 second]', '[TA-779 par-029 pokemon]', '[TA-779 par-029 pair refused]']);
suite('svp-057', 'Flare Bringer', FIRE, FIRE, ['A:choose:a1', 'A:choose:ab1', 'A:choose:ab2'],
  ['[TA-779 svp-057]', '[TA-779 svp-057 second]', '[TA-779 svp-057 pokemon]', '[TA-779 svp-057 pair refused]']);

describe('TA-780 — Philippe cri-079: 1..2 Basic [M] Energy first, then one of your [M] Pokémon', () => {
  const play = act({ actor: 'A', type: 'playSupporter', card: 'ah0' });
  const b = (benched: string[] = [METAL_MON, METAL_MON]) => board(mon('a1', FILLER),
    benched.map((p, i) => mon(`ab${i + 1}`, p)), [METAL, METAL, GRASS, METAL], ['cri-079']);
  it('first pending: only the Basic [M] Energy, no stop (B.18) [TA-780 cri-079]', () => {
    expect(legal(step(b(), [play]))).toEqual(['A:choose:adc0', 'A:choose:adc1', 'A:choose:adc3']);
  });
  it('after one: the others and the stop [TA-780 cri-079 second]', () => {
    expect(legal(step(b(), [play, choose('adc3')]))).toEqual(['A:choose:adc0', 'A:choose:adc1', 'A:confirm:false']);
  });
  it('after two: the [M] Pokémon only, and both land there [TA-780 cri-079 pokemon]', () => {
    expect(legal(step(b(), [play, choose('adc0'), choose('adc1')]))).toEqual(['A:choose:ab1', 'A:choose:ab2']);
    const r = step(b(), [play, choose('adc0'), choose('adc1'), choose('ab2')]);
    expect(energyOn(r, 'ab2')).toEqual(['adc0', 'adc1']);
  });
  it('the stop after one, then the Pokémon: one lands [TA-780 cri-079 stop]', () => {
    const r = step(b(), [play, choose('adc1'), stop, choose('ab1')]);
    expect(energyOn(r, 'ab1')).toEqual(['adc1']);
  });
  it('one [M] Pokémon: not asked; the cards go to it [TA-780 cri-079 one]', () => {
    const r = step(b([METAL_MON, FILLER]), [play, choose('adc0'), choose('adc1')]);
    expect(r.status).not.toBe('invalidAction');
    expect(energyOn(r, 'ab1')).toEqual(['adc0', 'adc1']);
  });
  it('the reprint cri-110 asks the same [TA-780 cri-110]', () => {
    const fa = board(mon('a1', FILLER), [mon('ab1', METAL_MON), mon('ab2', METAL_MON)], [METAL, METAL, GRASS, METAL], ['cri-110']);
    expect(legal(step(fa, [play]))).toEqual(['A:choose:adc0', 'A:choose:adc1', 'A:choose:adc3']);
    expect(legal(step(fa, [play, choose('adc0'), choose('adc1')]))).toEqual(['A:choose:ab1', 'A:choose:ab2']);
  });
  it('the Pokémon first is refused [TA-780 cri-079 pokemon first refused]', () => {
    expect(step(b(), [play, choose('ab1')]).status).toBe('invalidAction');
  });
});
