// 0.4.2 균형 패치: 시간 척도, 페이스리프트 이익, 규제 의무 장비, 교육 상한, 개발자 메뉴
import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';
import { SPEC, grant, ok } from './util';

describe('개발자 메뉴(0.4.2)', () => {
  it('devCheat: 현금·평판(상한)·연구 완료·개발 출시 대기·컨디션, devUsed, 명령 기록과 저장 왕복', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 }), s = g.state;
    expect(s.devUsed).toBeUndefined();
    const cash = s.cash; ok(g.devCheat('cash')); expect(s.cash).toBe(cash + config.devCheat.cash); expect(s.devUsed).toBe(true);
    ok(g.devCheat('reputation')); expect(s.reputation).toBe(config.start.reputation + config.devCheat.reputation);
    s.reputation = 95; ok(g.devCheat('reputation')); expect(s.reputation).toBe(100);
    ok(g.command({ type: 'startResearch', techId: 'el_radio' }));
    const r = g.devCheat('finishResearch');
    expect(s.research.active).toEqual([]); expect(s.research.done).toContain('el_radio'); expect(r.ok && r.events?.some((e) => e.kind === 'unlock')).toBe(true);
    ok(g.command({ type: 'startProject', ...SPEC })); g.tick();
    const p = s.projects[0], team = s.staff.filter((x) => x.projectId === p.id).map((x) => x.id);
    for (const x of s.staff) x.condition = 0.2;
    ok(g.devCheat('finishDev'));
    expect(p).toMatchObject({ phase: 'test', waiting: true, defects: 0, defectEst: 0, crew: team }); expect(p.testWeeks).toBeGreaterThanOrEqual(config.dev.minTestWeeks);
    expect(s.staff.every((x) => x.projectId === null)).toBe(true);
    ok(g.devCheat('restStaff')); expect(s.staff.every((x) => x.condition === 1)).toBe(true);
    ok(g.command({ type: 'launch', projectId: p.id, price: 1200, marketing: 1, color: 'red', wheels: 0 }));
    expect(g.devCheat('nope' as never).ok).toBe(false);
    expect(s.history.filter((h) => h.cmd.type === 'devCheat').map((h) => (h.cmd as { kind: string }).kind)).toEqual(['cash', 'reputation', 'reputation', 'finishResearch', 'finishDev', 'restStaff']);
    // 저장 왕복: 이어서 돌린 결과가 같다
    const b = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(b.state.devUsed).toBe(true);
    for (let i = 0; i < 20; i++) { g.tick(); b.tick(); }
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(g.toJSON()));
    void grant;
  });
});
