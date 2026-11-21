import { describe, it, expect } from 'vitest';
import { Game, allGens } from '../src/sim/game';
import { steady } from '../src/sim/bots';
import { dateOf, dateLabel, monthOf, yearOf, monthLabel } from '../src/sim/time';
import { bodiesAt, optionsAt } from '../src/sim/cars';
import { config } from '../src/config';
import { SPEC } from './util';

const run = (g: Game, weeks: number, bot = steady()) => { for (let i = 0; i < weeks && g.state.status === 'playing'; i++) { bot.step(g); g.tick(); } };

describe('시간(4장)', () => {
  it('주 → 연·월·주: 4주 = 1개월, 48주 = 1년, 시작 1970년 1월 1주', () => {
    expect(dateOf(0)).toEqual({ year: 1970, month: 1, week: 1 });
    expect(dateOf(3)).toEqual({ year: 1970, month: 1, week: 4 });
    expect(dateOf(4)).toEqual({ year: 1970, month: 2, week: 1 });
    expect(dateOf(47)).toEqual({ year: 1970, month: 12, week: 4 });
    expect(dateOf(48)).toEqual({ year: 1971, month: 1, week: 1 });
    expect(dateOf(48 * 10 + 4 * 5 + 2)).toEqual({ year: 1980, month: 6, week: 3 });
    expect(monthOf(48)).toBe(12); expect(yearOf(47)).toBe(1970);
    expect(dateLabel(5)).toBe('1970년 2월 2주'); expect(monthLabel(13)).toBe('1971년 2월');
  });
  it('tick 한 번에 1주 진행', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    g.tick(); g.tick();
    expect(g.state.week).toBe(2);
  });
});

describe('새 게임', () => {
  it('회사 이름이 비면 "새 회사"', () => {
    expect(Game.create({ difficulty: 'normal', seed: 1 }).state.companyName).toBe('새 회사');
    expect(Game.create({ difficulty: 'normal', seed: 1, companyName: '   ' }).state.companyName).toBe('새 회사');
    expect(Game.create({ difficulty: 'normal', seed: 1, companyName: ' 한빛자동차 ' }).state.companyName).toBe('한빛자동차');
  });
  it('시작 상태: 현금 30억, 평판 10, 직원 4명(디자이너 1·엔지니어 2·테스터 1, 능력 25~35), 경쟁사 3곳', () => {
    const s = Game.create({ difficulty: 'normal', seed: 7 }).state;
    expect(s.cash).toBe(300000); expect(s.reputation).toBe(10); expect(s.saveVersion).toBe(5); expect(s.hqLevel).toBe(1); expect(s.factory).toEqual({ level: 1, build: null }); expect(s.candidates).toEqual([]);
    expect(s.staff.map((x) => x.role)).toEqual(['designer', 'engineer', 'engineer', 'tester']);
    for (const x of s.staff) { expect(x.ability).toBeGreaterThanOrEqual(25); expect(x.ability).toBeLessThanOrEqual(35); expect(x.potential).toBeGreaterThanOrEqual(50); expect(x.potential).toBeLessThanOrEqual(75); }
    expect(new Set(s.staff.map((x) => x.name)).size).toBe(4);
    expect(s.rivals.map((r) => r.name)).toEqual(['현다이', '포티', '도요다']);
  });
});

describe('결정론과 저장', () => {
  it('같은 시드·같은 명령이면 같은 상태, 다른 시드면 다른 상태', () => {
    const a = Game.create({ difficulty: 'normal', seed: 42 }), b = Game.create({ difficulty: 'normal', seed: 42 }), c = Game.create({ difficulty: 'normal', seed: 43 });
    run(a, 48 * 4); run(b, 48 * 4); run(c, 48 * 4);
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()));
    expect(JSON.stringify(a.toJSON())).not.toBe(JSON.stringify(c.toJSON()));
    expect(a.state.history.length).toBeGreaterThan(0); // 성공한 명령이 기록된다
  });
  it('저장 → 불러오기 → 이어서 실행 = 끊지 않은 실행(난수 상태 포함)', () => {
    const whole = Game.create({ difficulty: 'normal', seed: 9 });
    run(whole, 48 * 6);
    const part = Game.create({ difficulty: 'normal', seed: 9 });
    run(part, 48 * 2 + 7);
    const loaded = Game.fromJSON(JSON.parse(JSON.stringify(part.toJSON())));
    run(loaded, 48 * 6 - (48 * 2 + 7));
    expect(JSON.stringify(loaded.toJSON())).toBe(JSON.stringify(whole.toJSON()));
    expect(allGens(loaded.state).length).toBeGreaterThan(0);
  });
  it('잘못된 저장 파일은 거부', () => {
    expect(() => Game.fromJSON(null)).toThrow('카 컴퍼니 저장 파일이 아닙니다');
    expect(() => Game.fromJSON({ saveVersion: 99 })).toThrow('더 새로운 버전');
    expect(() => Game.fromJSON({ saveVersion: 1 })).toThrow('손상');
  });
  it('알 수 없는 명령은 한국어 이유로 거부', () => {
    const r = Game.create({ difficulty: 'normal', seed: 1 }).command({ type: 'nope' } as never);
    expect(r).toEqual({ ok: false, reason: '알 수 없는 명령입니다.' });
  });
});

describe('등장 연도(자료)와 연구 해금(4단계부터)', () => {
  it('차체: 소형 세단 1970, 해치백 1974, 중형 세단 1978', () => {
    expect(bodiesAt(1970).map((b) => b.id)).toEqual(['sedanS']);
    expect(bodiesAt(1974).map((b) => b.id)).toEqual(['sedanS', 'hatch']);
    expect(bodiesAt(1978).map((b) => b.id)).toEqual(['sedanS', 'sedanM', 'hatch']); // 0.6.0: 세단을 크기 순으로 묶어 둔다
  });
  it('옵션: 라디오 1970, 에어컨 1975, 파워 스티어링 1980', () => {
    expect(optionsAt(1974).map((o) => o.id)).toEqual(['radio']);
    expect(optionsAt(1975).map((o) => o.id)).toEqual(['radio', 'aircon']);
    expect(optionsAt(1980).map((o) => o.id)).toEqual(['radio', 'aircon', 'powerSteering']);
  });
  it('그해가 되어도 연구하지 않으면 쓸 수 없다(연도 자동 해금 없음)', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    expect(g.command({ type: 'startProject', ...SPEC, body: 'hatch' })).toEqual({ ok: false, reason: '아직 쓸 수 없는 차체입니다(연구가 필요합니다).' });
    expect(g.command({ type: 'startProject', ...SPEC, options: ['aircon'] })).toEqual({ ok: false, reason: '아직 쓸 수 없는 옵션입니다(연구가 필요합니다).' });
    g.state.week = 48 * 4 - 1;
    expect(g.tick().some((e) => e.kind === 'unlock')).toBe(false);
    expect(g.command({ type: 'startProject', ...SPEC, body: 'hatch' }).ok).toBe(false);
  });
  it('설정의 시작 연도는 1970', () => { expect(config.time.startYear).toBe(1970); });
});
