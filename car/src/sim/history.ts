// 0.10.0 기록 쌓기: 직원 성장 기록, 세대 손익 누적(예전 저장은 추정으로 시작). game.ts·execs.ts가 부른다
import { config } from '../config';
import type { ExecRole, Generation, GenPnl, ProjectKind, Staff } from './types';

/** 새로 들어온 직원(채용·창업·인재 영입·교체 고용·외부 임원)의 기록 시작 */
export const startHist = (x: Staff, week: number): Staff => { x.hist = { join: week, joinAbility: x.ability, since: week, years: {}, cars: [], execs: [] }; return x; };
/** 기록이 없는 직원(예전 저장)은 지금부터 쌓는다 */
export const ensureHist = (x: Staff, week: number): NonNullable<Staff['hist']> => (x.hist ??= { join: null, joinAbility: null, since: week, years: {}, cars: [], execs: [] });
export const noteCar = (staff: Staff[], week: number, gen: number, kind: ProjectKind): void => { for (const x of staff) ensureHist(x, week).cars.push({ gen, kind }); };
/** 임원 임명(on)·해임(off) */
export function noteExec(x: Staff, role: ExecRole, week: number, on: boolean): void {
  const h = ensureHist(x, week);
  if (on) h.execs.push({ role, from: week, to: null });
  else { const e = [...h.execs].reverse().find((r) => r.role === role && r.to === null); if (e) e.to = week; }
}

/** 예전 저장의 세대 손익: 판매 대수 × 지금 판 가격으로 매출, 달마다 광고비(지금 광고 등급), 원가는 누적 이익에서 거꾸로. 월별 이익은 누적 이익을 판매 대수 비율로 나눔 */
export function estimatePnl(g: Generation): GenPnl {
  const price = g.editions[g.editions.length - 1].price, rev = g.totalSold * price, mk = g.sales.length * config.awareness.marketingCost[g.marketing];
  const lift = g.editions.some((e) => e.kind === 'facelift');
  return {
    rev, mk, recall: 0, cogs: Math.max(0, rev - mk - g.profit), dev: { base: g.devCost, lift: 0, retro: 0, fix: 0 },
    months: g.sales.map((n) => (g.totalSold > 0 ? (g.profit * n) / g.totalSold : g.sales.length ? g.profit / g.sales.length : 0)), ...(g.sales.length || lift ? { est: true as const } : {}),
  };
}
export const newPnl = (devBase: number): GenPnl => ({ rev: 0, cogs: 0, mk: 0, recall: 0, dev: { base: devBase, lift: 0, retro: 0, fix: 0 }, months: [] });
/** 손익 기록(없으면 추정으로 만든다) */
export const pnlOf = (g: Generation): GenPnl => (g.pnl ??= estimatePnl(g));
