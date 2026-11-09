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
    return out;
  }

  /** 고정식 단계의 녹색 시간(초): 도로 등급이 높은 접근로가 있는 단계는 그 등급에 비례해 더 길다(큰길에 녹색을 더 준다) */
  private green(nodeId: number, ph: number[]): number {
    const top = Math.max(...ph.map((id) => this.cfg.roads[this.net.segments.get(id)!.kind].rank));
    return (this.net.nodes.get(nodeId)!.sigGreen || this.cfg.signals.greenSec) * top;
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
        if (others && el >= s.minGreenSec && ((tick - st.lastCar) / rate > s.gapSec || el >= s.maxGreenSec)) { st.sub = 'yellow'; st.t0 = tick; }
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
    const slots = ph.map((p) => this.green(nodeId, p) + s.yellowSec + s.allRedSec);
    let t = (tick / this.cfg.tickRate) % slots.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ph.length; i++) {
      if (t >= slots[i]) { t -= slots[i]; continue; }
      if (!ph[i].includes(segId)) return 'red';
      const g = this.green(nodeId, ph[i]);
      return t < g ? 'green' : t < g + s.yellowSec ? 'yellow' : 'red';
    }
    return 'red';
  }

  getState() { return [...this.states].map(([k, v]) => [k, { ...v }] as [number, { i: number; sub: Light; t0: number; lastCar: number }]); }
  setState(s: ReturnType<Signals['getState']> | undefined): void { this.states = new Map((s ?? []).map(([k, v]) => [k, { ...v }])); }
  reset(): void { this.states.clear(); }
}
