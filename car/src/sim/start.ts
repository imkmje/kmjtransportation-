// 1.5.0 새 게임 선택지: 시작 연도·시작 조건·도전 과제. 수치는 config.newGame. 상태의 start가 없으면(옛 저장) 1970년·보통·도전 없음
import { config } from '../config';
import { RIVALS, TECHS, techById } from '../data';
import { derivativePlan } from './derive';
import { eraTimeline, optionTech, REGION } from './events';
import { updateRivals } from './market';
import { yearOf } from './time';
import type { CarState, Challenge, Command, StartCondition } from './types';

const NG = config.newGame, WPY = config.time.weeksPerMonth * config.time.monthsPerYear;
export const START_YEARS = NG.years;
export const CONDITIONS = Object.keys(NG.conditions) as StartCondition[];
export const CHALLENGES = Object.keys(NG.challenges) as Challenge[];

export const startOf = (s: Pick<CarState, 'start'>): NonNullable<CarState['start']> => s.start ?? { year: config.time.startYear, condition: 'normal', challenges: [] };
export const startYearOf = (s: Pick<CarState, 'start'>): number => startOf(s).year;
export const hasChallenge = (s: Pick<CarState, 'start'>, c: Challenge): boolean => startOf(s).challenges.includes(c);
/** 시작 연도별 값(표에 없는 해는 1970년 값) */
export const eraStartOf = (year: number) => NG.byYear[String(year) as keyof typeof NG.byYear] ?? NG.byYear['1970'];

/** 시작 현금 = 난이도 현금 × 시작 연도 배수 × 시작 조건 배수 */
export const startCash = (s: Pick<CarState, 'difficulty' | 'start'>): number => { const st = startOf(s); return Math.round(config.difficulty[s.difficulty ?? 'normal'].cash * eraStartOf(st.year).cash * NG.conditions[st.condition].cash); };
/** 새 게임 선택지 검사(없으면 null) */
export function startOptionsError(year: number, condition: StartCondition, challenges: Challenge[]): string | null {
  if (!(START_YEARS as readonly number[]).includes(year)) return `시작 연도는 ${START_YEARS.join('·')}년 중에서 고르세요.`;
  if (!CONDITIONS.includes(condition)) return '없는 시작 조건입니다.';
  for (const c of challenges) {
    if (!CHALLENGES.includes(c)) return '없는 도전 과제입니다.';
    const min = NG.challenges[c].minYear;
    if (min && year < min) return `「${NG.challenges[c].name}」은 ${min}년 이후 시작에서만 고를 수 있습니다.`;
  }
  return new Set(challenges).size === challenges.length ? null : '같은 도전 과제를 두 번 골랐습니다.';
}

/** 늦은 시작: 시작 연도 − 여유 햇수까지 나온 기술(반복 기술 제외)과 그 선행 기술, 시작 때 이미 시작한 규제의 의무 장비 기술을 연구 완료로.
 *  경쟁사는 1970년부터 시작 달까지 달마다 갱신해(게임 난수를 쓰지 않는다) 그 시대 모델로 맞춘다. 과거 사건 뉴스는 만들지 않는다(사건은 달마다 그달 것만 알린다) */
export function applyLateStart(s: CarState, year: number): void {
  const m0 = (year - config.time.startYear) * config.time.monthsPerYear;
  s.week = (year - config.time.startYear) * WPY;
  if (m0 <= 0) return;
  const want = new Set(TECHS.filter((t) => !t.repeatable && t.year <= year - NG.techSlackYears).map((t) => t.id));
  for (const sp of eraTimeline(s.seed)) if (sp.start <= m0) for (const e of sp.def.effects) if (e.type === 'regulation' && e.region === REGION) for (const o of e.options ?? []) { const t = optionTech(o); if (t) want.add(t.id); }
  const add = (id: string) => { if (s.research.done.includes(id)) return; for (const q of techById(id).pre) add(q); s.research.done.push(id); };
  for (const t of TECHS) if (want.has(t.id)) add(t.id); // 자료 순서(결정론)
  for (let m = 1; m <= m0; m++) updateRivals(s.rivals, s.seed, m);
}

/** 새 차종이 생기는 명령인가(차종 세 개까지 과제) */
const newNames = (s: CarState): number => s.nameplates.length + s.projects.filter((p) => p.kind === 'new' || (p.kind === 'derivative' && p.into === undefined)).length;
/** 4.1.0 도전 과제 실패(되돌릴 수 없다). 그 과제를 고르지 않았거나 이미 실패면 그대로 */
export function failChallenge(s: CarState, id: Challenge, why: string): void {
  const st = s.start;
  if (!st?.challenges.includes(id) || st.failed?.some((f) => f.id === id)) return;
  (st.failed ??= []).push({ id, week: s.week, why });
}
/** 4.1.0 전기차만: 가솔린 등 전기 외 모델이 있는 경쟁사(인수하면 그 모델을 물려받는다) */
const hasNonEv = (rivalId: string): boolean => { const r = RIVALS.find((x) => x.id === rivalId); return !!r && !r.ev; };
/** 도전 과제가 막는 명령의 이유(없으면 null) */
export function challengeError(s: CarState, cmd: Command): string | null {
  const ch = startOf(s).challenges;
  if (!ch.length) return null;
  const C = NG.challenges, tail = ' (도전 과제)';
  if (ch.includes('evOnly') && (cmd.type === 'startProject' || cmd.type === 'startFullChange') && cmd.powertrain !== C.evOnly.powertrain) return `「${C.evOnly.name}」: 전기 외 동력으로는 개발을 시작할 수 없습니다.${tail}`;
  if (ch.includes('evOnly') && cmd.type === 'acquireRival' && hasNonEv(cmd.rivalId)) return `「${C.evOnly.name}」: 이 회사는 전기차가 아닌 모델을 팔고 있어, 인수하면 가솔린 차를 물려받습니다. 인수할 수 없습니다.${tail}`; // 4.1.0
  if (ch.includes('evOnly') && cmd.type === 'foundSubsidiary' && (cmd.kind === 'premium' || cmd.kind === 'value')) return `「${C.evOnly.name}」: 브랜드 자회사는 가솔린 모델로 시작하므로 세울 수 없습니다. 부품 회사·할부 금융은 세울 수 있습니다.${tail}`;
  if (ch.includes('evOnly') && cmd.type === 'subPlanModel' && cmd.powertrain !== C.evOnly.powertrain) return `「${C.evOnly.name}」: 전기 외 동력으로는 개발을 시작할 수 없습니다.${tail}`;
  if (ch.includes('names3')) {
    const plan = cmd.type === 'startDerivative' ? derivativePlan(s, cmd.generationId, cmd.variant, { name: cmd.name }) : null;
    const adds = cmd.type === 'startProject' || (!!plan && typeof plan !== 'string' && !plan.into);
    if (adds && newNames(s) >= C.names3.max) return `「${C.names3.name}」: 차종은 ${C.names3.max}개까지만 낼 수 있습니다(개발 중인 새 차종 포함). 기존 차종의 풀체인지·페이스리프트는 됩니다.${tail}`;
  }
  if (ch.includes('noLoan') && cmd.type === 'borrow') return `「${C.noLoan.name}」: 대출을 받을 수 없습니다.${tail}`;
  if (ch.includes('noExec') && (cmd.type === 'appointExec' || cmd.type === 'postExecJob' || cmd.type === 'hireExec')) return `「${C.noExec.name}」: 임원을 둘 수 없습니다.${tail}`;
  return null;
}

/** 화면용: 이 판의 도전 과제와 진행(규칙으로 막으므로 늘 지켜지는 중, 햇수 = 시작부터 지난 해) */
export function challengeInfo(s: CarState): { id: Challenge; name: string; desc: string; years: number; failed: { year: number; why: string } | null }[] {
  const years = Math.max(0, yearOf(s.week) - startYearOf(s));
  return startOf(s).challenges.map((id) => { const f = startOf(s).failed?.find((x) => x.id === id); return { id, name: NG.challenges[id].name, desc: NG.challenges[id].desc, years: f ? Math.max(0, yearOf(f.week) - startYearOf(s)) : years, failed: f ? { year: yearOf(f.week), why: f.why } : null }; });
}
