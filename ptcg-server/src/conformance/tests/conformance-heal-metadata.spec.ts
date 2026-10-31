import * as fs from 'fs';
import * as path from 'path';
import { step } from '../driver';
import { NeutralAction } from '../neutral-types';
import { importState } from '../state-adapter';
import { ChoosePokemonPrompt } from '../../game/store/prompts/choose-pokemon-prompt';
import { GameMessage } from '../../game/game-message';
import { PlayerType, SlotType } from '../../game/store/actions/play-card-action';
import { choosePokemonDecomposer } from '../decomposers/choose-pokemon';

describe('Explicit healing consequence metadata [CF-70 meg-011 heal]', () => {
  for (const declared of [false, true]) {
    it(declared ? 'heal-all declares healing without inventing a quantity' : 'does not infer healing from a message alone', () => {
      const q = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/next-four/shuckle.json'), 'utf8'));
      const game = importState(q.initialState);
      const prompt = new ChoosePokemonPrompt(game.state.players[0].id, GameMessage.CHOOSE_POKEMON_TO_HEAL,
        PlayerType.BOTTOM_PLAYER, [SlotType.ACTIVE, SlotType.BENCH],
        { allowCancel: false, ...(declared ? { operation: 'heal' as const } : {}) });
      const pending = choosePokemonDecomposer.next(prompt, [], game.ctx, game.state)!;
      expect(pending.legalActions.length).toBeGreaterThan(1);
      expect(pending.legalActions.every(a => a.op === (declared ? 'heal' : undefined) && a.amount === undefined)).toBe(true);
    });
  }
  for (const format of ['standard', 'unlimited']) for (const actor of ['A', 'B'] as const) {
    it(format + ' ' + actor + ' declares fixed healing and enforces supplied attributes', () => {
      const q = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/next-four/shuckle.json'), 'utf8'));
      q.initialState.format = format;
      if (actor === 'B') {
        [q.initialState.players.A, q.initialState.players.B] = [q.initialState.players.B, q.initialState.players.A];
        q.initialState.activePlayer = 'B'; q.initialState.firstPlayer = 'A'; q.actions[0].actor = 'B';
      }
      const before = step(q.initialState, q.actions);
      const picks = before.pending!.legalActions.filter(a => a.type === 'choose');
      expect(picks.map(a => a.target).sort()).toEqual(['a0', 'ab1']);
      expect(picks.every(a => a.op === 'heal' && a.amount === 30)).toBe(true);
      for (const target of ['a0', 'ab1']) for (const mode of ['omit', 'echo', 'wrong-op', 'wrong-amount', 'wrong-actor']) {
        const answer: any = { type: 'choose', actor, target };
        if (mode !== 'omit') { answer.op = 'heal'; answer.amount = 30; }
        if (mode === 'wrong-op') { answer.op = 'dealDamage'; }
        if (mode === 'wrong-amount') { answer.amount = 20; }
        if (mode === 'wrong-actor') { answer.actor = actor === 'A' ? 'B' : 'A'; }
        const result = step(q.initialState, [...q.actions, answer] as NeutralAction[]);
        if (mode === 'omit' || mode === 'echo') {
          expect(result.applied).toBe(2);
          const player = result.state.players[actor];
          expect(player.active!.damage).toBe(target === 'a0' ? 0 : 30);
          expect(player.bench[0].damage).toBe(target === 'ab1' ? 10 : 40);
          expect(result.events.some(e => e.kind === 'healed' && e.target === target && e.hp === 30)).toBe(true);
        } else {
          expect(result.status).toBe('invalidAction'); expect(result.applied).toBe(1);
          expect(result.state).toEqual(before.state); expect(result.events).toEqual(before.events);
        }
      }
    });
  }
});
