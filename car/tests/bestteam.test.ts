// 1.0.0 고객층에 맞는 개발팀 자동 배치(Q.bestTeam)
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { bestTeam, planPreview } from '../src/sim/queries';
import { Rng } from '../src/sim/rng';
import type { Role } from '../src/sim/types';
import { SPEC } from './util';

/** 직원 12명(직무·능력이 섞인) 게임 */
function game(): Game {
  const g = Game.create({ difficulty: 'normal', seed: 3 });
  const base = g.state.staff[0], roles: Role[] = ['designer', 'engineer', 'tester'];
  for (let i = 0; g.state.staff.length < 12; i++) g.state.staff.push({ ...base, id: 500 + i, role: roles[i % 3], ability: 30 + ((i * 17) % 55), projectId: null, trainings: [], restUntil: null, lab: false });
  return g;
}

describe('bestTeam', () => {
  const spec = { ...SPEC, segment: 'youth' };
  it('쉬는 직원 전원보다 크게 낮지 않고(빠진 사람당 멈춤 기준 0.1 미만), 같은 인원의 무작위 팀 20개 이상, 결정론', () => {
    const g = game(), s = g.state, r = bestTeam(s, spec, { keepEngineer: false });
    const idle = s.staff.filter((x) => x.role !== 'sales' && x.projectId === null);
    const all = planPreview(s, spec, idle).segmentScore;
    expect(r.team.length).toBeGreaterThan(0);
    expect(r.segmentScore).toBeGreaterThanOrEqual(all - 0.1 * (idle.length - r.team.length) - 1e-9);
    const rng = new Rng(7);
    for (let i = 0; i < 20; i++) {
      const pool = [...idle], pick = [];
      while (pick.length < r.team.length) pick.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
      expect(r.segmentScore).toBeGreaterThanOrEqual(planPreview(s, spec, pick).segmentScore - 1e-9);
    }
    expect(bestTeam(game().state, spec, { keepEngineer: false })).toEqual(r);
  });
  it('엔지니어 1명을 연구에 남기고, 교육·휴식 중 직원은 넣지 않는다', () => {
    const g = game(), s = g.state, away = s.staff.find((x) => x.role === 'designer')!;
    away.restUntil = s.week + 4;
    const r = bestTeam(s, spec);
    expect(r.reserved).not.toBeNull();
    expect(s.staff.find((x) => x.id === r.reserved)!.role).toBe('engineer');
    expect(r.team).not.toContain(r.reserved);
    expect(r.team).not.toContain(away.id);
    expect(r.reason.some((t) => t.includes('엔지니어'))).toBe(true);
  });
});
