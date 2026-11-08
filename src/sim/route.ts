import type { LaneGraph, Track } from './lanes';

export interface RoadPos { segId: number; t: number } // t: 도로 시작 노드에서의 거리(m)
export interface Route { path: number[]; startS: number; endS: number }

// 도로 위 위치 → 그 차선 위에서의 거리(0~차선 길이)
export function laneS(lane: Track, t: number): number {
  const s = lane.fwd ? t - lane.t0 : lane.t0 - t;
  return Math.min(Math.max(s, 0), lane.length);
}

class MinHeap {
  private a: [number, number][] = [];
  get size() { return this.a.length; }
  push(c: number, id: number) {
    const a = this.a;
    a.push([c, id]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const MIN_TRIP = 3; // 출발·도착이 같은 차선 위에서 이보다 가까우면 직진 경로로 보지 않는다(m)

/** 출발 도로의 아무 차선에서 시작해 도착 도로의 아무 차선에서 끝나는 최단 시간 경로. 없으면 null */
export function findRoute(g: LaneGraph, from: RoadPos, to: RoadPos): Route | null {
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const startS = new Map<number, number>();
  const heap = new MinHeap();
  let best = { cost: Infinity, last: -1, via: -1, endS: 0 };

  for (const L of g.lanesOfSeg.get(from.segId) ?? []) {
    const s0 = laneS(L, from.t);
    startS.set(L.id, s0);
    const c = (L.length - s0) / L.vmax;
    dist.set(L.id, c);
    prev.set(L.id, -1);
    heap.push(c, L.id);
    if (L.segId === to.segId) {
      const e = laneS(L, to.t);
      if (e - s0 >= MIN_TRIP && (e - s0) / L.vmax < best.cost) best = { cost: (e - s0) / L.vmax, last: L.id, via: -1, endS: e };
    }
  }

  while (heap.size) {
    const [c, id] = heap.pop();
    if (c > (dist.get(id) ?? Infinity) + 1e-9) continue;
    if (c >= best.cost) break;
    for (const nid of g.tracks[id].next) {
      const N = g.tracks[nid];
      if (N.kind === 'lane' && N.segId === to.segId) {
        const e = laneS(N, to.t);
        const fc = c + e / N.vmax;
        if (fc < best.cost) best = { cost: fc, last: nid, via: id, endS: e };
      }
      const nc = c + N.length / N.vmax;
      if (nc < (dist.get(nid) ?? Infinity)) {
        dist.set(nid, nc);
        prev.set(nid, id);
        heap.push(nc, nid);
      }
    }
  }
  if (best.last < 0) return null;

  const path = [best.last];
  for (let cur = best.via; cur !== -1; cur = prev.get(cur) ?? -1) path.unshift(cur);
  return { path, startS: startS.get(path[0]) ?? 0, endS: best.endS };
}
