import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-789: the Trainer menu's dry-run probe played every Tool onto the Active Pokémon, so once the Active held a Tool
 * the probe was refused (one Tool per Pokémon) and the Tool was withheld from every Benched Pokémon too, which could
 * still take it. Each target is now probed on its own. Bravery Charm pal-173: "The Basic Pokémon this card is attached
 * to gets +50 HP." Technical Machine: Devolution par-177 (a Tool).
 */

const GRASS = 'sve-001';
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, tools: string[] = []): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: [], tools: tools.map((t, i) => ({ iid: `${iid}t${i}`, printing: t })), damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function deck(tag: string) {
  return Array.from({ length: 4 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS }));
}
function board(active: PokemonInPlay, bench: PokemonInPlay[]): NeutralState {
  const A: PlayerState = { active, bench, hand: [{ iid: 'ah0', printing: 'par-177' }, { iid: 'ah1', printing: 'pal-173' }], deck: deck('a'),
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b0', 'twm-118'), bench: [], hand: [], deck: deck('b'),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const tools = (r: ReturnType<typeof step>) => ((r.pending?.legalActions ?? []) as unknown as Array<{ type: string; card?: string; target?: string }>)
  .filter(a => a.type === 'attachTool').map(a => `${a.card}>${a.target}`).sort();

describe('TA-789 a Tool is offered to every Pokémon that can take it, whatever the Active holds', () => {
  it('the Active holds a Tool: both Tools are offered to the Benched Pokémon [TA-789 par-177]', () => {
    expect(tools(step(board(mon('a1', 'twm-118', ['pal-173']), [mon('a2', 'twm-118')]), []))).toEqual(['ah0>a2', 'ah1>a2']);
  });
  it('the Active holds a Tool: attaching to the Benched Pokémon is accepted [TA-789 par-177 attach]', () => {
    const r = step(board(mon('a1', 'twm-118', ['pal-173']), [mon('a2', 'twm-118')]),
      [{ actor: 'A', type: 'attachTool', card: 'ah0', target: 'a2' } as unknown as NeutralAction]);
    expect(r.status).not.toBe('invalidAction');
    expect(r.state.players.A.bench[0].tools.map(t => t.iid)).toEqual(['ah0']);
  });
  it('control: nothing can take a Tool, nothing is offered [TA-789 par-177 control]', () => {
    expect(tools(step(board(mon('a1', 'twm-118', ['pal-173']), [mon('a2', 'twm-118', ['pal-173'])]), []))).toEqual([]);
  });
  it('control: no Tool anywhere, every Pokémon is offered [TA-789 par-177 empty]', () => {
    expect(tools(step(board(mon('a1', 'twm-118'), [mon('a2', 'twm-118')]), []))).toEqual(['ah0>a1', 'ah0>a2', 'ah1>a1', 'ah1>a2']);
  });
});
