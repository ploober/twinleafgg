import * as fs from 'fs';
import * as path from 'path';
import { step, replay } from '../driver';
import { NeutralAction, NeutralState } from '../neutral-types';
import { importState } from '../state-adapter';
import { PutDamagePrompt } from '../../game/store/prompts/put-damage-prompt';
import { GameMessage } from '../../game/game-message';
import { PlayerType, SlotType } from '../../game/store/actions/play-card-action';

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/cf70-migration/cases.json'), 'utf8'));
const attrs = new Set(['op', 'amount', 'destination']);
function strip(value: any): any {
  if (Array.isArray(value)) { return value.map(strip); }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k, v]) => !attrs.has(k) && v !== undefined).map(([k, v]) => [k, strip(v)]));
  }
  return value;
}

describe('CF-70 fixed quantities and in-play relocation consequences', () => {
  for (const c of cases) {
    it(c.id + ' preserves the paused board/events and declares the typed consequence', () => {
      const state = c.request.initialState as NeutralState;
      const actions = c.request.actions as NeutralAction[];
      const r = step(state, actions);
      expect(strip(r)).toEqual(strip(c.before));
      const offers = (r.pending?.legalActions ?? []).filter(a => a.type === 'choose' || a.type === 'placeCounter');
      expect(offers.length).toBeGreaterThan(0);
      if (offers.length === 0) { return; }
      for (const a of offers) {
        expect(a.op).toBe(c.expectedOperation);
        expect(a.amount).toBe(c.expectedAmount ?? undefined);
        expect(a.destination).toBe(c.expectedDestination);
      }
      const offer = offers[0];
      const omitted = Object.fromEntries(Object.entries(offer).filter(([k]) => !attrs.has(k))) as unknown as NeutralAction;
      expect(step(state, [...actions, omitted])).toEqual(step(state, [...actions, offer]));
      const wrong = { ...offer, ...(c.expectedAmount !== null ? { amount: c.expectedAmount + 1 } : { op: 'attach' }) } as NeutralAction;
      const rejected = step(state, [...actions, wrong]);
      expect(rejected.status).toBe('invalidAction');
      expect(rejected.applied).toBe(actions.length);
      expect(rejected.state).toEqual(r.state);
      expect(rejected.events).toEqual(r.events);
    });
  }

  it('computed remaining-HP placement omits amount rather than reporting its current calculation', () => {
    const state = JSON.parse(JSON.stringify(cases[0].request.initialState)) as NeutralState;
    const active = state.players.A.active!;
    active.stack = [{ iid: 'computed-source', printing: 'par-046' }];
    active.energy = [{ iid: 'computed-energy', printing: 'sve-001' }];
    const r = step(state, [{ actor: 'A', type: 'declareAttack', source: 'computed-source', name: 'Icicle Sole' }]);
    const picks = r.pending?.legalActions.filter(a => a.type === 'placeCounter') ?? [];
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every(a => a.op === 'placeCounters' && a.amount === undefined)).toBe(true);
  });

  it('a genuine distribution does not turn its ten-HP step into amount one', () => {
    const game = importState(cases[0].request.initialState as NeutralState);
    game.store.prompt(game.state, new PutDamagePrompt(game.state.players[0].id,
      GameMessage.CHOOSE_POKEMON_TO_DAMAGE, PlayerType.TOP_PLAYER, [SlotType.ACTIVE, SlotType.BENCH], 60,
      [{ target: { player: PlayerType.TOP_PLAYER, slot: SlotType.ACTIVE, index: 0 }, damage: 60 },
        { target: { player: PlayerType.TOP_PLAYER, slot: SlotType.BENCH, index: 0 }, damage: 60 }],
      { allowCancel: false }), () => {});
    const picks = replay(game, []).pending?.legalActions.filter(a => a.type === 'placeCounter') ?? [];
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every(a => a.op === 'placeCounters' && a.amount === undefined)).toBe(true);
  });
});
