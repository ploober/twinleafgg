import * as fs from 'fs';
import * as path from 'path';
import { Store, State, Player, PokemonCardList, GamePhase } from '../../game';
import { AttackEffect, PowerEffect } from '../../game/store/effects/game-effects';
import { AfterDamageEffect } from '../../game/store/effects/attack-effects';
import { AntiqueSkullFossil } from '../../sets/11-mega-evolution/set-pitch-black/antique-skull-fossil';
import { ErikasBellsprout } from '../../sets/11-mega-evolution/set-ascended-heroes/erikas-bellsprout';
import { step } from '../driver';
import { NeutralState, NeutralAction } from '../neutral-types';

function native(active = true, damage = 20) {
  const state = new State(); state.phase = GamePhase.ATTACK; state.turn = 5; state.activePlayer = 1;
  const owner = new Player(); owner.id = 1;
  const attacker = new Player(); attacker.id = 2;
  const fossil = new AntiqueSkullFossil();
  owner.active.cards = [active ? fossil : new ErikasBellsprout()]; owner.active.damage = damage;
  if (!active) { owner.bench = [new PokemonCardList()]; owner.bench[0].cards = [fossil]; }
  attacker.active.cards = [new ErikasBellsprout()];
  state.players = [owner, attacker];
  const store = new Store({ onStateChange: () => undefined } as any); store.state = state;
  return { state, owner, attacker, fossil, store };
}
function afterDamage(active = true, damage = 20) {
  const q = native(active, damage);
  const attack = new AttackEffect(q.attacker, q.owner, q.attacker.active.getPokemonCard()!.attacks[0]);
  q.store.reduceEffect(q.state, new AfterDamageEffect(attack, damage));
  return q;
}
function wire() : { initialState: NeutralState; actions: NeutralAction[] } {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/four-followups/ta829.json'), 'utf8'));
}
describe('Spiny Skull invokes its Ability rather than manual discard [TA-829 pbl-073]', () => {
  it('native: preserves the surviving Fossil and retaliates with three counters', () => {
    const q = afterDamage();
    expect(q.owner.active.cards).toContain(q.fossil); expect(q.owner.active.damage).toBe(20);
    expect(q.owner.discard.cards).not.toContain(q.fossil); expect(q.attacker.active.damage).toBe(30);
  });
  it('native: retains retaliation at a lethal damage checkpoint before the KO sweep', () => {
    const q = afterDamage(true, 60);
    expect(q.owner.active.cards).toContain(q.fossil); expect(q.attacker.active.damage).toBe(30);
  });
  it('native: the same Fossil on the Bench neither reacts nor discards', () => {
    const q = afterDamage(false);
    expect(q.owner.bench[0].cards).toContain(q.fossil); expect(q.owner.discard.cards).not.toContain(q.fossil);
    expect(q.attacker.active.damage).toBe(0);
  });
  it('native: zero damage does not activate Spiny Skull', () => {
    const q = afterDamage(true, 0);
    expect(q.owner.active.cards).toContain(q.fossil); expect(q.attacker.active.damage).toBe(0);
  });
  it('native: the explicit Trainer power still discards the Fossil', () => {
    const q = native(); q.state.phase = GamePhase.PLAYER_TURN; q.state.activePlayer = 0;
    q.store.reduceEffect(q.state, new PowerEffect(q.owner, q.fossil.powers[0], q.fossil as any));
    expect(q.owner.discard.cards).toContain(q.fossil); expect(q.attacker.active.damage).toBe(0);
  });
  it('wire: finishes the nonlethal attack without promotion or prizes', () => {
    const q = wire(); const r = step(q.initialState, q.actions);
    expect(r.applied).toBe(1); expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.active!.stack[0].iid).toBe('a0'); expect(r.state.players.A.active!.damage).toBe(20);
    expect(r.state.players.B.active!.damage).toBe(30); expect(r.state.players.B.prizes.length).toBe(6);
    expect(r.pending!.descriptor).toBe('main'); expect(r.pending!.legalActions.some(a => a.type === 'endTurn')).toBe(true);
    expect(r.events.some(e => e.kind === 'ko')).toBe(false);
  });
});
