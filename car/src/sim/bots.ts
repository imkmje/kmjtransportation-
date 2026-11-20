// 균형 점검 봇(설계서 16장 중 1단계 분량: 방치·신중)
import { config } from '../config';
import { COMPAT, MARKET, SEGMENTS, bodyById } from '../data';
import { bodiesAt, optionsAt } from './cars';
import { Game, allGens, sellingGens } from './game';
import { REGION } from './market';
import { monthOf, yearOf } from './time';
import type { Budget, Generation } from './types';

export interface Bot { name: string; step(g: Game): void }

/** 방치: 아무것도 하지 않는다(고정비만 나간다) */
export const idle: Bot = { name: 'idle', step() { /* 아무것도 안 함 */ } };

export interface SteadyOptions { budget: Budget; designWeeks: number; cycleYears: number; marketing: number; launchDefects: number; maxTestWeeks: number }
const STEADY: SteadyOptions = { budget: 'normal', designWeeks: 12, cycleYears: 5, marketing: 1, launchDefects: 5, maxTestWeeks: 12 };

/** 신중: 보통 예산·12주·결함이 충분히 줄면 출시·기준가 판매·5년마다 단종 후 새 차 */
export function steady(opts: Partial<SteadyOptions> = {}): Bot {
  const o = { ...STEADY, ...opts };
  return {
    name: 'steady',
    step(g) {
      const s = g.state, year = yearOf(s.week), cycle = o.cycleYears * config.time.monthsPerYear;
      const onSale = sellingGens(s).find((x) => x.status === 'onSale');
      const age = onSale ? monthOf(s.week) - onSale.launchMonth : 0;
      const p = s.projects[0];
      if (!p && (!onSale || age >= cycle - 5)) { // 판매 중인 차가 없거나, 교체 5개월 전이면 새 차 개발
        const body = bodiesAt(year).at(-1)!.id; // 가장 최근에 해금된 차체
        const mix = MARKET[REGION].mix[body];
        const segment = [...SEGMENTS].sort((a, b) => COMPAT[body][b.id] * mix[b.id] - COMPAT[body][a.id] * mix[a.id])[0].id;
        g.command({
          type: 'startProject', name: '', body, segment, powertrain: 'gasoline', tier: 2,
          options: optionsAt(year).slice(-config.dev.maxOptions).map((x) => x.id),
          direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: o.budget, designWeeks: o.designWeeks,
        });
        return;
      }
      if (p && p.phase === 'test' && p.testWeeks >= config.dev.minTestWeeks && (p.defectEst <= o.launchDefects || p.testWeeks >= o.maxTestWeeks)) {
        if (onSale && age >= cycle) g.command({ type: 'discontinue', generationId: onSale.id });
        if (!sellingGens(s).length) g.command({ type: 'launch', projectId: p.id, price: bodyPrice(p.body), marketing: o.marketing, color: '#c8102e', wheels: 0 });
      }
    },
  };
}
const bodyPrice = (id: string) => bodyById(id).basePrice;

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
