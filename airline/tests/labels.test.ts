import { describe, it, expect } from 'vitest';
import { placeLabels, type LabelItem } from '../src/ui/labels';

const W = 52, H = 14;
const rectOf = (it: LabelItem, p: { x: number; y: number; align: string }) => {
  const x0 = p.align === 'left' ? p.x : p.align === 'right' ? p.x - it.w : p.x - it.w / 2;
  return { x0, y0: p.y - it.h / 2, x1: x0 + it.w, y1: p.y + it.h / 2 };
};
const overlap = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

describe('도시 이름표 배치', () => {
  it('가까이 모인 도시들도 이름표가 서로 겹치지 않는다', () => {
    const items: LabelItem[] = [
      { id: 'A', x: 300, y: 200, w: W, h: H, priority: 10 }, { id: 'B', x: 306, y: 212, w: W, h: H, priority: 8 },
      { id: 'C', x: 292, y: 208, w: W, h: H, priority: 6 }, { id: 'D', x: 312, y: 196, w: W, h: H, priority: 5 }, { id: 'E', x: 300, y: 222, w: W, h: H, priority: 4 },
    ];
    const placed = placeLabels(items, { w: 800, h: 600 });
    const rects = items.filter((i) => placed.has(i.id)).map((i) => ({ id: i.id, r: rectOf(i, placed.get(i.id)!) }));
    expect(rects.length).toBeGreaterThanOrEqual(3); // 우선순위가 높은 것은 놓인다
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i].r, rects[j].r)).toBe(false);
    expect(placed.has('A')).toBe(true); // 가장 중요한 도시는 항상 놓인다
  });
  it('필수 표시(선택한 도시)는 자리가 없어도 놓이고, 중요하지 않은 도시는 숨겨질 수 있다', () => {
    const items: LabelItem[] = Array.from({ length: 12 }, (_, i) => ({ id: `C${i}`, x: 400 + (i % 3) * 3, y: 300 + (i % 4) * 3, w: W, h: H, priority: 12 - i }));
    items[11].force = true;
    const placed = placeLabels(items, { w: 800, h: 600 });
    expect(placed.has('C11')).toBe(true);
    expect(placed.size).toBeLessThan(12); // 너무 붐비면 일부는 숨긴다
  });
  it('화면 밖으로 나가지 않고, 선호 위치가 비어 있으면 그 위치를 쓴다', () => {
    const items: LabelItem[] = [{ id: 'X', x: 790, y: 10, w: W, h: H, priority: 1 }, { id: 'Y', x: 400, y: 300, w: W, h: H, priority: 1, pref: { dx: -11, dy: 6, align: 'right' } }];
    const placed = placeLabels(items, { w: 800, h: 600 });
    const x = placed.get('X'); expect(x).toBeDefined();
    const r = rectOf(items[0], x!); expect(r.x1).toBeLessThanOrEqual(800); expect(r.x0).toBeGreaterThanOrEqual(0); expect(r.y0).toBeGreaterThanOrEqual(0);
    expect(placed.get('Y')).toEqual({ x: 389, y: 306, align: 'right' });
  });
});
