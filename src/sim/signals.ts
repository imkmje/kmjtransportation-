import type { Config } from '../config';
import type { Network } from './network';

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

  /** 단계의 녹색 시간(초): 도로 등급이 높은 접근로가 있는 단계는 그 등급에 비례해 더 길다(큰길에 녹색을 더 준다) */
  private green(ph: number[]): number {
    const top = Math.max(...ph.map((id) => this.cfg.roads[this.net.segments.get(id)!.kind].rank));
    return this.cfg.signals.greenSec * top;
  }

  /** tick에서 nodeId로 들어오는 도로 segId의 신호 */
  light(nodeId: number, segId: number, tick: number): Light {
    const s = this.cfg.signals, ph = this.phases(nodeId);
    const slots = ph.map((p) => this.green(p) + s.yellowSec + s.allRedSec);
    let t = (tick / this.cfg.tickRate) % slots.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ph.length; i++) {
      if (t >= slots[i]) { t -= slots[i]; continue; }
      if (!ph[i].includes(segId)) return 'red';
      const g = this.green(ph[i]);
      return t < g ? 'green' : t < g + s.yellowSec ? 'yellow' : 'red';
    }
    return 'red';
  }
}
