import { describe, it } from 'vitest';
import * as fs from 'fs';
import { Editor } from '../src/sim/editor';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { EMPTY_NETWORK } from '../src/maps/sample';

// 성능 측정(PERF=1일 때만 실행): 격자 도로망에 차량을 N대 채우고 1틱 평균 처리 시간(ms)을 잰다. 20 tick/s이므로 1틱 50ms 안에 끝나야 1×로 돈다
const run = process.env.PERF ? describe : describe.skip;
run('성능 측정', () => {
  it('차량 수별 틱 시간', () => {
    const sizes = (process.env.PERF_N ?? '250,500,1000,2000').split(',').map(Number);
    const out: string[] = [];
    for (const target of sizes) {
      const e = new Editor(config); e.loadData(EMPTY_NETWORK);
      const G = 8, S = 250;
      for (let i = 0; i < G; i++) { e.build({ x: -S * (G - 1) / 2, y: -S * (G - 1) / 2 + i * S }, { x: S * (G - 1) / 2, y: -S * (G - 1) / 2 + i * S }, 'road4'); e.build({ x: -S * (G - 1) / 2 + i * S, y: -S * (G - 1) / 2 }, { x: -S * (G - 1) / 2 + i * S, y: S * (G - 1) / 2 }, 'road4'); }
      const sim = new Sim(config, e.network);
      const segs = [...e.network.segments.values()];
      let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      let t = 0;
      const refill = () => { while (sim.traffic.vehicles.size + sim.traffic.jobs.length < target && t++ < 4000) { const a = segs[Math.floor(rnd() * segs.length)], b = segs[Math.floor(rnd() * segs.length)]; if (a === b) continue; sim.traffic.requestTrip({ segId: a.id, t: 10 }, { segId: b.id, t: 10 }, 1); } };
      for (let i = 0; i < 20 * 60 && sim.traffic.vehicles.size < target; i++) { if (i % 20 === 0) refill(); sim.step(); }
      const live = sim.traffic.vehicles.size;
      const t0 = performance.now(); const N = 100;
      for (let i = 0; i < N; i++) { if (i % 20 === 0) refill(); sim.step(); }
      const ms = (performance.now() - t0) / N;
      let mv = 0; for (const v of sim.traffic.vehicles.values()) mv += v.v; mv /= Math.max(1, sim.traffic.vehicles.size);
      out.push(`target=${target} live=${live} segs=${segs.length} avgV=${(mv * 3.6).toFixed(0)}km/h arrived=${sim.traffic.stats.arrived} ms/tick=${ms.toFixed(2)} (1×까지 ${((50 / ms)).toFixed(1)}배 여유)`);
    }
    fs.writeFileSync('/tmp/perf.txt', out.join('\n'));
  }, 900_000);
});
