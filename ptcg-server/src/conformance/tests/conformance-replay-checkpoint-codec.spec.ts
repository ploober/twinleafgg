import { ReplayCheckpointCodec } from '../replay-checkpoint-codec';
import { State } from '../../game/store/state/state';
import { Card } from '../../game/store/card/card';
import { CardList } from '../../game/store/state/card-list';
import { snapshotSourceMatches } from '../../game/store/snapshot-provenance';
import { HeatranLVX } from '../../sets/04-diamond-pearl-platinum/set-stormfront/heatran-lvx';
import { Orthwormex } from '../../sets/10-scarlet-and-violet/set-stellar-crown/orthworm-ex';

describe('Detached replay checkpoint codec', () => {
  it('forks cycles, aliases, sparse arrays, mutable Cards and native containers onto class prototypes', () => {
    const codec = new ReplayCheckpointCodec(), source: any = new State();
    const card: any = Object.assign(Object.create(Card.prototype), { attacks: [{ name: 'identity' }], mutable: [1] });
    source.self = source; source.card = card; source.attack = card.attacks[0];
    source.sparse = [card, , source]; source.arrayAlias = source.sparse;
    source.map = new Map([[card, source]]); source.set = new Set([card]);
    const payload = codec.encode(source), a: any = codec.decode(payload), b: any = codec.decode(payload);
    expect(Object.getPrototypeOf(a)).toBe(State.prototype);
    expect(a.self).toBe(a); expect(a.arrayAlias).toBe(a.sparse); expect(1 in a.sparse).toBe(false);
    expect(a.map.get(a.card)).toBe(a); expect(a.set.has(a.card)).toBe(true);
    expect(a.attack).toBe(a.card.attacks[0]); expect(a.card).not.toBe(card);
    a.card.mutable.push(2); a.sparse.pop();
    expect(b.card.mutable).toEqual([1]); expect(card.mutable).toEqual([1]); expect(b.sparse.length).toBe(3);
  });
  it('preserves temporary-pile lineage and per-Card deck/transit metadata on private Cards', () => {
    const codec = new ReplayCheckpointCodec(), source: any = new State();
    const card: Card = Object.create(Card.prototype); source.zone = new CardList(); source.zone.zoneTag = 'deck';
    source.zone.cards = [card]; source.temp = new CardList(); source.zone.moveTo(source.temp, 1);
    CardList.transit.set(card, { origin: 'deck', visibility: 'public', order: 3 }); CardList.deckEnd.set(card, 'bottom');
    const copy: any = codec.decode(codec.encode(source)), restored = copy.temp.cards[0];
    expect(snapshotSourceMatches(copy.temp, copy.zone)).toBe(true);
    expect(CardList.deckStamp.get(restored)).toBe(CardList.deckStamp.get(card));
    expect(CardList.transit.get(restored)).toEqual(CardList.transit.get(card));
    expect(CardList.transit.get(restored)).not.toBe(CardList.transit.get(card));
    expect(CardList.deckEnd.get(restored)).toBe('bottom');
    const next = new CardList(); source.temp.moveTo(next, 1);
    expect(snapshotSourceMatches(next, source.zone)).toBe(true);
  });
  it('does not retain source instances as prototypes and preserves read-only descriptors', () => {
    const codec = new ReplayCheckpointCodec(), source: any = Object.create(new State());
    Object.assign(source, new State()); source.frozen = Object.freeze({ value: 1 });
    const copy: any = codec.decode(codec.encode(source));
    expect(Object.getPrototypeOf(copy)).toBe(State.prototype); expect(Object.isFrozen(copy.frozen)).toBe(true);
  });
  it('rejects unknown closures, accessors and oversized entries without executing getters', () => {
    const codec = new ReplayCheckpointCodec(); let reads = 0;
    expect(() => codec.encode({ callback: () => undefined })).toThrowError(/unapproved-function/);
    const owner = new State();
    class RequestBound { read(): State { return owner; } }
    expect(() => codec.encode(new RequestBound())).toThrowError(/unapproved-prototype/);
    const source = Object.defineProperty({}, 'field', { get: () => { reads++; return 1; } });
    expect(() => codec.encode(source)).toThrowError(/accessor/); expect(reads).toBe(0);
    expect(() => codec.encode({ data: 'large'.repeat(1000) }, 100)).toThrowError(/size/);
    expect(() => codec.decode(Buffer.from('bad'))).toThrow();
  });
  it('declines cards with known bookkeeping outside the captured graph', () => {
    const codec = new ReplayCheckpointCodec();
    expect(() => codec.encode(new HeatranLVX())).toThrowError(/class-static-state/);
    expect(() => codec.encode(new Orthwormex())).toThrowError(/external-class-state/);
  });
});
