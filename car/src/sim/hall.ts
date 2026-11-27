// 1.0.0 명예의 전당: 우리 회사 역대 기록(순수 조회, 상태를 바꾸지 않는다). 기록이 없는 옛 저장은 계산할 수 있는 항목만
import { config } from '../config';
import { avgGrade } from './cars';
import { allGens } from './game';
import { modelPnL } from './insight';
import { yearOf } from './time';
import type { CarState, Generation } from './types';

/** 차 한 대(세대) 기록: value는 비교에 쓴 값, month는 그 기록의 달(한 달 최고 판매) */
export interface HallCar { key: string; label: string; genId: number; nameplateId: number; value: number; month?: number }
export interface HallRow { key: string; label: string; value: number; year?: number; text?: string }
export interface HallOfFame { cars: HallCar[]; shame: HallCar[]; company: HallRow[]; empty: boolean }

/** 가장 큰(또는 작은) 값의 세대. 같으면 ID가 작은 쪽(결정론) */
function pick(gens: Generation[], val: (g: Generation) => number | null, low = false): { g: Generation; v: number } | null {
  let best: { g: Generation; v: number } | null = null;
  for (const g of [...gens].sort((a, b) => a.id - b.id)) {
    const v = val(g);
    if (v === null || !Number.isFinite(v)) continue;
    if (!best || (low ? v < best.v : v > best.v)) best = { g, v };
  }
  return best;
}

export function hallOfFame(s: CarState): HallOfFame {
  const gens = allGens(s).filter((g) => g.editions.length), np = (g: Generation) => s.nameplates.find((n) => n.generations.includes(g))!;
  const pnl = new Map(gens.map((g) => [g.id, modelPnL(s, g.id)]));
  const cars: HallCar[] = [], shame: HallCar[] = [];
  const add = (list: HallCar[], key: string, label: string, r: { g: Generation; v: number } | null, month?: number) => { if (r) list.push({ key, label, genId: r.g.id, nameplateId: np(r.g).id, value: r.v, month }); };
  add(cars, 'sold', '가장 많이 팔린 차', pick(gens, (g) => (g.totalSold > 0 ? g.totalSold : null)));
  { // 가장 많이 팔린 차종(이름 전체): 그 차종의 가장 최근 세대로 보인다
    let best: { id: number; v: number } | null = null;
    for (const n of [...s.nameplates].sort((a, b) => a.id - b.id)) { const v = n.generations.reduce((a, g) => a + g.totalSold, 0); if (v > 0 && (!best || v > best.v)) best = { id: n.id, v }; }
    const n = best && s.nameplates.find((x) => x.id === best!.id);
    if (n && best) cars.push({ key: 'soldName', label: '가장 많이 팔린 차종', genId: n.generations.at(-1)!.id, nameplateId: n.id, value: best.v });
  }
  add(cars, 'pricey', '가장 비싼 차(출시가)', pick(gens, (g) => g.editions[0].price));
  add(cars, 'cheap', '가장 싼 차(출시가)', pick(gens, (g) => g.editions[0].price, true));
  add(cars, 'review', '평론이 가장 높은 차', pick(gens, (g) => g.reviewAvg));
  add(cars, 'profit', '이익을 가장 많이 낸 차(개발비 뺀 이익)', pick(gens, (g) => { const p = pnl.get(g.id); return p && p.net > 0 ? p.net : null; }));
  add(cars, 'payback', '개발비를 가장 빨리 회수한 차', pick(gens, (g) => pnl.get(g.id)?.paybackMonths ?? null, true));
  add(cars, 'long', '가장 오래 판 차(개월)', pick(gens, (g) => (g.sales.length ? g.sales.length : null)));
  { // 한 달 최고 판매
    let best: { g: Generation; v: number; m: number } | null = null;
    for (const g of [...gens].sort((a, b) => a.id - b.id)) g.sales.forEach((v, i) => { if (v > 0 && (!best || v > best.v)) best = { g, v, m: g.launchMonth + i }; });
    const b = best as { g: Generation; v: number; m: number } | null;
    if (b) add(cars, 'month', '한 달에 가장 많이 팔린 기록', b, b.m);
  }
  add(cars, 'grade', '가장 높은 등급으로 출시한 차', pick(gens, (g) => avgGrade(g.editions[0].stats, yearOf(g.launchWeek))));
  add(shame, 'worstReview', '평론이 가장 낮은 차', pick(gens, (g) => g.reviewAvg, true));
  add(shame, 'loss', '가장 큰 손실을 낸 차(개발비 뺀 이익)', pick(gens, (g) => { const p = pnl.get(g.id); return p && p.net < 0 ? p.net : null; }, true));

  // 회사 기록: 해마다 기록(연 기록 + 장부), 평판은 해마다 변화로 거꾸로 셈한 연말 값과 지금 값 중 최고
  const company: HallRow[] = [], years = new Map<number, { rev: number; profit: number }>();
  for (const [y, log] of Object.entries(s.years ?? {})) if (log.months > 0) years.set(Number(y), { rev: log.revenue, profit: log.profit });
  for (const e of s.ledger) if (!s.years?.[e.year]) { const t = years.get(e.year) ?? { rev: 0, profit: 0 }; t.rev += e.revenue; t.profit += e.profit; years.set(e.year, t); }
  const yb = (k: 'rev' | 'profit') => { let b: { y: number; v: number } | null = null; for (const [y, t] of [...years].sort((a, c) => a[0] - c[0])) if (!b || t[k] > b.v) b = { y, v: t[k] }; return b; };
  const rv = yb('rev'), pf = yb('profit');
  if (rv && rv.v > 0) company.push({ key: 'yearRev', label: '최고 연 매출', value: rv.v, year: rv.y });
  if (pf) company.push({ key: 'yearProfit', label: '최고 연 이익', value: pf.v, year: pf.y });
  { let rep = s.reputation, best = rep, by = yearOf(s.week);
    const ys = Object.keys(s.years ?? {}).map(Number).sort((a, b) => b - a);
    for (const y of ys) { const d = Object.values(s.years![y].rep).reduce((a, x) => a + x, 0); if (y === yearOf(s.week)) { rep -= d; continue; } if (rep > best) { best = rep; by = y; } rep -= d; } // rep: y년 말 평판
    company.push({ key: 'rep', label: '최고 평판(연말 기준)', value: best, year: by });
  }
  const sold = gens.reduce((a, g) => a + g.totalSold, 0);
  company.push({ key: 'totalSold', label: '누적 판매', value: sold });
  company.push({ key: 'names', label: '낸 차종', value: s.nameplates.filter((n) => n.generations.length).length });
  { let b: { name: string; w: number } | null = null;
    for (const x of [...s.staff].sort((a, c) => a.id - c.id)) { const w = x.hist?.join ?? x.hist?.since; if (w !== null && w !== undefined && (!b || w < b.w)) b = { name: x.name, w }; }
    if (b) company.push({ key: 'staff', label: '가장 오래 근무한 직원', value: Math.floor((s.week - b.w) / config.time.weeksPerMonth), text: b.name });
  }
  if (s.motor?.history.length) { // 5.6.0 모터스포츠 통산 우승·최고 순위
    const H = s.motor.history, wins = H.filter((h) => h.rank === 1), first = wins[0] ?? [...H].sort((a, b) => a.rank - b.rank || a.year - b.year)[0];
    const name = (id: string) => config.motorsport.series.find((x) => x.id === id)?.name ?? id;
    company.push({ key: 'motorWins', label: '모터스포츠 통산 우승', value: wins.length, text: config.motorsport.series.map((x) => `${x.name} ${H.filter((h) => h.series === x.id && h.rank === 1).length}회`).join(' · ') });
    company.push({ key: 'motorBest', label: wins.length ? '모터스포츠 첫 우승' : '모터스포츠 최고 순위', value: first.rank, year: first.year, text: name(first.series) });
  }
  return { cars, shame, company, empty: !gens.length };
}
