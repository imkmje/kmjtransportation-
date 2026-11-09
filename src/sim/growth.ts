import type { Config } from '../config';
import type { Metrics } from './metrics';
import type { BuildingKind, BuildingSize, Network, ZoneType } from './network';
import type { Rng } from './random';

/** 수요 막대(0~100). 막대가 높을수록 그 종류 구역에 건물이 빨리 자란다 */
export interface DemandBars { home: number; office: number; shop: number; school: number }
const TYPES: ZoneType[] = ['home', 'office', 'shop', 'school'];
const SIZES: BuildingSize[] = ['large', 'medium', 'small']; // 큰 것부터 시도하고 안 들어가면 작은 것으로

/**
 * 건물 성장(심시티식). 일정 시간(stepSec)마다 수요 막대만큼 구역 빈 칸에 건물이 자란다.
 * 수요 = 기본값 + 일자리와 직장인의 불균형 − 교통 정체 감점. 세금·건물 레벨업은 없다.
 */
export class Growth {
  private acc: Record<ZoneType, number> = { home: 0, office: 0, shop: 0, school: 0 };
  private readonly stepTicks: number;

  constructor(private cfg: Config, private net: Network, private rng: Rng, private metrics: Metrics) {
    this.stepTicks = Math.round(cfg.growth.stepSec * cfg.tickRate);
  }

  bars(): DemandBars {
    const g = this.cfg.growth;
    let workers = 0, jobs = 0, residents = 0, shops = 0, schools = 0;
    for (const b of this.net.buildings.values()) {
      const c = this.cfg.buildings.capacity[b.size];
      if (b.kind === 'home') { workers += c * this.cfg.demand.workerShare; residents += c; }
      else if (b.kind === 'office' || b.kind === 'factory') jobs += c;
      else if (b.kind === 'shop') shops += c;
      else if (b.kind === 'school') schools += c;
    }
    const scale = g.scaleBase + g.scaleDiv * (workers + jobs);
    const pen = 1 - g.trafficPenalty * Math.min(1, (this.metrics.rollingCI() ?? 0) / g.trafficFull);
    const bar = (diff: number) => Math.max(0, Math.min(100, g.base + (100 * diff) / scale)) * pen;
    // 상업: 거주자 수에 비례하는 방문 수요 대비 상점 수용량. 주민이 없으면 지을 이유가 없어 기본값 없이 0
    const shopBar = residents > 0 ? bar(g.shopPerResident * residents - shops) : 0;
    const schoolBar = residents > 0 ? bar(g.schoolPerResident * residents - schools) : 0;
    return { home: bar(jobs - workers), office: bar(workers - jobs), shop: shopBar, school: schoolBar };
  }

  step(tick: number): void {
    if (tick % this.stepTicks !== 0) return;
    const bars = this.bars();
    for (const t of TYPES) {
      this.acc[t] = Math.min(this.cfg.growth.maxAccum, this.acc[t] + bars[t] / 100);
      while (this.acc[t] >= 1 && this.grow(t)) this.acc[t] -= 1;
    }
  }

  /** 빈 구역 칸 하나에 건물을 짓는다. 자리가 없으면 false */
  private grow(type: ZoneType): boolean {
    const cells = this.net.freeZoneCells(type), w = this.cfg.growth.sizeWeights, c = this.cfg.zones.cell;
    for (let tries = 0; tries < 5 && cells.length; tries++) {
      const cell = cells.splice(Math.floor(this.rng.next() * cells.length), 1)[0];
      let r = this.rng.next() * (w.small + w.medium + w.large);
      let size: BuildingSize = 'small';
      for (const s of SIZES) { if (r < w[s]) { size = s; break; } r -= w[s]; }
      const variant = 1 + Math.floor(this.rng.next() * 1023);
      // 직장 구역에는 사무 건물과 공장이 섞여 자란다
      const kind: BuildingKind = type === 'office' && this.rng.next() < this.cfg.growth.factoryShare ? 'factory' : type;
      for (const s of SIZES.slice(SIZES.indexOf(size))) {
        if (this.net.addBuilding(kind, s, cell.i * c, cell.j * c, 'auto', true, variant).ok) return true;
      }
    }
    return false;
  }

  reset(): void { this.acc = { home: 0, office: 0, shop: 0, school: 0 }; }
  getState() { return { acc: { ...this.acc } }; }
  setState(s: ReturnType<Growth['getState']> | undefined): void { this.acc = { home: 0, office: 0, shop: 0, school: 0, ...(s?.acc ?? {}) }; }
}
