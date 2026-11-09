import type { Config } from '../config';
import type { Metrics } from './metrics';
import type { BuildingKind, BuildingSize, Network, ZoneType } from './network';
import type { Rng } from './random';

/** 수요 막대(0~100). 막대가 높을수록 그 종류 구역에 건물이 빨리 자란다(CS2처럼 주거는 밀도별, 상업·산업·사무는 따로) */
export interface DemandBars { home: number; homeMid: number; homeHigh: number; shop: number; office: number; industrial: number }
export const ZONE_TYPES: ZoneType[] = ['home', 'homeMid', 'homeHigh', 'shop', 'office', 'industrial'];
const SIZES: BuildingSize[] = ['large', 'medium', 'small']; // 큰 것부터 시도하고 안 들어가면 작은 것으로
const MIN_SIZE: Partial<Record<ZoneType, BuildingSize>> = { homeMid: 'medium', homeHigh: 'large' }; // 중·고밀은 작은 건물로 대체하지 않는다
const zero = (): Record<ZoneType, number> => ({ home: 0, homeMid: 0, homeHigh: 0, shop: 0, office: 0, industrial: 0 });

/**
 * 건물 성장(심시티식). 일정 시간(stepSec)마다 수요 막대만큼 구역 빈 칸에 건물이 자란다.
 * 수요 = 기본값 + 일자리와 직장인의 불균형 − 교통 정체 감점. 세금·건물 레벨업은 없다.
 */
export class Growth {
  private acc: Record<ZoneType, number> = zero();
  private readonly stepTicks: number;

  constructor(private cfg: Config, private net: Network, private rng: Rng, private metrics: Metrics) {
    this.stepTicks = Math.round(cfg.growth.stepSec * cfg.tickRate);
  }

  bars(): DemandBars {
    const g = this.cfg.growth, cap = this.cfg.buildings.capacity;
    let workers = 0, officeJobs = 0, industrialJobs = 0, residents = 0, shops = 0;
    for (const b of this.net.buildings.values()) {
      const c = cap[b.size];
      if (b.kind === 'home') { const n = c * this.cfg.densityCap[b.density]; workers += n * this.cfg.demand.workerShare; residents += n; }
      else if (b.kind === 'office') officeJobs += c;
      else if (b.kind === 'factory') industrialJobs += c;
      else if (b.kind === 'shop') shops += c;
    }
    const jobs = officeJobs + industrialJobs;
    const scale = g.scaleBase + g.scaleDiv * (workers + jobs);
    const pen = 1 - g.trafficPenalty * Math.min(1, (this.metrics.rollingCI() ?? 0) / g.trafficFull);
    const bar = (diff: number) => Math.max(0, Math.min(100, g.base + (100 * diff) / scale)) * pen;
    // 주거: 일자리가 모자라 직장인이 남으면 줄고, 일자리가 많으면 는다. 밀도별로는 도시 규모에 따라 배분
    const homeBar = bar(jobs - workers);
    const m = g.densityMix, w0 = Math.max(m.lowMin, 1 - residents / m.lowDiv), w2 = Math.min(m.highMax, Math.max(m.highMin, residents / m.highDiv)), w1 = Math.max(m.midMin, 1 - w0 - w2); // 거주자가 없어도 중·고밀 수요가 조금은 있다(없으면 처음에 시작할 수 없다)
    const top = Math.max(w0, w1, w2);
    // 상업: 거주자 수에 비례하는 방문 수요 대비 상점 수용량. 주민이 없으면 지을 이유가 없어 0
    const shopBar = residents > 0 ? bar(g.shopPerResident * residents - shops) : 0;
    // 직장: 필요한 일자리를 사무와 산업으로 나눈다(산업 몫 industrialShare)
    return {
      home: (homeBar * w0) / top, homeMid: (homeBar * w1) / top, homeHigh: (homeBar * w2) / top, shop: shopBar,
      office: bar((1 - g.industrialShare) * workers - officeJobs), industrial: bar(g.industrialShare * workers - industrialJobs),
    };
  }

  step(tick: number): void {
    if (tick % this.stepTicks !== 0) return;
    const bars = this.bars();
    for (const t of ZONE_TYPES) {
      this.acc[t] = Math.min(this.cfg.growth.maxAccum, this.acc[t] + bars[t] / 100);
      while (this.acc[t] >= 1 && this.grow(t)) this.acc[t] -= 1;
    }
  }

  /** 빈 구역 칸에 건물을 짓는다(대형은 빈 칸 2×2). 자리가 없으면 false */
  private grow(type: ZoneType): boolean {
    const cells = this.net.freeZoneCells(type), w = this.cfg.growth.sizeWeights[type], c = this.cfg.zones.cell;
    const free = new Set(cells.map((z) => `${z.i},${z.j}`));
    for (let tries = 0; tries < 6 && cells.length; tries++) {
      const cell = cells.splice(Math.floor(this.rng.next() * cells.length), 1)[0];
      let r = this.rng.next() * (w.small + w.medium + w.large);
      let size: BuildingSize = 'small';
      for (const s of SIZES) { if (r < w[s]) { size = s; break; } r -= w[s]; }
      const variant = 1 + Math.floor(this.rng.next() * 1023);
      const kind: BuildingKind = type === 'industrial' ? 'factory' : type === 'homeMid' || type === 'homeHigh' ? 'home' : type;
      const density = type === 'homeMid' ? 1 : type === 'homeHigh' ? 2 : 0;
      const min = MIN_SIZE[type] ?? 'small';
      for (const s of SIZES.slice(SIZES.indexOf(size))) {
        if (SIZES.indexOf(s) > SIZES.indexOf(min)) break;
        if (s === 'large') { // 2×2칸: 이 칸을 왼쪽 위 모서리로, 나머지 세 칸도 비어 있어야 한다
          if (![[1, 0], [0, 1], [1, 1]].every(([di, dj]) => free.has(`${cell.i + di},${cell.j + dj}`))) continue;
          if (this.net.addBuilding(kind, s, cell.i * c + c / 2, cell.j * c + c / 2, 'auto', true, variant, density).ok) return true;
        } else if (this.net.addBuilding(kind, s, cell.i * c, cell.j * c, 'auto', true, variant, density).ok) return true;
      }
    }
    return false;
  }

  reset(): void { this.acc = zero(); }
  getState() { return { acc: { ...this.acc } }; }
  setState(s: ReturnType<Growth['getState']> | undefined): void { this.acc = { ...zero(), ...(s?.acc ?? {}) }; }
}
