// 0.4.1 긴급 수정: 출시 대기(결함을 다 잡으면 개발비 0), 설명 필드(info), 문구 용어
import { describe, it, expect } from 'vitest';
import { Game, allGens } from '../src/sim/game';
import { projectStatus, researchInfo } from '../src/sim/queries';
import { BODIES, OPTIONS, POWERTRAINS, SEGMENTS, TECHS, RANDOM_EVENTS, ERA_EVENTS } from '../src/data';
import { config } from '../src/config';
import { SPEC, ok } from './util';

/** 결함이 0이 되어 출시 대기가 될 때까지 진행(최대 60주). 그 주의 이벤트를 돌려준다 */
function toWaiting(g: Game) {
  const p = g.state.projects[0];
  for (let i = 0; i < 60; i++) { const ev = g.tick(); if (p.waiting) return ev; }
  throw new Error('출시 대기가 되지 않았습니다');
}

describe('출시 대기(0.4.1)', () => {
  it('시험 중 실제 결함이 0이 되고 최소 시험 주를 채우면 출시 대기: 알림, 직원 해방, 화면 결함 0, 그 뒤 개발비 0', () => {
    const g = Game.create({ seed: 1 });
    ok(g.command({ type: 'startProject', ...SPEC }));
    const p = g.state.projects[0], team = g.state.staff.filter((x) => x.projectId === p.id).map((x) => x.id);
    expect(projectStatus(g.state, p.id)!.waiting).toBe(false);
    expect(projectStatus(g.state, p.id)!.costNote).toMatch(/^설계 중에는 주마다 약 [\d,]+만원이 듭니다\(직원 몫 \+ 시제차\)\.$/);
    expect(projectStatus(g.state, p.id)!.weeklyCost).toBeGreaterThan(config.dev.prototypePerWeek);
    const ev = toWaiting(g);
    expect(p.defects).toBe(0); expect(p.defectEst).toBe(0); expect(p.testWeeks).toBeGreaterThanOrEqual(config.dev.minTestWeeks);
    expect(ev.some((e) => e.kind === 'advice' && e.text === `「${SPEC.name}」의 결함을 모두 잡았습니다. 이제 출시할 수 있습니다. 출시 대기 중에는 개발비가 들지 않습니다.`)).toBe(true);
    expect(g.state.staff.filter((x) => x.projectId === p.id)).toEqual([]);
    expect(p.crew).toEqual(team);
    expect(projectStatus(g.state, p.id)).toEqual({ phase: 'test', waiting: true, weeklyCost: 0, costNote: '출시 대기 중이라 개발비가 들지 않습니다.' });
    const spent = p.spent, tw = p.testWeeks;
    for (let i = 0; i < 12; i++) { const e = g.tick(); expect(e.some((x) => x.kind === 'devWeek')).toBe(false); }
    expect(p.spent).toBe(spent); expect(p.testWeeks).toBe(tw); expect(p.defectEst).toBe(0);
    expect(g.state.ledger.at(-1)!.dev).toBe(0);
    // 풀려난 엔지니어는 연구 점수를 만들 수 있다(진행 중인 연구가 있을 때)
    expect(researchInfo(g.state).pointsPerWeek).toBeGreaterThan(0);
    // 출시할 수 있고, 함께 만든 직원은 경험을 받는다
    const before = g.state.staff.filter((x) => team.includes(x.id)).map((x) => x.ability);
    ok(g.command({ type: 'launch', projectId: p.id, price: 1200, marketing: 1, color: 'red', wheels: 0 }));
    expect(allGens(g.state).length).toBe(1); expect(allGens(g.state)[0].editions[0].defects).toBe(0);
    const after = g.state.staff.filter((x) => team.includes(x.id)).map((x) => x.ability);
    after.forEach((a, i) => expect(a).toBeGreaterThanOrEqual(before[i]));
    expect(after.some((a, i) => a > before[i]) || g.state.staff.filter((x) => team.includes(x.id)).every((x) => x.ability >= x.potential)).toBe(true);
  });
  it('출시 대기 중에도 개발팀 자리는 그대로 차지하고, 직원은 다른 프로젝트·연구로 돌릴 수 있다. 저장·불러오기 왕복', () => {
    const g = Game.create({ seed: 2 });
    ok(g.command({ type: 'startProject', ...SPEC }));
    toWaiting(g);
    expect(g.command({ type: 'startProject', ...SPEC, name: '둘째' })).toEqual({ ok: false, reason: '개발팀이 모두 바쁩니다. 진행 중인 개발을 끝내거나 취소하세요.' });
    const back = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(back.state.projects[0].waiting).toBe(true);
    for (let i = 0; i < 8; i++) { g.tick(); back.tick(); }
    expect(JSON.stringify(back.toJSON())).toBe(JSON.stringify(g.toJSON()));
  });
  it('예전 저장(waiting 필드 없음)은 출시 대기가 아닌 것으로 본다', () => {
    const g = Game.create({ seed: 3 });
    ok(g.command({ type: 'startProject', ...SPEC }));
    const st = JSON.parse(JSON.stringify(g.toJSON())); delete st.projects[0].waiting;
    expect(projectStatus(Game.fromJSON(st).state, st.projects[0].id)!.waiting).toBe(false);
  });
});

describe('설명 필드와 용어(0.4.1)', () => {
  it('모든 기술·옵션·동력·차체·고객층에 info가 있고 10자 이상, 느낌표 없음', () => {
    for (const x of [...TECHS, ...OPTIONS, ...POWERTRAINS, ...BODIES, ...SEGMENTS] as { id: string; info?: string }[]) {
      expect(typeof x.info, x.id).toBe('string'); expect(x.info!.length, x.id).toBeGreaterThanOrEqual(10); expect(x.info, x.id).not.toContain('!');
    }
    const row = researchInfo(Game.create({ seed: 1 }).state).fields.flatMap((f) => f.techs).find((t) => t.id === 'el_radio')!;
    expect(row.info).toBe(TECHS.find((t) => t.id === 'el_radio')!.info);
  });
  it('기술 이름은 본래 용어, 유치한 풀이·괄호 풀이·느낌표를 쓰지 않는다', () => {
    const name = (id: string) => TECHS.find((t) => t.id === id)!.name;
    expect([name('pw_dohc'), name('pw_vvt'), name('pw_turbo'), name('pw_carb'), name('pw_gdi'), name('ec_phev'), name('pr_cad'), name('pr_ai'), name('ec_battery1')])
      .toEqual(['DOHC 16밸브', '가변 밸브 타이밍', '다운사이징 터보', '개량 기화기', '직접 분사', '플러그인 하이브리드', 'CAD 설계', 'AI 설계', '리튬이온 배터리 개량']);
    const texts = [...TECHS.flatMap((t) => [t.name, t.desc]), ...ERA_EVENTS.flatMap((e) => [e.warn, e.start, e.end]), ...RANDOM_EVENTS.flatMap((e) => [e.text, ...e.choices.flatMap((c) => [c.label, c.result])])];
    for (const t of texts) { expect(t).not.toContain('!'); expect(t).not.toMatch(/봐주는|알려진 정도|환율 보험|숨 잘 쉬는/); }
    expect(RANDOM_EVENTS.find((e) => e.id === 'fx')!.choices[0].label).toBe('환 헤지');
  });
});
