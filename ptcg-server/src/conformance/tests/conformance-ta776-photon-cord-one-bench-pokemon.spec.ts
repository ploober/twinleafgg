import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, NeutralAction, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-776 (B.120 amended, owner 2026-10-25): Photon Cord pbl-028 "move up to 2 Basic [Lightning] Energy cards from this
 * Pokémon to 1 of your Benched Pokémon." The card's AttachEnergyPrompt lacked sameTarget, so the two Energy could be
 * split across the Bench. With sameTarget the adapter asks the cards, then the one Benched Pokémon (TA-769).
 * Mutation guard: drop sameTarget in miraidon.ts -> pairs come back and the split is accepted.
 */

const GRASS = 'sve-001', LIGHTNING = 'sve-004', FILLER = 'asc-004';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function mon(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(tag: string, over: Partial<PlayerState>): PlayerState {
  return {
    active: null, bench: [], hand: [], discard: [], lostZone: [], deck: cards(`${tag}d`, 6, GRASS),
    prizes: cards(`${tag}p`, 6, GRASS).map(c => ({ ...c, faceUp: false })) as PrizeRef[], flags: flags(), ...over,
  };
}
function board(A: Partial<PlayerState>): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'A', firstPlayer: 'A', phase: 'main',
    outcome: 'ongoing', stadium: null, players: { A: player('a', A), B: player('b', { active: mon('b1', FILLER) }) },
  } as NeutralState;
}
type La = { type: string; target?: string; card?: string; op?: string; recipient?: string; value?: boolean };
const offers = (r: ReturnType<typeof step>): string[] => ((r.pending?.legalActions ?? []) as unknown as La[])
  .map(a => (a.type === 'confirm' ? `confirm:${a.value}` : `${a.type}:${a.card ? a.card + '>' : ''}${a.target}${a.op ? ':' + a.op : ''}${a.recipient ? '>' + a.recipient : ''}`))
  .sort();
const choose = (target: string) => ({ actor: 'A', type: 'choose', target } as unknown as NeutralAction);
const stop = { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction;
const declare = (name: string) => ({ actor: 'A', type: 'declareAttack', source: 'a1', name } as unknown as NeutralAction);
const bench = (n: number) => Array.from({ length: n }, (_, i) => mon(`ab${i + 1}`, FILLER));
const on = (r: ReturnType<typeof step>, i: number) => r.state.players.A.bench[i].energy.map(e => e.iid).sort();
const chosen = (r: ReturnType<typeof step>) => r.events.filter(e => e.kind === 'chosen').map(e => (e as { card: string }).card);

const pound = { actor: 'B', type: 'declareAttack', source: 'b1', name: 'Pound' } as unknown as NeutralAction;
const chooseA = (target: string) => ({ actor: 'A', type: 'choose', target } as unknown as NeutralAction);
function koBoard(): NeutralState {
  const s = board({ active: { ...mon('a1', 'pbl-028', cards('ae', 2, LIGHTNING)), damage: 110 }, bench: bench(2) });
  s.activePlayer = 'B';
  s.players.B.active = mon('b1', 'pal-090', cards('be', 1, GRASS));
  return s;
}

describe('TA-776 — Photon Cord pbl-028: both Energy go to ONE Benched Pokémon', () => {
  it('the Energy cards are asked first, not (card, Pokémon) pairs [TA-776 pbl-028]', () => {
    const r = step(koBoard(), [pound]);
    expect(r.pending?.actor).toBe('A');
    expect(offers(r)).toEqual(['choose:ae0:moveTo', 'choose:ae1:moveTo']);
  });
  it('both cards, then the one Pokémon: both land on it [TA-776 pbl-028 same]', () => {
    const r = step(koBoard(), [pound, chooseA('ae0'), chooseA('ae1')]);
    expect(offers(r)).toEqual(['choose:ab1:moveTo', 'choose:ab2:moveTo']);
    const done = step(koBoard(), [pound, chooseA('ae0'), chooseA('ae1'), chooseA('ab2')]);
    expect(on(done, 1)).toEqual(['ae0', 'ae1']);
    expect(on(done, 0)).toEqual([]);
  });
  it('a split is refused [TA-776 pbl-028 split refused]', () => {
    const mv = (card: string, target: string) => ({ actor: 'A', type: 'moveEnergy', card, source: 'a1', target } as unknown as NeutralAction);
    const r = step(koBoard(), [pound, mv('ae0', 'ab1'), mv('ae1', 'ab2')]);
    expect(r.status).toBe('invalidAction');
  });
});
