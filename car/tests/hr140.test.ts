// 1.4.0 인사 임원 자동 채용·자동 해고(위임)
import { describe, it, expect, vi } from 'vitest';
import { Game } from '../src/sim/game';
import { steadyBestExec } from '../src/sim/bots';
import { staffCap } from '../src/sim/company';
import { DELEGATIONS, execInfo, monthlyFixed } from '../src/sim/execs';
import { config } from '../src/config';
import type { Staff } from '../src/sim/types';
import { SPEC, ok, toMonthEnd } from './util';

vi.setConfig({ testTimeout: 180_000 });
const X = config.exec, AS = X.autoStaff;
const on = (g: Game, ...keys: string[]) => { for (const key of keys) ok(g.command({ type: 'setDelegation', role: 'hr', key, on: true })); };
const reps = (g: Game, kind: string) => g.state.execs!.reports.filter((r) => r.kind === kind);

/** 인사 임원(능력 90), 넉넉한 현금 */
function base(seed = 1): Game {
  const g = Game.create({ seed, difficulty: 'normal' });
  g.state.cash = 1e8; g.state.reputation = 50;
  ok(g.command({ type: 'postExecJob', role: 'hr' }));
  ok(g.command({ type: 'hireExec', role: 'hr', candidateId: g.state.execs!.candidates[0].id }));
  const x = g.state.execs!.seats.hr!.staff; x.ability = x.potential = 90;
  return g;
}
/** 디자이너 셋(약한 한 명은 디자인 30에서 성장 한계, 둘은 60)을 두고 입사 기록을 오래전으로. 정원을 다 채워 자동 채용이 끼지 않게 */
function weakSetup(seed = 1): { g: Game; d: Staff } {
  const g = base(seed), s = g.state, d = s.staff.find((x) => x.role === 'designer')!;
  d.ability = d.potential = 30;
  for (const name of ['보조디자이너', '선임디자이너']) s.staff.push({ ...d, id: s.nextId++, name, ability: 60, potential: 70, hist: { ...d.hist!, cars: [], execs: [] } });
  for (const x of s.staff) x.hist!.join = -1000;
  while (s.staff.length < staffCap(s)) s.staff.push({ ...s.staff.find((x) => x.role === 'engineer')!, id: s.nextId++, name: `엔지니어${s.nextId}` });
  return { g, d };
}

describe('자동 채용', () => {
  it('빈자리 + 현금 여유: 부족한 직무를 공고해 기준(같은 직무 평균) 이상 후보 중 가장 나은 사람을 뽑는다(상한 없음), 보고·알림', () => {
    const g = base(), s = g.state;
    for (const x of s.staff) x.ability = 20; // 기준 20: 2등급 후보(30~55)는 모두 기준 이상, 기준 + capGain(25)도 넘는다
    on(g, 'autoHire');
    const n0 = s.staff.length, ids = new Set(s.staff.map((x) => x.id)), c0 = s.cash;
    const ev = []; do ev.push(...g.tick()); while (s.week % 4 !== 0);
    expect(s.staff.length).toBe(n0 + 1);
    const nw = s.staff.find((x) => !ids.has(x.id))!, r = reps(g, 'autoHire')[0];
    expect(r.auto).toBe(true); expect(r.goto).toMatchObject({ tab: 'company', sub: 'staff', id: nw.id });
    expect(r.text).toContain(`${nw.name}(`); expect(r.text).toContain('부족합니다');
    expect(r.facts[0]).toBe('기준: 같은 직무 평균 20 이상');
    const seen = r.facts[1].match(/후보 ([\d·]+)/)![1].split('·').map(Number);
    expect(nw.ability).toBe(Math.max(...seen)); expect(nw.ability).toBeGreaterThan(20 + X.replace.capGain);
    expect(c0 - s.cash).toBeGreaterThanOrEqual(config.staff.hire.postCost[1]);
    expect(ev.some((e) => e.kind === 'replacement' && e.text === r.text)).toBe(true);
  });
  it('현금이 운영비 replace.cashMonths개월 치 + 공고비에 못 미치면 뽑지 않는다', () => {
    const g = base(), s = g.state; on(g, 'autoHire');
    s.cash = monthlyFixed(s) * X.replace.cashMonths; // 월 결산에서 운영비가 빠지면 기준 아래
    const n0 = s.staff.length; toMonthEnd(g);
    expect(s.staff.length).toBe(n0); expect(reps(g, 'autoHire')).toHaveLength(0);
  });
  it('기준 미달 후보뿐이면 뽑지 않고(공고비는 듦) retryWeeks 뒤 다시, 공고로 닿지 않으면 공고하지 않는다, 정원은 넘지 않는다', () => {
    let g: Game | undefined;
    for (let seed = 1; seed <= 30 && !g; seed++) { // 기준 76: 3등급 후보(50~80 + 평판)는 닿지만 셋 다 미달인 시드를 찾는다
      const t = base(seed); on(t, 'autoHire'); for (const x of t.state.staff) x.ability = 76;
      toMonthEnd(t); if (reps(t, 'autoHireFail').length) g = t;
    }
    expect(g).toBeDefined();
    const s = g!.state, n0 = s.staff.length, r = reps(g!, 'autoHireFail')[0];
    expect(r.text).toContain('기준(');
    expect(r.text).toContain(`${X.replace.retryWeeks}주 뒤 다시 공고합니다`);
    toMonthEnd(g!); expect(reps(g!, 'autoHireFail')).toHaveLength(1); expect(reps(g!, 'autoHire')).toHaveLength(0); expect(s.staff.length).toBe(n0); // 4주 뒤에는 공고하지 않는다
    const u = base(); on(u, 'autoHire'); for (const x of u.state.staff) x.ability = 95; // 어떤 공고로도 닿지 않음: 공고비 없이 알리기만
    const m0 = u.state.staff.length; toMonthEnd(u);
    expect(reps(u, 'autoHireFail')[0].text).toContain('빈자리는 그대로 둡니다'); expect(u.state.staff.length).toBe(m0);
    for (let i = 0; i < 60; i++) toMonthEnd(g!);
    expect(s.staff.length).toBeLessThanOrEqual(staffCap(s));
  });
  it('켜면 채용 권유(보고)와 할 일의 "정원에 여유"가 사라진다', async () => {
    const { todoItems } = await import('../src/sim/todo');
    const g = base(), s = g.state;
    expect(todoItems(s).some((t) => t.kind === 'hire')).toBe(true);
    on(g, 'autoHire');
    expect(todoItems(s).some((t) => t.kind === 'hire')).toBe(false);
    s.cash = 0; toMonthEnd(g);
    expect(reps(g, 'hire')).toHaveLength(0);
  });
});

describe('자동 해고', () => {
  it('성장이 멈췄고 같은 직무 평균보다 weakGap 이상 낮은 직원을 내보낸다(퇴직금, 보고에 근거 수치)', () => {
    const { g, d } = weakSetup(), s = g.state; on(g, 'autoFire');
    toMonthEnd(g);
    expect(s.staff.some((x) => x.id === d.id)).toBe(false);
    const r = reps(g, 'autoFire')[0];
    expect(r.text).toContain(`${d.name}(디자이너, 디자인 30, 성장 한계 30)`); expect(r.text).toContain('같은 직무 평균 60보다 30 낮고');
    expect(r.text).toContain('퇴직금');
  });
  it('개발 중인 직원은 제외하고, 개발이 끝나면 진행한다', () => {
    const { g, d } = weakSetup(), s = g.state; on(g, 'autoFire');
    ok(g.command({ type: 'startProject', ...SPEC, team: [d.id] }));
    toMonthEnd(g); expect(s.staff.some((x) => x.id === d.id)).toBe(true);
    ok(g.command({ type: 'cancelProject', projectId: s.projects[0].id }));
    toMonthEnd(g); expect(s.staff.some((x) => x.id === d.id)).toBe(false);
  });
  it('입사 tenureMonths개월 미만, 휴식 중, 임원으로 임명된 직원은 제외', () => {
    const a = weakSetup(); on(a.g, 'autoFire'); a.d.hist!.join = a.g.state.week;
    toMonthEnd(a.g); expect(a.g.state.staff.some((x) => x.id === a.d.id)).toBe(true);
    for (let i = 0; i < AS.tenureMonths; i++) toMonthEnd(a.g);
    expect(a.g.state.staff.some((x) => x.id === a.d.id)).toBe(false);
    const b = weakSetup(); on(b.g, 'autoFire'); b.d.restUntil = b.g.state.week + 6;
    toMonthEnd(b.g); expect(b.g.state.staff.some((x) => x.id === b.d.id)).toBe(true);
    const c = weakSetup(); on(c.g, 'autoFire'); c.g.state.hqLevel = 3;
    ok(c.g.command({ type: 'appointExec', role: 'market', staffId: c.d.id }));
    toMonthEnd(c.g); expect(c.g.state.execs!.seats.market?.staff.id).toBe(c.d.id); expect(reps(c.g, 'autoFire')).toHaveLength(0);
  });
  it('한 달에 한 명, 직무별·전체 최소 인원은 남긴다, 현금이 퇴직금 + 운영비에 못 미치면 하지 않는다', () => {
    const a = weakSetup(), s = a.g.state; on(a.g, 'autoFire');
    const e = s.staff.find((x) => x.role === 'engineer')!; e.ability = e.potential = 5; // 엔지니어도 약하게: 둘 중 한 명만
    toMonthEnd(a.g); expect(reps(a.g, 'autoFire')).toHaveLength(1);
    const m = AS.minPerRole; AS.minPerRole = 3; // 디자이너 3명: 최소 3명이면 내보내지 않는다
    try { const b = weakSetup(); on(b.g, 'autoFire'); toMonthEnd(b.g); expect(b.g.state.staff.some((x) => x.id === b.d.id)).toBe(true); } finally { AS.minPerRole = m; }
    const c = weakSetup(); on(c.g, 'autoFire'); c.g.state.staff = c.g.state.staff.filter((x) => x.role === 'designer' || x.role === 'engineer').slice(0, AS.minStaff);
    toMonthEnd(c.g); expect(c.g.state.staff).toHaveLength(AS.minStaff);
    const d = weakSetup(); on(d.g, 'autoFire'); d.g.state.cash = 0;
    toMonthEnd(d.g); expect(d.g.state.staff.some((x) => x.id === d.d.id)).toBe(true);
  });
});

describe('둘 다 켜기', () => {
  it('둘 다 켜면 교체 고용 제안이 뜨지 않고 내보낸 자리를 같은 달에 채운다. 하나만 켜면 교체 제안은 그대로', () => {
    const both = weakSetup(); on(both.g, 'autoFire', 'autoHire');
    const n0 = both.g.state.staff.length; toMonthEnd(both.g);
    expect(both.g.state.execs!.replacements).toHaveLength(0);
    expect(reps(both.g, 'autoFire')).toHaveLength(1);
    expect(both.g.state.staff.length).toBe(n0 - (reps(both.g, 'autoHire').length ? 0 : 1));
    for (const k of ['autoFire', 'autoHire']) {
      const one = weakSetup(); on(one.g, k); one.d.projectId = -1; // 개발 중이라 자동 해고는 미루고, 교체 제안은 받는다(개발이 끝난 뒤 진행)
      toMonthEnd(one.g);
      expect(one.g.state.execs!.replacements.filter((r) => r.status === 'proposed')).toHaveLength(1);
    }
  });
  it('화면 정보: 인사 임원 위임 목록에 두 항목(기본 꺼짐, 설명, 해고에는 되돌릴 수 없다는 안내)', () => {
    const g = base(), hr = execInfo(g.state).roles.find((r) => r.role === 'hr')!;
    const h = hr.delegations.find((d) => d.key === 'autoHire')!, f = hr.delegations.find((d) => d.key === 'autoFire')!;
    expect(h.on).toBe(false); expect(f.on).toBe(false); expect(h.note).toBeTruthy(); expect(f.warn).toContain('되돌릴 수 없습니다');
  });
});

/** steadyBestExec 20년: 두 항목을 켜고(봇은 위임을 모두 켠다) / 끄고(DELEGATIONS에서 잠시 빼서) */
function run20(seed: number, withAuto: boolean) {
  const keep = DELEGATIONS.hr;
  if (!withAuto) DELEGATIONS.hr = keep.filter((d) => d.key !== 'autoHire' && d.key !== 'autoFire');
  try {
    const g = Game.create({ seed, difficulty: 'normal' }), b = steadyBestExec();
    let over = 0, sum = 0, n = 0, fired = 0;
    for (let w = 1; w <= 20 * 48 && g.state.status === 'playing'; w++) {
      b.step(g); g.tick();
      if (w % 4 === 0) { if (g.state.staff.length > staffCap(g.state)) over++; if (w > 10 * 48) { sum += g.state.staff.reduce((a, x) => a + x.ability, 0) / g.state.staff.length; n++; } }
    }
    fired = (g.state.execs?.reports ?? []).filter((r) => r.kind === 'autoFire').length;
    return { over, avg: sum / n, alive: g.state.status === 'playing', json: JSON.stringify(g.state), fired };
  } finally { DELEGATIONS.hr = keep; }
}

describe('20년(신중 + 편의 기능 봇)', () => {
  it('인원이 정원을 넘지 않고, 뒤 10년 평균 능력이 꺼 둔 경우보다 낮지 않다(시드 3개 합), 결정론', () => {
    const on3 = [1, 2, 3].map((sd) => run20(sd, true)), off3 = [1, 2, 3].map((sd) => run20(sd, false));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log(`뒤 10년 직원 평균 능력: 켬 ${on3.map((r) => r.avg.toFixed(1)).join('/')}, 끔 ${off3.map((r) => r.avg.toFixed(1)).join('/')}, 자동 해고 ${on3.map((r) => r.fired).join('/')}건`);
    for (const r of [...on3, ...off3]) { expect(r.alive).toBe(true); expect(r.over).toBe(0); }
    expect(mean(on3.map((r) => r.avg))).toBeGreaterThanOrEqual(mean(off3.map((r) => r.avg)));
    expect(run20(1, true).json).toBe(on3[0].json);
  });
});
