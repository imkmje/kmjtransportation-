import { Config } from '../config';
import { Demand } from './demand';
import { Growth } from './growth';
import { Metrics } from './metrics';
import type { Network } from './network';
import { Rng } from './random';
import { clockAt, ClockTime } from './time';
import { Traffic } from './traffic';

// 순수 시뮬레이션 상태. 화면(DOM, Three.js)을 모른다.
export class Sim {
  tickCount = 0;
  readonly rng: Rng;
  readonly traffic: Traffic;
  readonly metrics: Metrics;
  readonly demand: Demand;
  readonly growth: Growth;
  constructor(private cfg: Config, network: Network) {
    this.rng = new Rng(cfg.seed);
    this.traffic = new Traffic(cfg, network, this.rng);
    this.metrics = new Metrics(cfg);
    this.demand = new Demand(cfg, network, this.rng, this.traffic, this.metrics);
    this.growth = new Growth(cfg, network, this.rng, this.metrics);
    // 차량이 도착하거나 사라지면 통계(마지막 구간 정산)와 수요(귀환 풀, 미완료)에 알린다
    this.traffic.onArrive = (v, tick) => { this.metrics.foldVehicle(v); this.demand.onArrive(v, tick); };
    this.traffic.onSeg = (seg, ref, loss) => this.metrics.segAdd(seg, ref, loss);
    this.traffic.onPass = (seg) => this.metrics.segPass(seg);
    this.traffic.onLost = (v, meta, reason) => { if (v) this.metrics.foldVehicle(v); this.demand.onLost(meta, reason); };
  }
  /** 처음 상태로(도로망은 그대로) */
  reset(): void {
    this.tickCount = 0;
    this.rng.setState(this.cfg.seed);
    this.traffic.reset(); this.metrics.reset(); this.demand.reset(); this.growth.reset();
  }

  /** 전체 시뮬레이션 상태(차량·출발 대기열·귀환 풀·계획·통계·난수). 저장 파일에 들어간다 */
  getState() {
    return { tickCount: this.tickCount, rng: this.rng.getState(), traffic: this.traffic.getState(), demand: this.demand.getState(), metrics: this.metrics.getState(), growth: this.growth.getState() };
  }

  /** 도로망을 먼저 불러온 뒤에 호출한다 */
  setState(s: ReturnType<Sim['getState']>): void {
    this.tickCount = s.tickCount;
    this.rng.setState(s.rng);
    this.traffic.setState(s.traffic);
    this.demand.setState(s.demand);
    this.metrics.setState(s.metrics);
    this.growth.setState((s as { growth?: ReturnType<Growth['getState']> }).growth); // 옛 저장 파일에는 없다
  }

  get simSeconds(): number {
    return this.tickCount / this.cfg.tickRate;
  }
  step(): void {
    this.tickCount++;
    this.growth.step(this.tickCount); // 수요 막대만큼 구역에 건물이 자란다
    this.demand.step(this.tickCount); // 시계 시각에 맞춰 이동을 만든다
    this.traffic.step(this.tickCount); // 차량을 움직인다
    this.metrics.tick(this.tickCount, this.traffic.vehicles.values());
  }
  clock(): ClockTime {
    return clockAt(this.simSeconds, this.cfg);
  }
}
