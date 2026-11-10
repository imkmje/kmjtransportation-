import type { Config } from '../config';
import type { Network } from './network';
import type { LaneGraph } from './lanes';
import type { Vehicle } from './traffic';

export type Light = 'green' | 'yellow' | 'red';

/**
 * 신호등(1.2.0). 신호가 켜진 교차로마다 접근로를 "단계"로 묶어 돌아가며 녹색을 준다.
 * 마주 보는 접근로(각도 차 180° ± straightDeg)는 한 단계로 묶고, 짝이 없는 접근로는 혼자 한 단계.
 * 상태는 tick과 단계 목록만으로 정해지므로 따로 저장하지 않는다(저장·불러오기에 영향 없음).
 */
export class Signals {
  private rev = -1;
  private plans = new Map<number, number[][]>();
  constructor(private cfg: Config, private net: Network) {}

  /** 교차로 nodeId의 단계 목록(각 단계 = 녹색을 받는 도로 구간 ID들) */
  phases(nodeId: number): number[][] {
    if (this.rev !== this.net.revision) { this.plans.clear(); this.rev = this.net.revision; }
    let p = this.plans.get(nodeId);
    if (!p) { p = this.build(nodeId); this.plans.set(nodeId, p); }
    return p;
  }

  private build(nodeId: number): number[][] {
    const n = this.net.nodes.get(nodeId)!;
    const ap = this.net.segmentsAt(nodeId).map((s) => {
      const o = this.net.nodes.get(s.a === nodeId ? s.b : s.a)!;
      return { id: s.id, ang: Math.atan2(o.y - n.y, o.x - n.x) };
    }).sort((a, b) => a.ang - b.ang || a.id - b.id);
    const tol = (this.cfg.intersection.straightDeg * Math.PI) / 180;
    const used = new Set<number>(), out: number[][] = [];
    for (const a of ap) {
      if (used.has(a.id)) continue;
      used.add(a.id);
      const ph = [a.id];
      for (const b of ap) {
        if (used.has(b.id)) continue;
        let d = Math.abs(a.ang - b.ang) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (Math.abs(d - Math.PI) <= tol) { used.add(b.id); ph.push(b.id); break; }
      }
      out.push(ph);
    }
    const order = this.net.nodes.get(nodeId)!.sigOrder; // 편집한 단계 순서(0..n-1의 순열). 단계 수가 맞지 않으면 무시
    if (order.length === out.length && new Set(order).size === out.length) return order.map((k) => out[k]);
    return out;
  }

  /** 고정식 단계의 녹색 시간(초): 도로 등급이 높은 접근로가 있는 단계는 그 등급에 비례해 더 길다(큰길에 녹색을 더 준다) */
  private topRank(ph: number[]): number { return Math.max(...ph.map((id) => this.cfg.roads[this.net.segments.get(id)!.kind].rank)); }
  private green(nodeId: number, ph: number[], i = this.phases(nodeId).indexOf(ph)): number {
    const n = this.net.nodes.get(nodeId)!;
    return n.sigGreens[i] ?? (n.sigGreen || this.cfg.signals.greenSec) * this.topRank(ph);
  }

  /** 편집 창용: 교차로의 단계별 {도로 구간들, 고정식 녹색 시간(초)} */
  program(nodeId: number): { segs: number[]; green: number }[] {
    return this.phases(nodeId).map((segs, i) => ({ segs, green: this.green(nodeId, segs, i) }));
  }

  private cycle(nodeId: number): number {
    const s = this.cfg.signals;
    return this.phases(nodeId).reduce((t, ph, i) => t + this.green(nodeId, ph, i) + s.yellowSec + s.allRedSec, 0);
  }

  /** 고정식: 도로 segId가 속한 단계의 녹색이 한 주기 안에서 시작하는 시각(초) */
  private phaseStart(nodeId: number, segId: number): number | null {
    const s = this.cfg.signals, ph = this.phases(nodeId);
    let t = 0;
    for (let i = 0; i < ph.length; i++) { if (ph[i].includes(segId)) return t; t += this.green(nodeId, ph[i], i) + s.yellowSec + s.allRedSec; }
    return null;
  }

  /**
   * 녹색파(고정식 신호끼리): fromNode의 신호를 기준으로, segId 도로를 따라 반대쪽 교차로로 가는 차량이
   * "도로 길이 ÷ 제한속도"만큼 뒤에 그쪽의 녹색을 만나도록 반대쪽 교차로의 시차(sigOffset)를 정한다.
   * 단계 수가 같으면 반대쪽에 같은 녹색 시간(공통 주기)을 복사한다. 반대 방향 차량까지 맞추지는 못한다(한쪽 방향만)
   */
  greenWave(segId: number, fromNode: number): { ok: true; offset: number; travelSec: number } | { ok: false; error: 'notFixed' | 'noSuchRoad' } {
    const seg = this.net.segments.get(segId);
    if (!seg || (seg.a !== fromNode && seg.b !== fromNode)) return { ok: false, error: 'noSuchRoad' };
    const to = seg.a === fromNode ? seg.b : seg.a;
    const ok = (n: number) => this.net.hasSignal(n) && !this.net.isActuated(n);
    if (!ok(fromNode) || !ok(to)) return { ok: false, error: 'notFixed' };
    const A = this.net.nodes.get(fromNode)!, B = this.net.nodes.get(to)!;
    // 공통 주기: 단계 수가 같으면 B의 녹색 시간을 A와 같게
    if (this.phases(to).length === this.phases(fromNode).length) B.sigGreens = this.program(fromNode).map((p) => p.green);
    const road = this.cfg.roads[seg.kind];
    const travel = this.net.segmentLength(seg) / (((seg.playerSpeedKmh ?? road.defaultSpeedKmh) * 1000) / 3600);
    const startA = A.sigOffset + (this.phaseStart(fromNode, segId) ?? 0);
    const cycB = this.cycle(to);
    B.sigOffset = (((startA + travel - (this.phaseStart(to, segId) ?? 0)) % cycB) + cycB) % cycB;
    this.net.revision++;
    return { ok: true, offset: B.sigOffset, travelSec: travel };
  }

  /**
   * 연속 녹색파: 한 쌍을 맞춘 뒤, 도착한 교차로에서 직진으로 이어지는 도로를 따라 고정식 신호가 이어지는 한 계속 맞춘다.
   * linked = 맞춘 교차로 수(첫 쌍 포함 2곳 이상이면 연속). 감응식·신호 없는 교차로를 만나면 거기서 멈춘다
   */
  greenWaveChain(segId: number, fromNode: number): ReturnType<Signals['greenWave']> & { linked?: number } {
    const first = this.greenWave(segId, fromNode);
    if (!first.ok) return first;
    let linked = 2, seg = segId, from = fromNode;
    const tol = (this.cfg.intersection.straightDeg * Math.PI) / 180;
    for (let guard = 0; guard < 40; guard++) {
      const sg = this.net.segments.get(seg)!, to = sg.a === from ? sg.b : sg.a, T = this.net.nodes.get(to)!, F = this.net.nodes.get(from)!;
      const inAng = Math.atan2(T.y - F.y, T.x - F.x);
      let next: { id: number; node: number } | null = null, best = tol;
      for (const o of this.net.segmentsAt(to)) {
        if (o.id === seg) continue;
        const n2 = o.a === to ? o.b : o.a, N = this.net.nodes.get(n2)!;
        let d = Math.abs(Math.atan2(N.y - T.y, N.x - T.x) - inAng) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (d <= best) { best = d; next = { id: o.id, node: n2 }; }
      }
      if (!next) break;
      const r = this.greenWave(next.id, to);
      if (!r.ok) break;
      linked++; seg = next.id; from = to;
    }
    return { ...first, linked };
  }

  /** 감응식 교차로의 현재 상태: 지금 녹색을 받는 단계 i, 하위 상태, 그 상태가 시작된 tick, 마지막으로 차가 감지된 tick */
  private states = new Map<number, { i: number; sub: Light; t0: number; lastCar: number }>();

  /** 매 tick 호출: 감응식 교차로의 단계를 차량 감지에 따라 진행한다(교차로 ID 순서) */
  step(tick: number, vehicles: Iterable<Vehicle>, graph: LaneGraph): void {
    const s = this.cfg.signals, rate = this.cfg.tickRate;
    const act = [...this.net.nodes.keys()].filter((id) => this.net.isActuated(id));
    for (const k of [...this.states.keys()]) if (!act.includes(k)) this.states.delete(k);
    if (!act.length) return;
    const want = new Set<string>();
    for (const v of vehicles) {
      const tr = graph.tracks[v.path[v.pi]];
      if (tr.kind === 'lane' && this.net.isActuated(tr.to) && tr.length - v.s <= s.detectM) want.add(`${tr.to}:${tr.segId}`);
    }
    for (const n of act) {
      const ph = this.phases(n);
      let st = this.states.get(n);
      if (!st || st.i >= ph.length) { st = { i: 0, sub: 'green', t0: tick, lastCar: tick }; this.states.set(n, st); }
      const demand = (i: number) => ph[i].some((seg) => want.has(`${n}:${seg}`));
      const el = (tick - st.t0) / rate;
      if (st.sub === 'green') {
        if (demand(st.i)) st.lastCar = tick;
        const others = ph.some((_, i) => i !== st.i && demand(i));
        const k = this.topRank(ph[st.i]); // 큰 도로가 낀 방향은 최소·최대 녹색을 더 길게 줘서, 작은 길 차 한 대 때문에 큰길 흐름이 자주 끊기지 않게 한다
        if (others && el >= s.minGreenSec * k && ((tick - st.lastCar) / rate > s.gapSec || el >= s.maxGreenSec * k)) { st.sub = 'yellow'; st.t0 = tick; }
      } else if (st.sub === 'yellow') {
        if (el >= s.yellowSec) { st.sub = 'red'; st.t0 = tick; }
      } else if (el >= s.allRedSec) {
        let j = st.i;
        for (let k = 1; k <= ph.length; k++) { const c = (st.i + k) % ph.length; if (demand(c)) { j = c; break; } }
        st.i = j; st.sub = 'green'; st.t0 = tick; st.lastCar = tick;
      }
    }
  }

  /** tick에서 nodeId로 들어오는 도로 segId의 신호 */
  light(nodeId: number, segId: number, tick: number): Light {
    const s = this.cfg.signals, ph = this.phases(nodeId);
    if (this.net.isActuated(nodeId)) {
      const st = this.states.get(nodeId);
      return st && ph[st.i]?.includes(segId) ? st.sub : 'red';
    }
    const slots = ph.map((p, i) => this.green(nodeId, p, i) + s.yellowSec + s.allRedSec);
    const total = slots.reduce((a, b) => a + b, 0);
    let t = ((((tick / this.cfg.tickRate) - this.net.nodes.get(nodeId)!.sigOffset) % total) + total) % total;
    for (let i = 0; i < ph.length; i++) {
      if (t >= slots[i]) { t -= slots[i]; continue; }
      if (!ph[i].includes(segId)) return 'red';
      const g = this.green(nodeId, ph[i], i);
      return t < g ? 'green' : t < g + s.yellowSec ? 'yellow' : 'red';
    }
    return 'red';
  }

  /** 신호 프로그램 복사: 방식(고정식·감응식)과, 고정식이면 단계별 녹색 시간·시차 */
  copyProgram(nodeId: number): { mode: 'fixed' | 'actuated'; greens: number[]; offset: number } | null {
    if (!this.net.hasSignal(nodeId)) return null;
    if (this.net.isActuated(nodeId)) return { mode: 'actuated', greens: [], offset: 0 };
    return { mode: 'fixed', greens: this.program(nodeId).map((p) => p.green), offset: this.net.nodes.get(nodeId)!.sigOffset };
  }

  /** 붙여넣기: 신호를 켜고 방식을 맞춘다. 고정식은 단계 수가 같을 때만 녹색 시간·시차까지 복사한다(다르면 기본 시간). 단계 수가 달라 녹색 시간을 복사하지 못했으면 applied=false */
  pasteProgram(nodeId: number, p: { mode: 'fixed' | 'actuated'; greens: number[]; offset: number }): { ok: true; applied: boolean } | { ok: false; error: 'notIntersection' } {
    const r = this.net.setSignal(nodeId, true, p.mode, 0);
    if (!r.ok) return { ok: false, error: 'notIntersection' };
    if (p.mode === 'fixed' && p.greens.length && p.greens.length === this.phases(nodeId).length) {
      this.net.setSignalProgram(nodeId, { greens: p.greens, offset: p.offset });
      return { ok: true, applied: true };
    }
    return { ok: true, applied: p.mode === 'actuated' || !p.greens.length };
  }

  getState() { return [...this.states].map(([k, v]) => [k, { ...v }] as [number, { i: number; sub: Light; t0: number; lastCar: number }]); }
  setState(s: ReturnType<Signals['getState']> | undefined): void { this.states = new Map((s ?? []).map(([k, v]) => [k, { ...v }])); }
  reset(): void { this.states.clear(); }
}
