import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { exportAll, importAll, saveSlot, loadSlot } from '../src/ui/saves';

/** key·length까지 있는 가짜 저장소(기기 하나) */
const device = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } };
};

describe('기기 옮기기(모든 기록)', () => {
  it('A 기기의 기록 전부를 B 기기로: 게임 저장은 파일 것, 업적·통계·시나리오 기록은 합친다', () => {
    const g = new Game(3, undefined, { sandbox: true });
    const A = device({ 'the-air-save': '{"day":99}', 'the-air-theme': 'dark', 'other-app': 'x',
      'the-air-profile': JSON.stringify({ ach: ['a1', 'a2'], stats: { games: 5, bestRev: 300, months: 40 } }),
      'the-air-records': JSON.stringify({ free: [{ score: 900, when: 'A' }] }) });
    saveSlot(1, g, A);
    const B = device({ 'the-air-save': '{"day":1}',
      'the-air-profile': JSON.stringify({ ach: ['a2', 'b1'], stats: { games: 7, bestRev: 100, won: 2 } }),
      'the-air-records': JSON.stringify({ free: [{ score: 500, when: 'B' }], europe: [{ score: 10, when: 'B' }] }) });
    const file = exportAll(A); expect(JSON.parse(file).data['other-app']).toBeUndefined(); // 다른 앱 것은 담지 않는다
    const r = importAll(file, B); expect(r.ok).toBe(true);
    expect(B.getItem('the-air-save')).toBe('{"day":99}'); expect(B.getItem('the-air-theme')).toBe('dark'); expect(loadSlot(1, B)).not.toBeNull();
    const prof = JSON.parse(B.getItem('the-air-profile')!); expect(new Set(prof.ach)).toEqual(new Set(['a1', 'a2', 'b1']));
    expect(prof.stats).toEqual({ games: 7, bestRev: 300, months: 40, won: 2 }); // 항목마다 큰 값
    const rec = JSON.parse(B.getItem('the-air-records')!); expect(rec.free.map((x: { score: number }) => x.score)).toEqual([900, 500]); expect(rec.europe.length).toBe(1);
    expect(importAll(file, B).ok).toBe(true); expect(JSON.parse(B.getItem('the-air-records')!).free.length).toBe(2); // 두 번 가져와도 겹치지 않는다
  });
  it('잘못된 파일은 거절한다', () => {
    const B = device();
    expect(importAll('nope', B).ok).toBe(false);
    expect(importAll(JSON.stringify({ 'the-air-export': 1, game: {} }), B).ok).toBe(false); // 게임 하나짜리 파일
    expect(importAll(JSON.stringify({ 'the-air-all': 1, data: {} }), B).ok).toBe(false); // 빈 파일
  });
});
