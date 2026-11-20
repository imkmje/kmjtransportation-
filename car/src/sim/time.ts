import { config } from '../config';

const WPM = config.time.weeksPerMonth;
const WPY = WPM * config.time.monthsPerYear;

export interface GameDate { year: number; month: number; week: number } // month 1~12, week 1~4

/** 주 번호(0 = 1970년 1월 1주) → 연·월·주 */
export const dateOf = (w: number): GameDate => ({ year: config.time.startYear + Math.floor(w / WPY), month: Math.floor((w % WPY) / WPM) + 1, week: (w % WPM) + 1 });
export const yearOf = (w: number): number => config.time.startYear + Math.floor(w / WPY);
/** 월 번호(0 = 1970년 1월) */
export const monthOf = (w: number): number => Math.floor(w / WPM);
export const isMonthEnd = (w: number): boolean => w % WPM === WPM - 1;
export const isYearStart = (w: number): boolean => w % WPY === 0;
/** 월 번호 → 소수 연도(1970년 1월 = 1970.0, 7월 = 1970.5). 시장 규모를 달마다 매끄럽게 보간할 때 쓴다 */
export const monthTime = (m: number): number => config.time.startYear + m / config.time.monthsPerYear;
export const yearOfMonth = (m: number): number => config.time.startYear + Math.floor(m / config.time.monthsPerYear);
export const dateLabel = (w: number): string => { const d = dateOf(w); return `${d.year}년 ${d.month}월 ${d.week}주`; };
export const monthLabel = (m: number): string => `${yearOfMonth(m)}년 ${(m % config.time.monthsPerYear) + 1}월`;
