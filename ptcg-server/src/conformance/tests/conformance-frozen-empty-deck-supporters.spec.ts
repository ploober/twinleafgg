import * as fs from 'fs';
import * as path from 'path';
import { step } from '../driver';
import { importState } from '../state-adapter';
import { PokemonCard } from '../../game/store/card/pokemon-card';
import { PlayCardAction, PlayerType, SlotType } from '../../game/store/actions/play-card-action';

describe('Frozen empty-deck Supporter boundaries [B.41 TA-308 TA-461 frozen controls]', () => {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/next-four/empty-deck-supporters.json'), 'utf8'));
  for (const fixture of cases) for (const format of ['standard', 'unlimited']) {
    for (const variant of ['empty', 'own-deck', 'opponent-deck', 'own-larger-hand', 'opponent-larger-hand']) {
      it(format + ' ' + fixture.sourceKey + ' ' + variant, () => {
        const q = JSON.parse(JSON.stringify(fixture)); q.initialState.format = format;
        if (variant === 'own-deck') { q.initialState.players.A.deck.push({ iid: 'controlDeck', printing: 'sve-001' }); }
        if (variant === 'opponent-deck') { q.initialState.players.B.deck.push({ iid: 'controlDeck', printing: 'sve-001' }); }
        if (variant.endsWith('larger-hand')) {
          const hand = q.initialState.players[variant === 'own-larger-hand' ? 'A' : 'B'].hand;
          for (let i = 0; i < 4; i++) { hand.push({ iid: 'controlHand' + i, printing: 'sve-001' }); }
        }
        const expected = variant !== 'empty' && (q.printing !== 'ssp-190' || !variant.endsWith('larger-hand'));
        const game = importState(q.initialState), player = game.state.players[0];
        const trainer: any = player.hand.cards.find(c => c.set.toLowerCase() === q.printing.split('-')[0]
          && Number(c.setNumber) === Number(q.printing.split('-')[1]));
        expect(trainer).toBeDefined(); expect(trainer.canPlay(game.store, game.state, player)).toBe(expected);
        const nativePlay = () => game.store.dispatch(new PlayCardAction(player.id, player.hand.cards.indexOf(trainer),
          { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }));
        if (expected) { expect(nativePlay).not.toThrow(); } else { expect(nativePlay).toThrow(); }
        if (q.printing === 'ssp-190') { expect(player.hand.cards.some(c => c instanceof PokemonCard)).toBe(true); }
        const before = step(q.initialState, []);
        const iid = q.initialState.players.A.hand.find((c: any) => c.printing === q.printing).iid;
        expect(before.pending!.legalActions.some(a => a.type === 'playSupporter' && a.card === iid)).toBe(expected);
        const after = step(q.initialState, [{ type: 'playSupporter', actor: 'A', card: iid }]);
        if (expected) {
          expect(after.applied).toBe(1);
        } else {
          expect(after.status).toBe('invalidAction'); expect(after.applied).toBe(0);
          expect(after.state).toEqual(before.state); expect(after.events).toEqual(before.events);
        }
      });
    }
  }
});
