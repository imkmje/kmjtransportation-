import { describe, it, expect } from 'vitest';
import { Network } from '../src/sim/network';
import { Sim } from '../src/sim/sim';
import { Metrics, ciGrade } from '../src/sim/metrics';
import { config as base } from '../src/config';
import type { Config } from '../src/config';
import type { Vehicle } from '../src/sim/traffic';

// 도로 하나(서→동 1,000m)와 그 옆 건물들로 이루어진 간단한 도시
const city = (cfg: Config = base) => {
  const n = new Network(cfg);
  n.buildRoad({ x: -500, y: 0 }, { x: 500, y: 0 }, 'road2');
  return { n, sim: new Sim(cfg, n), cfg };
};
const put = (n: Network, kind: 'home' | 'office', size: 'small' | 'medium' | 'large', x: number, y = 30) => {
  const r = n.addBuilding(kind, size, x, y);
  if (!r.ok) throw new Error('건물 배치 실패 ' + r.error);
  return r.id;
};
// 시계 (day일차 hour시)가 되는 tick
const tickAt = (cfg: Config, day: number, hour: number) => Math.round(((((day - 1) * 86400 + hour * 3600) - cfg.startClockHour * 3600) / (86400 / (cfg.dayLengthMinutes * 60))) * cfg.tickRate);
const runTo = (sim: Sim, tick: number, each?: () => void) => { while (sim.tickCount < tick) { sim.step(); each?.(); } };
const hourOf = (sim: Sim, tick: number) => ((sim.demand.clockAbs(tick) / 3600) % 24);

describe('수요: 출근과 퇴근', () => {
  it('평일 하루: 직장인 전원이 아침(6~10시)에 출근하고 저녁(17~22시)에 퇴근해 모두 도착한다', () => {
    const { n, sim, cfg } = city();
    put(n, 'home', 'small', -300); // 거주 10명 → 직장인 6명
    put(n, 'office', 'small', 300); // 일자리 10개
    const seen = new Set<number>();
    const commuteHours: number[] = [], returnHours: number[] = [];
    runTo(sim, tickAt(cfg, 2, 4.2), () => {
      for (const v of sim.traffic.vehicles.values()) if (v.meta && !seen.has(v.id)) {
        seen.add(v.id);
        (v.meta.kind === 'commute' ? commuteHours : returnHours).push(hourOf(sim, v.meta.born));
      }
    });
    const rec = sim.metrics.history[0];
    expect(rec).toMatchObject({ day: 1, generated: 12, arrived: 12, incomplete: 0, completion: 100 });
    expect(commuteHours.length).toBe(6);
    expect(returnHours.length).toBe(6);
    expect(commuteHours.every((h) => h >= 6 && h < 10)).toBe(true);
    expect(returnHours.every((h) => h >= 17 && h < 22)).toBe(true);
    expect(rec.avgTravelMin!).toBeGreaterThan(20); // 약 600m: 시뮬 약 50초 = 시계 약 20분 이상
    expect(rec.avgTravelMin!).toBeLessThan(120);
    expect(sim.demand.poolSize()).toBe(0); // 귀환 풀이 비었다(영구 잔류 없음)
    expect(sim.traffic.stats.interventions).toBe(0);
  });

  it('주말(토·일)에는 출근·퇴근이 없고, 다음 월요일에 다시 시작한다', () => {
    const cfg: Config = { ...base, dayLengthMinutes: 30 }; // 하루를 짧게 해서 한 주를 빨리 돌린다
    const { n, sim } = city(cfg);
    put(n, 'home', 'small', -300);
    put(n, 'office', 'small', 300);
    runTo(sim, tickAt(cfg, 9, 4.2)); // 하루 기록은 그날이 끝날 때(다음 날 04:00) 남는다
    const gen = sim.metrics.history.map((h) => h.generated);
    expect(gen).toEqual([12, 12, 12, 12, 12, 0, 0, 12]); // 월~금 12, 토·일 0, 월 12
  });

  it('일자리(수용량)보다 직장인이 많으면 남는 사람은 출근하지 못한다', () => {
    const { n, sim, cfg } = city();
    put(n, 'home', 'large', -300); // 직장인 60명
    put(n, 'home', 'large', -150, -30);
    put(n, 'office', 'small', 300); // 일자리 10개
    runTo(sim, tickAt(cfg, 1, 5.1));
    expect(sim.demand.pending.filter((t) => t.kind === 'commute').length).toBe(10);
    expect(sim.demand.unemployed).toBe(110);
  });

  it('가까운 직장을 더 많이 고른다(수용량 × 거리 감쇠): 여러 난수 시드를 합쳐 기대 비율(약 73%)과 맞는지 본다', () => {
    let near = 0, all = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const cfg: Config = { ...base, seed };
      const { n, sim } = city(cfg);
      put(n, 'home', 'large', -400); // 직장인 60명
      const a = put(n, 'office', 'large', -300); // 집에서 100m
      put(n, 'office', 'large', 400); // 집에서 800m
      runTo(sim, 5);
      const to = sim.demand.pending.filter((t) => t.kind === 'commute').map((t) => t.to);
      near += to.filter((x) => x === a).length;
      all += to.length;
    }
    // 기대: 100·e^(−100/707) ÷ (100·e^(−100/707) + 100·e^(−800/707)) = 0.729
    expect(near / all).toBeGreaterThan(0.69);
    expect(near / all).toBeLessThan(0.77);
  });

  it('출근 시간대가 지난 뒤에 건물을 놓으면 그날은 출근이 없고, 시간대 안에 놓으면 남은 시간대로 계획된다', () => {
    const { n, sim, cfg } = city();
    runTo(sim, tickAt(cfg, 1, 7)); // 07:00에 건물을 놓는다
    put(n, 'home', 'small', -300);
    put(n, 'office', 'small', 300);
    runTo(sim, tickAt(cfg, 1, 7) + 1);
    const times = sim.demand.pending.filter((t) => t.kind === 'commute').map((t) => (t.time / 3600) % 24);
    expect(times.length).toBe(6);
    expect(times.every((h) => h >= 7 && h < 10)).toBe(true); // 07:00 이후 시간대만
    const { n: n2, sim: sim2, cfg: cfg2 } = city();
    runTo(sim2, tickAt(cfg2, 1, 11));
    put(n2, 'home', 'small', -300);
    put(n2, 'office', 'small', 300);
    runTo(sim2, tickAt(cfg2, 1, 11) + 1);
    expect(sim2.demand.pending.filter((t) => t.kind === 'commute').length).toBe(0);
  });

  it('퇴근 시간대(17~21시)가 끝난 뒤 도착하면 시계 1시간 체류 후 귀환한다', () => {
    const { n, sim, cfg } = city();
    const h = put(n, 'home', 'small', -300), o = put(n, 'office', 'small', 300);
    const t = tickAt(cfg, 1, 22);
    sim.demand.step(t); // 22:00으로 시계를 옮긴다
    const fake = { id: 99, x: 0, y: 0, meta: { kind: 'commute', from: h, to: o, born: t - 100, mode: 'car', ownerId: 0 } } as unknown as Vehicle;
    sim.demand.onArrive(fake, t);
    const ret = sim.demand.pending.find((p) => p.kind === 'return')!;
    expect(ret.time - sim.demand.clockAbs(t)).toBeCloseTo(3600, 3);
    expect(sim.demand.pool.get(o)!.get(h)).toBe(1);
  });
});

describe('수요: 연결되지 않은 건물', () => {
  it('도로에서 50m 넘게 떨어진 직장은 미연결 경고 대상이고, 그곳으로의 출근은 미완료로 집계된다', () => {
    const { n, sim, cfg } = city();
    put(n, 'home', 'small', -300);
    const off = put(n, 'office', 'small', 300, 90); // 도로에서 90m
    expect(sim.demand.unconnected()).toEqual([off]);
    runTo(sim, tickAt(cfg, 2, 4.2));
    expect(sim.metrics.history[0]).toMatchObject({ day: 1, generated: 6, arrived: 0, incomplete: 6, completion: 0 });
    expect(sim.metrics.lost.noRoute).toBe(6);
  });
});

describe('수요: 건물을 지우면 (rules.md 7항 삭제 처리)', () => {
  const morning = () => {
    const { n, sim, cfg } = city();
    const home = put(n, 'home', 'large', -300); // 직장인 60명
    const a = put(n, 'office', 'large', 300);
    const b = put(n, 'office', 'large', 400, -30);
    return { n, sim, cfg, home, a, b };
  };

  it('목적지 직장이 지워지면 달리던 차량은 같은 유형의 다른 직장으로 재배정되어 모두 도착한다', () => {
    const { n, sim, cfg, a, b } = morning();
    runTo(sim, tickAt(cfg, 1, 7.9));
    const en = [...sim.traffic.vehicles.values()].filter((v) => v.meta?.kind === 'commute' && v.meta.to === a);
    expect(en.length).toBeGreaterThan(0); // 지울 직장으로 가는 차가 실제로 길 위에 있다
    n.removeBuilding(a);
    runTo(sim, tickAt(cfg, 2, 4.2));
    const rec = sim.metrics.history[0];
    expect(rec.generated).toBe(120); // 출근 60 + 퇴근 60
    expect(rec.completion).toBe(100);
    expect(sim.metrics.lost.removed).toBe(0);
    expect(en.every((v) => v.meta!.to === b)).toBe(true); // 모두 남은 직장으로 바뀌었다
  });

  it('같은 유형의 다른 건물이 없으면 달리던 차량은 취소되고 미완료로 집계된다. 도착한 인원의 귀환은 즉시 생긴다', () => {
    const { n, sim, cfg } = city();
    put(n, 'home', 'large', -300);
    const o = put(n, 'office', 'large', 300);
    runTo(sim, tickAt(cfg, 1, 9));
    const poolBefore = sim.demand.poolSize();
    const enBefore = sim.demand.inFlight();
    expect(poolBefore).toBeGreaterThan(0); // 이미 도착해 풀에 있는 사람
    n.removeBuilding(o);
    runTo(sim, tickAt(cfg, 1, 9) + 2);
    expect(sim.demand.pool.has(o)).toBe(false);
    expect(sim.metrics.lost.removed).toBeGreaterThan(0); // 가던 차량은 취소(미완료)
    expect(sim.demand.pending.filter((t) => t.kind === 'return' && t.from === o).length).toBe(0); // 풀 인원의 귀환이 즉시 나갔다
    expect(sim.demand.inFlight() + sim.metrics.lost.removed).toBeGreaterThanOrEqual(poolBefore + enBefore - 5);
    runTo(sim, tickAt(cfg, 2, 4.2));
    expect(sim.metrics.history[0].arrived).toBeGreaterThanOrEqual(poolBefore - 1); // 풀 인원이 집에 도착
  });

  it('돌아갈 주거가 지워지면 귀환은 다른 주거로 재배정, 없으면 취소(미완료)', () => {
    const { n, sim, cfg } = city();
    const h1 = put(n, 'home', 'small', -300);
    const h2 = put(n, 'home', 'small', -150, -30);
    put(n, 'office', 'small', 300);
    runTo(sim, tickAt(cfg, 1, 12)); // 모두 출근해 직장 풀에 있는 시각
    expect(sim.demand.pending.filter((t) => t.kind === 'return').length).toBe(10); // 6 + 4... 직장 일자리 10개까지
    n.removeBuilding(h1);
    runTo(sim, tickAt(cfg, 1, 12) + 1);
    expect(sim.demand.pending.every((t) => t.kind !== 'return' || t.to === h2)).toBe(true); // 남은 집으로 모두 재배정
    n.removeBuilding(h2);
    const lost0 = sim.metrics.lost.removed;
    runTo(sim, tickAt(cfg, 1, 12) + 2);
    expect(sim.demand.pending.filter((t) => t.kind === 'return').length).toBe(0); // 갈 집이 없다
    expect(sim.metrics.lost.removed).toBeGreaterThan(lost0);
  });

  it('출근 전에 집이 지워지면 그 집의 출근 계획은 사라진다(발생하지 않는다)', () => {
    const { n, sim, cfg } = city();
    const h = put(n, 'home', 'small', -300);
    put(n, 'office', 'small', 300);
    runTo(sim, tickAt(cfg, 1, 5.5));
    expect(sim.demand.pending.filter((t) => t.kind === 'commute').length).toBe(6);
    n.removeBuilding(h);
    runTo(sim, tickAt(cfg, 2, 4.2));
    expect(sim.metrics.history[0].generated).toBe(0);
  });
});

describe('통계', () => {
  const fake = (mRef: number, mAct: number) => ({ mRef, mAct }) as unknown as Vehicle;
  const bucket = base.metrics.bucketSec * base.tickRate;

  it('CI = 100 × 손실 합 ÷ 기준 거리 합. 기준보다 빨리 간 차량은 손실이 음수가 되지 않는다', () => {
    const m = new Metrics(base);
    expect(m.rollingCI()).toBe(null); // 주행 차량이 없으면 "-"
    m.foldVehicle(fake(100, 80));
    m.foldVehicle(fake(100, 120)); // 더 빨리 감: 손실 0 (−20이 아님)
    m.tick(bucket, []);
    expect(m.rollingCI()).toBeCloseTo(100 * 20 / 200); // 10 (음수가 섞였다면 0)
  });
  it('하루 CI는 시간 평균이 아니라 하루 전체 합산', () => {
    const m = new Metrics(base);
    m.foldVehicle(fake(100, 80)); m.tick(bucket, []); // 손실 20 / 기준 100 → 이 구간 CI 20
    m.foldVehicle(fake(400, 400)); m.tick(bucket * 2, []); // 손실 0 / 기준 400 → 이 구간 CI 0
    expect(m.dayCI()).toBeCloseTo(100 * 20 / 500); // 4 (평균이면 10)
  });
  it('통행시간은 이동이 발생한 시각부터 도착까지(출발 대기 포함), 시계 시간으로', () => {
    const m = new Metrics(base);
    m.arrived({ kind: 'commute', from: 1, to: 2, born: 0, mode: 'car', ownerId: 0 }, 3000); // 시뮬 150초 = 시계 60분
    expect(m.avgTravelMin()).toBeCloseTo(60);
  });
  it('처리량은 시계 1시간(시뮬 150초) 안에 도착한 수', () => {
    const m = new Metrics(base);
    const meta = { kind: 'commute', from: 1, to: 2, born: 0, mode: 'car', ownerId: 0 } as const;
    for (const t of [100, 500, 2000, 3500]) m.arrived(meta, t);
    expect(m.throughput(3600)).toBe(2); // 3600 − 3000 = 600 초과인 도착만: 2000, 3500
  });
  it('완료율 = 도착 ÷ 발생, 등급 구간', () => {
    const m = new Metrics(base);
    for (let i = 0; i < 4; i++) m.generated();
    m.arrived({ kind: 'return', from: 1, to: 2, born: 0, mode: 'car', ownerId: 0 }, 10);
    m.incomplete('noRoute');
    expect(m.completion()).toBe(25);
    expect([0, 9.9, 10, 24.9, 25, 40, 59, 60, 99].map((c) => ciGrade(c))).toEqual(['원활', '원활', '양호', '양호', '지체', '정체', '정체', '심각', '심각']);
    expect(ciGrade(null)).toBe('-');
  });
  it('실제 운행에서 혼자 달리는 차량의 CI는 낮고(원활), 0 이상이다', () => {
    const { n, sim, cfg } = city();
    put(n, 'home', 'small', -300);
    put(n, 'office', 'small', 300);
    let maxCI = 0, sawCI = false;
    runTo(sim, tickAt(cfg, 1, 12), () => { const c = sim.metrics.rollingCI(); if (c !== null) { sawCI = true; maxCI = Math.max(maxCI, c); expect(c).toBeGreaterThanOrEqual(0); } });
    expect(sawCI).toBe(true);
    expect(maxCI).toBeLessThan(25);
  });
});
