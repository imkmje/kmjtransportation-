// 연 보고서(0.8.0): 한 해의 장부·차·평판·연구·사건을 모은다(순수 함수, 상태를 바꾸지 않는다)
import { config } from '../config';
import { TECHS, techById } from '../data';
import { allGens } from './game';
import { startCash, startYearOf } from './start';
import { todoItems } from './queries';
import { yearOf, yearOfMonth } from './time';
import { estimatePnl } from './history';
import type { CarState } from './types';

export interface YearMoney { revenue: number; profit: number; sold: number; cash: number | null }
export interface YearCarRow { genId: number; name: string; sold: number; profit: number | null } // profit: 0.8.0 이전 해는 모른다(null)
export interface YearReport {
  year: number; money: YearMoney | null; prev: YearMoney | null; prevCash: number | null;
  cars: YearCarRow[]; best: YearCarRow | null;
  repChange: number; repReasons: { reason: string; delta: number }[];
  staff: number; execs: string[];
  launches: string[]; discontinued: string[]; research: string[]; events: string[];
  next: string[]; // 내년에 볼 것: 막 끝난 해의 보고서에만(지금 할 일 중 급한 일, 없으면 앞의 3개)
}

const M = () => config.time.monthsPerYear;
/** 그해 돈: 기록이 열두 달 다 있으면 기록, 아니면 장부(최근 24개월), 둘 다 없으면 null */
function yearMoney(s: CarState, y: number): YearMoney | null {
  const log = s.years?.[y], rows = s.ledger.filter((e) => e.year === y);
  if (log && (log.months >= M() || log.months >= rows.length) && log.months > 0) return { revenue: log.revenue, profit: log.profit, sold: log.sold, cash: log.cash ?? null };
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  return { revenue: rows.reduce((a, e) => a + e.revenue, 0), profit: rows.reduce((a, e) => a + e.profit, 0), sold: rows.reduce((a, e) => a + e.sold, 0), cash: last.monthOfYear === M() ? last.cash : null };
}

/** 보고서를 볼 수 있는 해(끝난 해 중 장부나 기록이 있는 해), 최근 것이 앞 */
export function reportYears(s: CarState): number[] {
  const out: number[] = [];
  for (let y = yearOf(s.week) - 1; y >= startYearOf(s); y--) if (yearMoney(s, y)) out.push(y);
  return out;
}

export function yearReport(s: CarState, year: number): YearReport {
  const log = s.years?.[year], np = (id: number) => s.nameplates.find((n) => n.generations.some((g) => g.id === id))?.name ?? '';
  const cars: YearCarRow[] = [];
  for (const g of allGens(s)) {
    const sold = g.sales.reduce((a, n, i) => a + (yearOfMonth(g.launchMonth + i) === year ? n : 0), 0), profit = log ? log.cars[g.id] ?? 0 : null;
    if (sold > 0 || profit) cars.push({ genId: g.id, name: `${np(g.id)} ${g.number}세대`, sold, profit });
  }
  cars.sort((a, b) => b.sold - a.sold || a.genId - b.genId);
  const reasons = Object.entries(log?.rep ?? {}).map(([reason, delta]) => ({ reason, delta })).filter((x) => Math.abs(x.delta) >= 0.05).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const gens = allGens(s), launches: string[] = [], discontinued: string[] = [];
  for (const g of gens) {
    if (yearOfMonth(g.launchMonth) === year) launches.push(`「${np(g.id)}」 ${g.number}세대`);
    for (const e of g.editions) if (e.kind === 'facelift' && yearOf(e.launchWeek) === year) launches.push(`「${np(g.id)}」 ${g.number}세대 페이스리프트`);
    if (g.endMonth !== null && yearOfMonth(g.endMonth) === year) discontinued.push(`「${np(g.id)}」 ${g.number}세대`);
  }
  const prevM = yearMoney(s, year - 1), todo = year === yearOf(s.week) - 1 ? todoItems(s) : [], urgent = todo.filter((t) => t.urgent);
  return {
    year, money: yearMoney(s, year), prev: prevM, prevCash: prevM?.cash ?? (year === startYearOf(s) ? startCash(s) : null),
    cars, best: cars[0]?.sold ? cars[0] : null,
    repChange: Object.values(log?.rep ?? {}).reduce((a, d) => a + d, 0), repReasons: reasons,
    staff: log?.staff ?? s.staff.length, execs: log?.execs ?? [],
    launches, discontinued, research: (log?.research ?? []).filter((id) => TECHS.some((t) => t.id === id)).map((id) => techById(id).name),
    events: s.events.news.filter((n) => yearOf(n.week) === year && (n.category === 'start' || n.category === 'regulation' || n.category === 'result')).map((n) => n.text).slice(-8),
    next: (urgent.length ? urgent : todo.slice(0, 3)).map((t) => t.title),
  };
}

// ---------- 1.5.0 통계(기록 탭): 연도별 값, 차종별 판매·이익, 동력·차체 비중의 10년 단위 변화, 한 줄 요약 ----------
export type StatsRange = 'all' | '20y' | '10y';
export interface StatsYear { year: number; sold: number; revenue: number; profit: number; cash: number | null; rep: number | null; staff: number | null } // 옛 저장에 없는 항목은 null
export interface StatsCar { nameplateId: number; name: string; sold: number; profit: number } // profit: 매출 − 원가 − 광고 − 리콜(개발비 제외), 기간 안
export interface StatsMix { decade: number; total: number; pt: Record<string, number>; body: Record<string, number> } // 판매 대수
export interface StatsSummary { sold: number; net: number; names: number; gens: number; bestReview: { name: string; value: number } | null; bestSeller: { name: string; value: number } | null }
export interface StatsData { years: StatsYear[]; cars: StatsCar[]; mix: StatsMix[]; summary: StatsSummary; from: number }

/** 끝난 해만 보인다. 기간: 전체 / 최근 20년 / 최근 10년(끝난 해 기준). 요약은 늘 전체 기간 */
export function statsData(s: CarState, range: StatsRange): StatsData {
  const cur = yearOf(s.week), first = startYearOf(s), from = range === 'all' ? first : Math.max(first, cur - (range === '20y' ? 20 : 10));
  const years: StatsYear[] = [];
  for (let y = from; y < cur; y++) {
    const m = yearMoney(s, y), log = s.years?.[y];
    if (m) years.push({ year: y, sold: m.sold, revenue: m.revenue, profit: m.profit, cash: m.cash, rep: log?.repEnd ?? null, staff: log?.staff ?? null });
  }
  const m0 = (from - config.time.startYear) * M(), m1 = (cur - config.time.startYear) * M(), inR = (mo: number) => mo >= m0 && mo < m1;
  const cars: StatsCar[] = [], mix = new Map<number, StatsMix>();
  for (const n of [...s.nameplates].sort((a, b) => a.id - b.id)) {
    let sold = 0, profit = 0;
    for (const g of n.generations) {
      const months = (g.pnl ?? estimatePnl(g)).months;
      g.sales.forEach((v, i) => {
        const mo = g.launchMonth + i;
        if (!inR(mo)) return;
        sold += v; profit += months[i] ?? 0;
        const d = Math.floor(yearOfMonth(mo) / 10) * 10, x = mix.get(d) ?? { decade: d, total: 0, pt: {}, body: {} };
        x.total += v; x.pt[g.powertrain] = (x.pt[g.powertrain] ?? 0) + v; x.body[g.body] = (x.body[g.body] ?? 0) + v; mix.set(d, x);
      });
    }
    if (sold > 0 || profit) cars.push({ nameplateId: n.id, name: n.name, sold, profit });
  }
  const gens = allGens(s).filter((g) => g.editions.length), np = (id: number) => s.nameplates.find((n) => n.generations.some((g) => g.id === id))?.name ?? '';
  const best = [...gens].sort((a, b) => b.reviewAvg - a.reviewAvg || a.id - b.id)[0];
  const top = [...s.nameplates].map((n) => ({ name: n.name, v: n.generations.reduce((a, g) => a + g.totalSold, 0), id: n.id })).sort((a, b) => b.v - a.v || a.id - b.id)[0];
  const net = s.nameplates.reduce((a, n) => a + n.generations.reduce((b, g) => { const p = g.pnl ?? estimatePnl(g); return b + g.profit - (p.dev.base + p.dev.lift + p.dev.retro + p.dev.fix); }, 0), 0);
  return {
    years, cars, mix: [...mix.values()].sort((a, b) => a.decade - b.decade), from,
    summary: {
      sold: gens.reduce((a, g) => a + g.totalSold, 0), net, names: s.nameplates.filter((n) => n.generations.length).length, gens: gens.length,
      bestReview: best ? { name: `${np(best.id)} ${best.number}세대`, value: best.reviewAvg } : null, bestSeller: top && top.v > 0 ? { name: top.name, value: top.v } : null,
    },
  };
}
