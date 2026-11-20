// 재무(설계서 9.4): 대출 한도·이율
import { config } from '../config';
import type { CarState } from './types';

/** 최근 12개월 매출 */
export const revenue12 = (state: CarState): number => state.ledger.slice(-config.time.monthsPerYear).reduce((a, e) => a + e.revenue, 0);
/** 대출 한도 = (20억 + 최근 12개월 매출 × 0.3) × 구제 금융 배수 */
export const loanLimit = (state: CarState): number => (config.loan.base + revenue12(state) * config.loan.revenueRatio) * state.loan.limitMult;
/** 월 이율: 한도의 70%를 넘게 쓰면 1.0%, 아니면 0.6% */
export const loanRate = (state: CarState): number => (state.loan.balance > loanLimit(state) * config.loan.highUse ? config.loan.highRate : config.loan.rate);
