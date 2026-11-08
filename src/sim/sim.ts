import { Config } from '../config';
import { Rng } from './random';
import { clockAt, ClockTime } from './time';

// 순수 시뮬레이션 상태. 화면(DOM, Three.js)을 모른다.
export class Sim {
  tickCount = 0;
  readonly rng: Rng;
  constructor(private cfg: Config) {
    this.rng = new Rng(cfg.seed);
  }
  get simSeconds(): number {
    return this.tickCount / this.cfg.tickRate;
  }
  step(): void {
    this.tickCount++;
  }
  clock(): ClockTime {
    return clockAt(this.simSeconds, this.cfg);
  }
}
