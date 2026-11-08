import { Config } from '../config';
import type { Network } from './network';
import { Rng } from './random';
import { clockAt, ClockTime } from './time';
import { Traffic } from './traffic';

// 순수 시뮬레이션 상태. 화면(DOM, Three.js)을 모른다.
export class Sim {
  tickCount = 0;
  readonly rng: Rng;
  readonly traffic: Traffic;
  constructor(private cfg: Config, network: Network) {
    this.rng = new Rng(cfg.seed);
    this.traffic = new Traffic(cfg, network, this.rng);
  }
  get simSeconds(): number {
    return this.tickCount / this.cfg.tickRate;
  }
  step(): void {
    this.tickCount++;
    this.traffic.step(this.tickCount);
  }
  clock(): ClockTime {
    return clockAt(this.simSeconds, this.cfg);
  }
}
