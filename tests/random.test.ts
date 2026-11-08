import { describe, it, expect } from 'vitest';
import { Rng } from '../src/sim/random';

describe('시드 난수', () => {
  it('같은 시드면 같은 수열', () => {
    const a = new Rng(1), b = new Rng(1);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('저장한 상태에서 이어서 뽑으면 끊김 없이 같다', () => {
    const a = new Rng(7);
    for (let i = 0; i < 10; i++) a.next();
    const saved = a.getState();
    const expected = [a.next(), a.next(), a.next()];
    const b = new Rng(0);
    b.setState(saved);
    expect([b.next(), b.next(), b.next()]).toEqual(expected);
  });
  it('0 이상 1 미만', () => {
    const r = new Rng(3);
    for (let i = 0; i < 1000; i++) { const v = r.next(); expect(v >= 0 && v < 1).toBe(true); }
  });
});
