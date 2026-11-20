// 균형 점검 봇(설계서 16장 중 2단계 분량: 방치·신중·리프트 안 함·새 이름만)
import { config } from '../config';
import { COMPAT, MARKET, SEGMENTS, bodyById } from '../data';
import { bodiesAt, optionsAt, unitCost } from './cars';
import { Game, allGens, sellingGens } from './game';
import { REGION, cellMonthly, currentEdition } from './market';
import { planPreview } from './queries';
import { latestGen, launchAvgGrade } from './lifecycle';
import { monthOf, yearOf } from './time';
import type { Budget, Generation } from './types';

export interface Bot { name: string; step(g: Game): void }

/** 방치: 아무것도 하지 않는다(고정비만 나간다) */
export const idle: Bot = { name: 'idle', step() { /* 아무것도 안 함 */ } };

export interface SteadyOptions {
  budget: Budget; designWeeks: number; marketing: number; launchDefects: number; maxTestWeeks: number;
  faceliftMonths: number; // 세대 나이가 이 개월이 되면 페이스리프트(Infinity면 안 함)
  changeMonths: number; // 세대 나이가 이 개월이 되면 후속 차를 출시(그 5개월 전에 개발 시작)
  successor: 'fullchange' | 'newName'; // 후속: 같은 이름 풀체인지 / 매번 새 차종(전 세대 단종 뒤 출시)
}
const STEADY: SteadyOptions = { budget: 'normal', designWeeks: 12, marketing: 1, launchDefects: 5, maxTestWeeks: 12, faceliftMonths: 30, changeMonths: 72, successor: 'fullchange' };
const LEAD_MONTHS = 5; // 후속 차 개발을 시작하는 시점(교체 몇 개월 전)

/** 신중(8.4 의도한 흐름): 보통 예산·12주·결함이 충분히 줄면 출시·기준가 판매, 3년 차 페이스리프트, 6~7년 차 풀체인지 */
export function steady(opts: Partial<SteadyOptions> = {}): Bot {
  const o = { ...STEADY, ...opts };
  return {
    name: 'steady',
    step(g) {
      const s = g.state, year = yearOf(s.week);
      const onSale = sellingGens(s).find((x) => x.status === 'onSale');
      const age = onSale ? monthOf(s.week) - onSale.launchMonth : 0;
      const np = s.nameplates.at(-1), p = s.projects[0];
      if (!p) {
        const lifted = onSale?.editions.some((e) => e.kind === 'facelift');
        if (onSale && !lifted && age >= o.faceliftMonths && age < o.changeMonths - LEAD_MONTHS) {
          g.command({ type: 'startFacelift', generationId: onSale.id, options: optionsAt(year).slice(-config.dev.maxOptions).map((x) => x.id) });
          return;
        }
        if (!onSale || age >= o.changeMonths - LEAD_MONTHS) {
          const body = bestBody(year);
          const mix = MARKET[REGION].mix[body];
          const segment = [...SEGMENTS].sort((a, b) => COMPAT[body][b.id] * mix[b.id] - COMPAT[body][a.id] * mix[a.id])[0].id;
          const spec = {
            body, segment, powertrain: 'gasoline', tier: 2, options: optionsAt(year).slice(-config.dev.maxOptions).map((x) => x.id),
            direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: o.budget, designWeeks: o.designWeeks,
          };
          // 직전 차보다 못한 차를 내지 않으려고, 예상 등급이 직전 세대 출시 당시보다 낮으면 기간·예산을 올린다(세 봇 같은 규칙)
          const prev = np ? latestGen(np) : undefined, tries = [spec, { ...spec, designWeeks: 16 }, { ...spec, designWeeks: 16, budget: 'high' as Budget }];
          const pick = (prev && tries.find((t) => planPreview(s, { ...t, name: '' }).avg >= launchAvgGrade(prev))) || tries[prev ? tries.length - 1 : 0];
          if (o.successor === 'fullchange' && np) g.command({ type: 'startFullChange', nameplateId: np.id, ...pick });
          else g.command({ type: 'startProject', name: '', ...pick });
        }
        return;
      }
      if (p.phase === 'test' && p.testWeeks >= config.dev.minTestWeeks && (p.defectEst <= o.launchDefects || p.testWeeks >= o.maxTestWeeks)) {
        const launch = (price: number) => g.command({ type: 'launch', projectId: p.id, price, marketing: o.marketing, color: '#c8102e', wheels: 0 });
        if (p.kind === 'facelift') { // 늘어난 원가(옵션·동력 단계)만큼 가격을 올려 대당 이익을 지킨다
          if (!onSale) { g.command({ type: 'cancelProject', projectId: p.id }); return; }
          const ed = currentEdition(onSale), up = unitCost(p.body, p.powertrain, p.tier, p.options) - unitCost(p.body, p.powertrain, ed.tier, ed.options);
          launch(Math.min(bodyPrice(p.body) * config.price.max, Math.round(ed.price + Math.max(0, up))));
          return;
        }
        if (p.kind === 'fullchange') { launch(bodyPrice(p.body)); return; } // 같은 생산 라인을 이어받는다
        if (onSale && age >= o.changeMonths) g.command({ type: 'discontinue', generationId: onSale.id });
        if (!sellingGens(s).length) launch(bodyPrice(p.body));
      }
    },
  };
}
/** 리프트 안 함(16장): 페이스리프트 없이 5년(60개월) 주기 풀체인지 */
export const noFacelift = (opts: Partial<SteadyOptions> = {}): Bot => ({ ...steady({ faceliftMonths: Infinity, changeMonths: 60, ...opts }), name: 'noFacelift' });
/** 새 이름만: 페이스리프트·풀체인지 없이 5년(60개월) 주기로 매번 새 차종(전 세대를 단종하고 라인이 비면 출시) */
export const newNameOnly = (opts: Partial<SteadyOptions> = {}): Bot => ({ ...steady({ faceliftMonths: Infinity, changeMonths: 60, successor: 'newName', ...opts }), name: 'newNameOnly' });
const bodyPrice = (id: string) => bodyById(id).basePrice;
/** 쓸 수 있는 차체 중 (칸 규모 × 기준가 대당 이익)이 가장 큰 것 */
const bestBody = (year: number): string =>
  bodiesAt(year).map((b) => ({ id: b.id, v: cellMonthly(b.id, year) * (b.basePrice - unitCost(b.id, 'gasoline', 2, [])) })).sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1))[0].id;

export interface RunResult {
  seed: number; survived: boolean; months: number; cash: number;
  firstReview: number | null; // 첫 차 평론 평균
  firstPayback: number | null; // 첫 차가 개발비를 회수한 개월 수(출시 달 = 0개월 뒤 1)
  cars: number; bailout: boolean;
}

/** 봇 한 판: years년 돌리고 요약 */
export function runBot(bot: Bot, seed: number, years: number): RunResult {
  const g = Game.create({ seed, companyName: bot.name });
  const weeks = years * config.time.monthsPerYear * config.time.weeksPerMonth;
  let first: Generation | undefined, payback: number | null = null;
  for (let w = 0; w < weeks && g.state.status === 'playing'; w++) {
    bot.step(g);
    g.tick();
    first ??= allGens(g.state)[0];
    if (first && payback === null && first.profit >= first.devCost) payback = first.sales.length;
  }
  const s = g.state;
  return {
    seed, survived: s.status === 'playing', months: monthOf(s.week), cash: s.cash,
    firstReview: first ? first.reviewAvg : null, firstPayback: payback, cars: allGens(s).length, bailout: s.loan.bailoutUsed,
  };
}
