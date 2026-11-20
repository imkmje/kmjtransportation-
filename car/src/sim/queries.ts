// 화면이 쓰는 조회 함수(순수 함수, 상태를 바꾸지 않는다)
import { config } from '../config';
import { bodyById } from '../data';
import { avgGrade, finalStats, grade, grades, lifeFactor, standard, unitCost } from './cars';
import { allGens, sellingGens } from './game';
import { awarenessStart, awarenessTarget, currentEdition, monthlyDemand, toSaleCar, ageMonths } from './market';
import { criticScores, mean } from './reviews';
import { monthOf, yearOf, yearOfMonth } from './time';
import type { CarState, Generation, Project, Stats } from './types';

export const projectById = (s: CarState, id: number): Project | undefined => s.projects.find((p) => p.id === id);
export const generationById = (s: CarState, id: number): Generation | undefined => allGens(s).find((g) => g.id === id);
export const nameplateOf = (s: CarState, genId: number) => s.nameplates.find((n) => n.generations.some((g) => g.id === genId));

/** 세대의 현재 표시 등급(올해 기준, 해마다 낮아진다) */
export const generationGrades = (s: CarState, g: Generation): Stats => grades(currentEdition(g).stats, yearOf(s.week));

/** 지금 출시하면 받을 능력치 원점수·표시 등급·평균 */
export function projectPreview(s: CarState, projectId: number): { stats: Stats; grades: Stats; avg: number } | null {
  const p = projectById(s, projectId);
  if (!p) return null;
  const stats = finalStats(p.body, p.powertrain, p.tier, p.options, p.points, p.defects), y = yearOf(s.week);
  return { stats, grades: grades(stats, y), avg: avgGrade(stats, y) };
}

/** 예상 평점(난수 없이): 평론가 4명 점수와 평균 */
export function expectedReviews(s: CarState, projectId: number, price: number): { scores: number[]; avg: number } | null {
  const p = projectById(s, projectId), pv = projectPreview(s, projectId);
  if (!p || !pv) return null;
  const scores = criticScores(pv.stats, yearOf(s.week), bodyById(p.body).basePrice, price, p.defects, () => 0);
  return { scores, avg: mean(scores) };
}

/** 대당 이익 = 판매가 − 원가 */
export const unitProfit = (body: string, powertrain: string, tier: number, options: string[], price: number): number => price - unitCost(body, powertrain, tier, options);
export const generationUnitProfit = (g: Generation): number => { const e = currentEdition(g); return unitProfit(g.body, g.powertrain, e.tier, e.options, e.price); };

/** 예상 월 판매 범위: 최소 = 출시 첫 달(수명 0.6, 시작 인지도), 최대 = 수명 1.0·목표 인지도. 생산 상한 적용 */
export function salesForecast(s: CarState, projectId: number, price: number, marketing: number): { min: number; max: number } | null {
  const p = projectById(s, projectId), pv = projectPreview(s, projectId), ex = expectedReviews(s, projectId, price);
  if (!p || !pv || !ex) return null;
  const y = yearOf(s.week), m = monthOf(s.week);
  const others = sellingGens(s).filter((g) => g.status === 'onSale').map((g) => toSaleCar(g, m));
  const start = awarenessStart(s.reputation, ex.avg), target = Math.max(start, awarenessTarget(s.reputation, marketing, grade(pv.stats.Q, y)));
  const car = { body: p.body, segment: p.segment, stats: pv.stats, price };
  const cap = (d: number) => Math.round(Math.min(config.factory.capacity, d));
  return {
    min: cap(monthlyDemand(s, { ...car, awareness: start, life: config.life.start }, others, y)),
    max: cap(monthlyDemand(s, { ...car, awareness: target, life: 1 }, others, y)),
  };
}

/** 수명 막대(0~1): 정점 이후의 수명 감소 × 기준 상승에 따른 낡음 */
export function lifeBar(s: CarState, g: Generation): number {
  const m = g.status === 'onSale' ? monthOf(s.week) : (g.endMonth ?? monthOf(s.week));
  const age = ageMonths(g, m), decay = age < config.life.rampMonths ? 1 : lifeFactor(age);
  return Math.max(0, Math.min(1, (decay * standard(yearOfMonth(g.launchMonth))) / standard(yearOfMonth(m))));
}

/** 차 카드 조언 한 줄 */
export function advice(g: Generation): string {
  const d = config.discontinue;
  if (g.status === 'discontinued') return '단종된 차입니다.';
  if (g.status === 'ending') return '이번 달 말까지만 판매하고 단종됩니다.';
  if (!g.sales.length) return '출시 직후입니다. 첫 달 판매를 기다리세요.';
  const last = g.sales[g.sales.length - 1], peak = Math.max(...g.sales);
  if (g.sales.length >= d.adviceMonths && g.sales.slice(-d.adviceMonths).every((x) => x < d.adviceSales)) return `판매가 ${d.adviceMonths}개월째 월 ${d.adviceSales}대 미만입니다. 단종을 권합니다.`;
  if (peak > 0 && last <= peak * d.adviceDrop) return `판매가 정점의 ${Math.round((last / peak) * 100)}%로 떨어졌습니다. 후속 모델을 준비하세요.`;
  if (g.lastDemand > config.factory.capacity) return '주문이 생산량을 넘습니다. 가격을 올려도 잘 팔립니다.';
  if (currentEdition(g).defects > 0) return '남은 결함이 있어 리콜 위험이 있습니다.';
  return '판매가 순조롭습니다.';
}

/** 출시할 수 있는 빈 생산 라인이 있는가 */
export const hasFreeLine = (s: CarState): boolean => sellingGens(s).length < config.factory.lines;

/** 대출 남은 한도 */
export { loanLimit, loanRate } from './finance';
export { dateOf, dateLabel, monthLabel } from './time';
export { grade, grades, avgGrade, standard, unitCost, bodiesAt, powertrainsAt, optionsAt, salaryOf } from './cars';
