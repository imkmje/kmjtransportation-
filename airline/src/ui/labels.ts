/** 지도 도시 이름표 배치: 겹치지 않는 자리를 찾아 놓고, 자리가 없으면(중요하지 않은 도시는) 이름을 숨긴다 */
export interface LabelItem { id: string; x: number; y: number; w: number; h: number; priority: number; force?: boolean; pref?: { dx: number; dy: number; align?: 'right' } }
export interface Placed { x: number; y: number; align: 'left' | 'right' | 'center' } // (x, y): 글자 기준점(가운데 세로 정렬)
interface Rect { x0: number; y0: number; x1: number; y1: number }

const hit = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

export function placeLabels(items: LabelItem[], bounds: { w: number; h: number }, dotR = 9): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const used: Rect[] = items.map((i) => ({ x0: i.x - dotR, y0: i.y - dotR, x1: i.x + dotR, y1: i.y + dotR })); // 점 자체도 장애물
  const order = [...items].sort((a, b) => (b.force ? 1 : 0) - (a.force ? 1 : 0) || b.priority - a.priority || (a.id < b.id ? -1 : 1));
  for (const it of order) {
    const g = 12, cand: { dx: number; dy: number; align: 'left' | 'right' | 'center' }[] = [];
    if (it.pref) cand.push({ dx: it.pref.dx, dy: it.pref.dy, align: it.pref.align === 'right' ? 'right' : 'left' });
    cand.push({ dx: g, dy: 0, align: 'left' }, { dx: -g, dy: 0, align: 'right' }, { dx: 0, dy: -g - 2, align: 'center' }, { dx: 0, dy: g + 6, align: 'center' },
      { dx: g, dy: -g, align: 'left' }, { dx: -g, dy: -g, align: 'right' }, { dx: g, dy: g, align: 'left' }, { dx: -g, dy: g, align: 'right' },
      { dx: g + 14, dy: 0, align: 'left' }, { dx: -g - 14, dy: 0, align: 'right' });
    let chosen: Placed | null = null, rect: Rect | null = null;
    for (const c of cand) {
      const x0 = c.align === 'left' ? it.x + c.dx : c.align === 'right' ? it.x + c.dx - it.w : it.x + c.dx - it.w / 2;
      const r: Rect = { x0, y0: it.y + c.dy - it.h / 2, x1: x0 + it.w, y1: it.y + c.dy + it.h / 2 };
      if (r.x0 < 0 || r.y0 < 0 || r.x1 > bounds.w || r.y1 > bounds.h) continue;
      // 자기 점과는 겹쳐도 되지만 다른 이름표·다른 점과는 안 된다(점 장애물은 맨 앞 items.length개)
      if (used.some((u, i) => (i < items.length && items[i].id === it.id ? false : hit(r, u)))) continue;
      chosen = { x: it.x + c.dx, y: it.y + c.dy, align: c.align }; rect = r; break;
    }
    if (!chosen && it.force) { const c = cand[0]; chosen = { x: it.x + c.dx, y: it.y + c.dy, align: c.align }; rect = { x0: it.x, y0: it.y - it.h / 2, x1: it.x + it.w, y1: it.y + it.h / 2 }; }
    if (chosen && rect) { out.set(it.id, chosen); used.push(rect); }
  }
  return out;
}
