// 4.0.0 세계 시장 1부(설계서 7.5): 해외 권역 진출(수출 → 판매 법인), 권역별 가격·평판·인지도, 국내 공장 생산 한도 나눠 쓰기, 자동 수출.
// 수요는 국내 공식(market.ts monthlyDemand)에 권역 매개변수를 넣어 셈한다. 수치는 config.world, 권역 자료는 data/regions.json(게임용 가정)
import { config } from '../config';
import { REGIONS, RIVALS, optionById, powertrainById, regionById } from '../data';
import { unitCost } from './cars';
import { costMultOf, repEffect } from './company';
import { genCostMult } from './derive';
import { equipOf, optPerCar } from './equip';
import { addNews, eraNow, eraTimeline, marketMult, regulationsNow } from './events';
import { josa } from './josa';
import { carBasePrice, cellMonthly, cellNorm, currentEdition, interp, monthlyDemand, regionRivalPull, rivalBase, rivalCellA, toSaleCar, type SaleCar } from './market';
import { diffOf } from './difficulty';
import { ptCostAdd } from './research';
import { monthOf, monthTime } from './time';
import { won } from './won';
import { delegationOn, execSkill } from './execs';
import { hash01 } from './rng';
import { motorAw } from './motor';
import type { CarState, Command, CommandResult, GameEvent, GenWorld, Generation, LedgerWorld, LocalPlant, PendingChoice, TradeMod, WorldRegion } from './types';

const W = config.world;
const fail = (reason: string): CommandResult => ({ ok: false, reason });
const OK: CommandResult = { ok: true };
const gensOf = (s: CarState): Generation[] => s.nameplates.flatMap((n) => n.generations).sort((a, b) => a.id - b.id);
const nameOf = (s: CarState, g: Generation): string => s.nameplates.find((n) => n.generations.includes(g))?.name ?? '';

export const regionOf = (s: CarState, id: string): WorldRegion | undefined => s.world?.regions.find((r) => r.id === id);
/** 진출한 권역(진출 순) */
export const openRegions = (s: CarState): WorldRegion[] => s.world?.regions ?? [];

/** 대당 원가(국내 월 결산과 같은 셈): 원가 + 선택 사양 원가, 선택 사양 매출 */
export function genUnit(s: CarState, g: Generation, year: number): { uc: number; opRev: number } {
  const ed = currentEdition(g), op = optPerCar(equipOf(ed), g.body, g.segment, year, costMultOf(s));
  return { uc: unitCost(g.body, g.powertrain, ed.tier, ed.options, genCostMult(s, g), ptCostAdd(s, g.powertrain, ed.battery, g.evPlatform)) + op.cost, opRev: op.rev };
}
/** 관세율(대당 원가에 곱한다). t: 소수 연도 */
export const tariffRate = (rid: string, body: string, t: number): number => { const R = regionById(rid); return R.tariffBody[body] ?? interp(R.years, R.tariff, t); };
/** 관세 + 운송비(대당, 4.0.0 자료값만) */
export const landedCost = (rid: string, body: string, uc: number, t: number): number => uc * tariffRate(rid, body, t) + regionById(rid).ship;
// ---------- 5.5.0 무역 사건·현지 공장 ----------
const P = W.plant, T = W.trade;
const modsOf = (s: CarState, rid: string, m: number, kind: TradeMod['kind']): TradeMod[] => (s.world?.trade ?? []).filter((x) => x.region === rid && x.kind === kind && m < x.until);
/** 현지 공장 등급(0 = 없음, 공사 중인 첫 등급도 0) */
export const plantLevel = (r?: WorldRegion): number => r?.plant?.level ?? 0;
/** 5.5.0 지금 관세율: 자료값 × 무역 협정(발효 뒤) × 관세 인하 + 관세 인상(현지 공장이 있으면 인상은 없다) */
export function tariffNow(s: CarState, rid: string, body: string, m: number): number {
  let t = tariffRate(rid, body, monthTime(m));
  for (const d of s.world?.deals ?? []) if (d.region === rid && m >= d.at) t *= 1 - d.cut;
  for (const x of modsOf(s, rid, m, 'tariffDown')) t *= x.value;
  if (!plantLevel(regionOf(s, rid))) for (const x of modsOf(s, rid, m, 'tariffUp')) t += x.value;
  return t;
}
/** 관세 + 운송비(대당, 무역 사건 반영) */
export const landedNow = (s: CarState, rid: string, body: string, uc: number, m: number): number => uc * tariffNow(s, rid, body, m) + regionById(rid).ship;
/** 환율: 그 권역 판매가로 받는 돈의 배수 */
export const fxNow = (s: CarState, rid: string, m: number): number => [...modsOf(s, rid, m, 'fxUp'), ...modsOf(s, rid, m, 'fxDown')].reduce((a, x) => a * x.value, 1);
/** 수입 규제: 판매 상한 배수(현지 공장이 있으면 1) */
export const quotaNow = (s: CarState, rid: string, m: number): number => (plantLevel(regionOf(s, rid)) ? 1 : modsOf(s, rid, m, 'quota').reduce((a, x) => a * x.value, 1));
/** 현지 공장 등급 lv의 월 생산·건설비·월 유지비·공사 개월 */
export const plantCapOf = (lv: number): number => (lv > 0 ? P.levels[lv - 1].capacity : 0);
export const plantCost = (rid: string, lv: number): number => Math.round(P.levels[lv - 1].cost * regionById(rid).plantMult);
export const plantUpkeep = (rid: string, lv: number): number => (lv > 0 ? Math.round(P.levels[lv - 1].upkeep * regionById(rid).plantMult) : 0);
export function plantError(s: CarState, rid: string): string | null {
  const r = regionOf(s, rid);
  if (!r) return '먼저 그 권역에 진출해야 합니다.';
  if (r.office < P.office) return `현지 공장은 판매 법인 ${P.office}등급부터 지을 수 있습니다(지금 ${r.office}등급).`;
  if (r.plant?.build) return `현지 공장 ${r.plant.build.level}등급 공사 중입니다.`;
  const lv = plantLevel(r) + 1;
  if (lv > P.levels.length) return '현지 공장이 이미 가장 높은 등급입니다.';
  const c = plantCost(rid, lv);
  if (s.cash < c) return `건설비 ${won(c)}${josa(won(c), '이/가')} 모자랍니다.`;
  return null;
}
/** 현지 생산 차종을 자동으로 고르는가(정하지 않았거나 생산 임원 배분·해외 담당 위임이 켜져 있으면) */
export const plantAuto = (s: CarState, p: LocalPlant): boolean => !p.cars || delegationOn(s, 'production', 'autoAlloc') || delegationOn(s, 'world', 'autoWorld');
/** 권역 기준가 = 차별 기준가 × 권역 가격 수준 */
export const regionBase = (s: CarState, g: Generation, rid: string): number => carBasePrice(s, toSaleCar(g, monthOf(s.week))) * regionById(rid).priceMult;
/** 권역 한 달 시장 규모(모든 차체, 시대 사건 반영) */
export function regionMarket(s: CarState, rid: string, m: number): number {
  const t = monthTime(m), n = eraNow(s.seed, m), mm = marketMult(n, rid);
  return Object.keys(regionById(rid).bodyShare).reduce((a, b) => a + cellMonthly(b, t, rid) * (n.body[b] ?? 1) * mm, 0);
}
/** 판매 상한(대/월) */
export const regionCap = (s: CarState, r: WorldRegion, m: number): number => W.capShare[r.office] * regionMarket(s, r.id, m) * quotaNow(s, r.id, m); // 5.5.0 수입 규제

/** 수출 호황 같은 사건의 진출비 배수 */
function easeMult(seed: number, m: number): number {
  let k = 1;
  for (const sp of eraTimeline(seed)) if (m >= sp.start && (sp.end === null || m < sp.end)) for (const e of sp.def.effects) if (e.type === 'exportEase') k *= e.mult;
  return k;
}
export const entryCost = (s: CarState, rid: string): number => Math.round(regionById(rid).entry * easeMult(s.seed, monthOf(s.week)));
/** 판매 법인 다음 등급(1~3)의 투자비·월 유지비 */
export const officeCost = (rid: string, level: number): number => Math.round(W.office.cost[level - 1] * regionById(rid).officeMult);
export const officeUpkeep = (rid: string, level: number): number => (level > 0 ? Math.round(W.office.upkeep[level - 1] * regionById(rid).officeMult) : 0);

export function openError(s: CarState, rid: string): string | null {
  const R = REGIONS.find((x) => x.id === rid);
  if (!R) return '없는 권역입니다.';
  if (regionOf(s, rid)) return `이미 ${R.name}에 진출했습니다.`;
  if (s.hqLevel < W.hqLevel) return `본사 ${W.hqLevel}등급이 되어야 해외에 진출할 수 있습니다(지금 ${s.hqLevel}등급).`;
  if (s.reputation < R.rep) return `${R.name} 진출에는 평판 ${R.rep} 이상이 필요합니다(지금 ${Math.floor(s.reputation)}).`;
  const c = entryCost(s, rid);
  if (s.cash < c) return `진출비 ${won(c)}${josa(won(c), '이/가')} 모자랍니다.`;
  return null;
}
export function officeError(s: CarState, rid: string): string | null {
  const r = regionOf(s, rid);
  if (!r) return '먼저 그 권역에 진출해야 합니다.';
  if (r.office >= W.office.cost.length) return '판매 법인이 이미 가장 높은 등급입니다.';
  const c = officeCost(rid, r.office + 1);
  if (s.cash < c) return `투자비 ${won(c)}${josa(won(c), '이/가')} 모자랍니다.`;
  return null;
}

/** 권역 규제(국내 의무 장비가 regLead년 먼저 + 그 권역만의 규제): 이 차를 그 권역에서 팔 수 없는 이유(없으면 null) */
export function regionBlock(s: CarState, g: Generation, rid: string, m = monthOf(s.week)): string | null {
  const R = regionById(rid), ed = currentEdition(g), opts = new Set(ed.options);
  const own = eraTimeline(s.seed).flatMap((sp) => sp.def.effects.flatMap((e) => (e.type === 'regulation' && e.region === rid && m >= sp.start + e.graceMonths ? [{ name: sp.def.name, rule: e }] : [])));
  for (const { name, rule } of [...regulationsNow(s.seed, m + R.regLead * config.time.monthsPerYear), ...own]) {
    const miss = (rule.options ?? []).filter((o) => !opts.has(o));
    if (miss.length) { const list = miss.map((o) => optionById(o).name).join('·'); return `${R.name}의 ${name}: ${list}${josa(list, '이/가')} 없는 차는 팔 수 없습니다.`; }
    if (rule.powertrains?.includes(g.powertrain)) return `${R.name}의 ${name}: ${powertrainById(g.powertrain).name}차는 팔 수 없습니다.`;
  }
  return null;
}

const gw = (g: Generation, rid: string): GenWorld | undefined => g.world?.[rid];
/** 권역 판매가: 수동 가격, 없으면 자동 가격(없으면 권역 기준가) */
export const regionPrice = (s: CarState, g: Generation, rid: string): number => gw(g, rid)?.price ?? gw(g, rid)?.ap ?? Math.round(regionBase(s, g, rid) / 10) * 10;
/** 권역 판매 계산용 차(권역 가격, 인지도 = 차 인지도 × 권역 브랜드 인지도) */
export const regionCar = (s: CarState, g: Generation, r: WorldRegion, m: number, price = regionPrice(s, g, r.id)): SaleCar => ({ ...toSaleCar(g, m), price, awareness: g.awareness * r.aw });
/** 그 권역에 지금 팔 수 있는 수출 차(판매 중, 목록에 있음, 규제 통과) */
const exportedIn = (s: CarState, gens: Generation[], rid: string, m: number): Generation[] => gens.filter((g) => g.status !== 'discontinued' && gw(g, rid)?.on && !regionBlock(s, g, rid, m));

/** 한 차의 권역 월 수요(생산·판매 상한 전). others: 그 권역의 내 다른 수출 차 */
export const regionDemandOf = (s: CarState, car: SaleCar, others: SaleCar[], m: number, rid: string): number => monthlyDemand(s, car, others, monthTime(m), { region: rid });

/** 자동 권역 가격: 권역 기준가 × pricePcts 중 이번 달 이익(판매 상한 안)이 가장 큰 값 */
export function autoRegionPrice(s: CarState, g: Generation, r: WorldRegion, m: number, others: SaleCar[], year: number): number {
  const base = regionBase(s, g, r.id), { uc, opRev } = genUnit(s, g, year), land = landedNow(s, r.id, g.body, uc, m), cap = regionCap(s, r, m), fx = fxNow(s, r.id, m);
  let best = Math.round(base / 10) * 10, bestP = -Infinity;
  for (const k of W.pricePcts) {
    const price = Math.round((base * k) / 10) * 10, d = Math.min(cap, regionDemandOf(s, regionCar(s, g, r, m, price), others, m, r.id)), p = d * (price * fx + opRev - uc - land);
    if (p > bestP + 1e-9) { bestP = p; best = price; }
  }
  return best;
}

/** 월 결산 직전(판매 계산 전): 자동 가격 갱신과 자동 수출 넣기. ID 순 */
export function worldPrep(s: CarState, ev: GameEvent[], gens: Generation[], m: number, year: number): void {
  for (const r of openRegions(s)) {
    const sale = (list: Generation[]) => list.map((x) => regionCar(s, x, r, m));
    if (r.auto) for (const g of gens) {
      if (g.status !== 'onSale' || gw(g, r.id)?.on || gw(g, r.id)?.no || regionBlock(s, g, r.id, m)) continue;
      const others = exportedIn(s, gens, r.id, m), price = autoRegionPrice(s, g, r, m, sale(others), year), { uc, opRev } = genUnit(s, g, year);
      const d = regionDemandOf(s, regionCar(s, g, r, m, price), sale(others), m, r.id);
      if (d >= W.autoMinSales && price * fxNow(s, r.id, m) + opRev - uc - (plantLevel(r) ? uc * (P.costMult - 1) : landedNow(s, r.id, g.body, uc, m)) > 0) { // 5.5.0 현지 공장이 있으면 관세·운송비 없이 본다
        const w = ((g.world ??= {})[r.id] ??= { on: true, sold: 0, demand: 0, total: 0, rev: 0, profit: 0 });
        w.on = true; w.ap = price; w.apAt = m; w.apEd = g.editions.length;
        addNews(s, ev, `자동 수출: 「${nameOf(s, g)}」${josa(nameOf(s, g), '을/를')} ${regionById(r.id).name} 수출 목록에 넣었습니다(권역 가격 ${won(price)}, 예상 월 ${Math.round(d).toLocaleString()}대).`, 'world', 'news', g.id, 'world');
      }
    }
    for (const g of exportedIn(s, gens, r.id, m)) {
      const w = gw(g, r.id)!;
      if (w.price !== undefined) continue;
      if (w.ap === undefined || w.apAt === undefined || m - w.apAt >= W.repriceMonths || w.apEd !== g.editions.length) {
        w.ap = autoRegionPrice(s, g, r, m, sale(exportedIn(s, gens, r.id, m).filter((x) => x !== g)), year); w.apAt = m; w.apEd = g.editions.length;
      }
    }
  }
}

/** 권역별 이번 달 수요 한 줄 */
export interface WorldRow { rid: string; d: number; price: number; unit: number; land: number; tr: number; n: number; loc: number; lx: number } // unit: 수출 대당 이익(판매가 × 환율 + 선택 사양 매출 − 원가 − 관세 − 운송비), land: 관세 + 운송비, tr: 그중 관세, d: 권역 주문(판매 상한 안), loc(5.5.0): 그중 현지 공장이 만든 대수(국내 공장 한도를 쓰지 않는다), n: 국내 공장이 만들어 수출한 대수
/** 판매 계산: 세대마다 권역별 수요(판매 상한으로 깎음). mult: 세대별 생산 쪽 배수(출시 달 주 수·페이스리프트 전환·단종 달) */
export function worldDemand(s: CarState, gens: Generation[], m: number, year: number, mult: number[]): WorldRow[][] {
  const rows: WorldRow[][] = gens.map(() => []);
  for (const r of openRegions(s)) {
    const list = exportedIn(s, gens, r.id, m), cars = list.map((g) => regionCar(s, g, r, m)), out: { i: number; row: WorldRow }[] = [], fx = fxNow(s, r.id, m);
    list.forEach((g, k) => {
      const i = gens.indexOf(g); if (i < 0) return;
      const { uc, opRev } = genUnit(s, g, year), tr = uc * tariffNow(s, r.id, g.body, m), land = tr + regionById(r.id).ship, price = cars[k].price;
      out.push({ i, row: { rid: r.id, d: regionDemandOf(s, cars[k], cars.filter((_, j) => j !== k), m, r.id) * mult[i], price, unit: price * fx + opRev - uc - land, land, tr, n: 0, loc: 0, lx: uc * (P.costMult - 1) } }); // lx: 현지 생산 대당 원가 가산
    });
    const tot = out.reduce((a, x) => a + x.row.d, 0), cap = regionCap(s, r, m), k = tot > cap ? cap / tot : 1;
    for (const x of out) { x.row.d *= k; rows[x.i].push(x.row); }
    const pl = r.plant, pc = plantCapOf(plantLevel(r));
    if (pl && pc > 0) { // 5.5.0 현지 공장: 관세·운송비가 큰 차부터 채운다(현지 생산 차종을 정했으면 그 차만)
      const allow = plantAuto(s, pl) ? null : new Set(pl.cars);
      let left = pc;
      for (const x of out.filter((y) => !allow || allow.has(gens[y.i].id)).sort((a, b) => b.row.land - b.row.lx - (a.row.land - a.row.lx) || gens[a.i].id - gens[b.i].id)) { const n = Math.min(left, Math.round(x.row.d)); x.row.loc = n; left -= n; }
    }
  }
  return rows;
}
/** 생산 배분(세대 안): 만든 대수를 국내·권역에 나눈다. 기본은 대당 이익이 큰 곳부터, domFirst면 국내 먼저. 국내 몫을 돌려주고 rows[].n을 채운다 */
export function splitMade(made: number, domDemand: number, domUnit: number, rows: WorldRow[], domFirst: boolean): number {
  const ch = [{ d: domDemand, u: domUnit, row: null as WorldRow | null }, ...rows.map((row) => ({ d: Math.max(0, row.d - row.loc), u: row.unit, row }))]; // 5.5.0 현지 공장 몫은 빼고
  const order = ch.map((c, i) => ({ c, i })).sort((a, b) => (domFirst ? (a.i === 0 ? -1 : b.i === 0 ? 1 : 0) : 0) || b.c.u - a.c.u || a.i - b.i);
  let left = made, dom = 0;
  for (const { c } of order) { const n = Math.min(left, Math.round(c.d)); left -= n; if (c.row) c.row.n = n; else dom = n; }
  return dom + Math.max(0, left); // 반올림 나머지는 국내로
}

/** 세대 하나의 수출 정산(월 결산 차 줄 안에서). 돌려주는 값을 국내 합계에 더한다 */
export type RegionSum = { sold: number; revenue: number; cogs: number; landed: number; tariff: number; ship: number; loc?: number; saved?: number }; // loc·saved(5.5.0): 현지 공장이 만든 대수, 아낀 관세·운송비
export function settleGen(g: Generation, rows: WorldRow[], uc: number): RegionSum & { by: Record<string, RegionSum> } {
  const out = { sold: 0, revenue: 0, cogs: 0, landed: 0, tariff: 0, ship: 0, by: {} as Record<string, RegionSum> };
  for (const row of rows) {
    const k = row.n + row.loc, w = g.world![row.rid], rev = k * (row.unit + uc + row.land), cg = k * uc + row.loc * row.lx, ld = row.n * row.land; // unit = 판매가 × 환율 + 선택 사양 매출 − 원가 − (관세 + 운송비). 현지 공장 몫은 관세·운송비가 없다
    w.sold = k; w.demand = row.d; w.total += k; w.rev += rev; w.profit += rev - cg - ld; if (row.loc) w.loc = row.loc; else delete w.loc;
    out.sold += k; out.revenue += rev; out.cogs += cg; out.landed += ld; out.tariff += row.n * row.tr; out.ship += ld - row.n * row.tr;
    out.by[row.rid] = { sold: k, revenue: rev, cogs: cg, landed: ld, tariff: row.n * row.tr, ship: ld - row.n * row.tr, ...(row.loc ? { loc: row.loc, saved: row.loc * (row.unit + row.land - row.lx) } : {}) }; // saved: 현지 생산 차의 이익(판매가 − 원가 − 현지 원가 가산)
  }
  for (const [rid, w] of Object.entries(g.world ?? {})) if (!rows.some((x) => x.rid === rid)) { w.sold = 0; w.demand = 0; delete w.loc; } // 이번 달 수출하지 않은 권역
  return out;
}

/** 월 결산 끝: 권역 합계·점유, 판매 법인 유지비, 인지도·평판, 자동 수출 빼기. 장부 칸을 돌려준다 */
export function worldSettle(s: CarState, ev: GameEvent[], gens: Generation[], m: number, by: Record<string, RegionSum>): { ledger: Record<string, LedgerWorld>; tariff: number; ship: number; upkeep: number } {
  const ledger: Record<string, LedgerWorld> = {};
  let tariff = 0, ship = 0, upkeep = 0;
  const xs = s.execs?.seats.world, xr = xs ? W.exec.awRate * execSkill('world', xs.staff) / 100 : 0; // 5.5.0 해외 담당 임원
  for (const r of openRegions(s)) {
    const b = by[r.id] ?? { sold: 0, revenue: 0, cogs: 0, landed: 0, tariff: 0, ship: 0 }, pl = r.plant, lv = plantLevel(r), pu = plantUpkeep(r.id, lv), up = officeUpkeep(r.id, r.office) + pu, profit = b.revenue - b.cogs - b.landed - up;
    ledger[r.id] = { sold: b.sold, revenue: b.revenue, cogs: b.cogs, tariff: b.tariff, ship: b.ship, upkeep: up, profit };
    tariff += b.tariff; ship += b.ship; upkeep += up;
    const size = regionMarket(s, r.id, m);
    r.sold = b.sold; r.rev = b.revenue; r.profit = profit; r.share = size > 0 ? b.sold / size : 0; r.total += b.sold; r.totalProfit += profit; r.tariff = b.tariff; r.ship = b.ship;
    if (pl) { pl.made = b.loc ?? 0; pl.total += pl.made; if (lv) pl.saved += (b.saved ?? 0) - pu; } // 5.5.0 현지 공장 누적 손익 = 현지 생산 차의 이익 − 공장 유지비(건설비는 착공 때 뺐다)
    r.rep += Math.min(W.repYearMax, (b.sold * config.time.monthsPerYear) / W.repSoldDiv) / config.time.monthsPerYear * (1 + P.rep * lv);
    const target = Math.min(1, Math.max(0, W.awBase + repEffect(r.rep) / W.awRepDiv + W.office.aw[r.office] + P.aw * lv + (s.motor ? motorAw(s, m) : 0))); // 5.6.0 세계 랠리·내구 보상
    r.aw += (target - r.aw) * (W.awRate + W.office.rate[r.office] + P.rate * lv + xr);
    if (pl?.build && m + 1 >= pl.build.doneMonth) { // 5.5.0 현지 공장 공사가 끝나면 다음 달부터 새 등급
      pl.level = pl.build.level; pl.build = null; pl.since ??= m + 1;
      addNews(s, ev, `${regionById(r.id).name} 현지 공장 ${pl.level}등급 완공. 한 달 ${plantCapOf(pl.level).toLocaleString()}대를 현지에서 만들고, 그 차는 관세·운송비가 없습니다. 월 유지비 ${won(plantUpkeep(r.id, pl.level))}.`, 'world', 'news', undefined, 'world');
    }
    if (r.auto) for (const g of gens) { // 자동 수출: 단종된 차·연속 적자인 차를 뺀다
      const w = gw(g, r.id);
      if (!w?.on) continue;
      const ended = g.status !== 'onSale', loss = lossStreak(g, r.id) >= W.autoLossMonths;
      if (ended || loss) {
        w.on = false; if (loss) { w.no = true; w.nl = true; } // nl(5.5.0): 적자로 뺀 차(무역 사건이 끝나면 다시 본다)
        if (loss) addNews(s, ev, `자동 수출: 「${nameOf(s, g)}」${josa(nameOf(s, g), '을/를')} ${regionById(r.id).name} 수출 목록에서 뺐습니다(${W.autoLossMonths}개월 연속 적자).`, 'world', 'news', g.id, 'world');
      }
    }
  }
  return { ledger, tariff, ship, upkeep };
}
const lossStreak = (g: Generation, rid: string): number => g.world![rid].ls ?? 0;
/** 이번 달 대당 이익이 음수였는가를 세대 기록에 센다(settleGen 뒤 game.ts가 부른다) */
export function noteLoss(g: Generation, rows: WorldRow[]): void { // 5.5.0 현지 공장 몫(관세·운송비 없음)까지 합한 이익으로 센다
  for (const row of rows) { const w = g.world![row.rid]; if (row.n + row.loc > 0 && row.n * row.unit + row.loc * (row.unit + row.land - row.lx) < 0) w.ls = (w.ls ?? 0) + 1; else delete w.ls; }
}

// ---------- 명령 ----------
export interface WorldCtx { s: CarState; spend: (cost: number) => void }
export function worldCommand(c: WorldCtx, cmd: Command, ev: GameEvent[]): CommandResult | null {
  const s = c.s, m = monthOf(s.week);
  const gen = (id: number) => gensOf(s).find((g) => g.id === id);
  switch (cmd.type) {
    case 'openRegion': {
      const err = openError(s, cmd.region); if (err) return fail(err);
      const R = regionById(cmd.region), cost = entryCost(s, cmd.region);
      c.spend(cost); s.pendingWorldInv = (s.pendingWorldInv ?? 0) + cost;
      (s.world ??= { regions: [] }).regions.push({ id: R.id, since: m, aw: W.awStart, rep: s.reputation * W.repCarry, office: 0, auto: true, sold: 0, rev: 0, profit: 0, share: 0, total: 0, totalProfit: 0, tariff: 0, ship: 0 });
      addNews(s, ev, `${s.companyName}, ${R.name} 진출. 진출비 ${won(cost)}. 국내 공장에서 만들어 수출하며 자동 수출이 켜져 있습니다(다음 월 결산부터).`, 'world', 'news', undefined, 'world');
      return { ok: true, events: ev };
    }
    case 'investOffice': {
      const err = officeError(s, cmd.region); if (err) return fail(err);
      const r = regionOf(s, cmd.region)!, cost = officeCost(r.id, r.office + 1);
      c.spend(cost); s.pendingWorldInv = (s.pendingWorldInv ?? 0) + cost; r.office++;
      addNews(s, ev, `${regionById(r.id).name} 판매 법인 ${r.office}등급. 투자비 ${won(cost)}, 월 유지비 ${won(officeUpkeep(r.id, r.office))}. 판매 상한이 그 권역 시장의 ${Math.round(W.capShare[r.office] * 100)}%로 늘었습니다.`, 'world', 'news', undefined, 'world');
      return { ok: true, events: ev };
    }
    case 'setRegionAuto': {
      const r = regionOf(s, cmd.region); if (!r) return fail('진출하지 않은 권역입니다.');
      r.auto = cmd.on;
      if (cmd.on) for (const g of gensOf(s)) if (g.world?.[r.id]?.no) delete g.world[r.id].no; // 다시 켜면 예전에 뺀 차도 다시 본다
      return OK;
    }
    case 'buildPlant': { // 5.5.0 현지 공장 다음 등급
      const err = plantError(s, cmd.region); if (err) return fail(err);
      const r = regionOf(s, cmd.region)!, lv = plantLevel(r) + 1, cost = plantCost(r.id, lv);
      c.spend(cost); s.pendingWorldInv = (s.pendingWorldInv ?? 0) + cost;
      const pl = (r.plant ??= { level: 0, build: null, made: 0, saved: 0, total: 0 });
      pl.build = { level: lv, doneMonth: m + P.levels[lv - 1].months }; pl.saved -= cost;
      addNews(s, ev, `${regionById(r.id).name} 현지 공장 ${lv}등급 착공. 건설비 ${won(cost)}, ${P.levels[lv - 1].months}개월 뒤 완공되면 한 달 ${plantCapOf(lv).toLocaleString()}대를 현지에서 만듭니다.`, 'world', 'news', undefined, 'world');
      return { ok: true, events: ev };
    }
    case 'setPlantCars': {
      const r = regionOf(s, cmd.region); if (!r?.plant) return fail('그 권역에 현지 공장이 없습니다.');
      if (cmd.cars === null) { delete r.plant.cars; return OK; }
      if (!Array.isArray(cmd.cars) || cmd.cars.some((id) => !gen(id))) return fail('없는 차가 있습니다.');
      r.plant.cars = [...new Set(cmd.cars)].sort((a, b) => a - b);
      return OK;
    }
    case 'setExport': case 'setRegionPrice': case 'setDomFirst': {
      const g = gen(cmd.generationId); if (!g || g.status === 'discontinued') return fail('판매 중인 차가 아닙니다.');
      if (cmd.type === 'setDomFirst') { if (cmd.on) g.domFirst = true; else delete g.domFirst; return OK; }
      const r = regionOf(s, cmd.region); if (!r) return fail('진출하지 않은 권역입니다.');
      const w = ((g.world ??= {})[r.id] ??= { on: false, sold: 0, demand: 0, total: 0, rev: 0, profit: 0 });
      if (cmd.type === 'setExport') {
        if (cmd.on) { const b = regionBlock(s, g, r.id, m); if (b) return fail(b); }
        w.on = cmd.on; delete w.nl; if (!cmd.on && r.auto) w.no = true; else delete w.no; // 자동 수출이 켜져 있어도 손으로 뺀 차는 다시 넣지 않는다
        return OK;
      }
      if (cmd.price === null) { delete w.price; return OK; }
      const base = regionBase(s, g, r.id);
      if (!(cmd.price >= base * config.price.min && cmd.price <= base * config.price.max)) return fail(`권역 가격은 권역 기준가의 ${Math.round(config.price.min * 100)}~${Math.round(config.price.max * 100)}% 안에서 정할 수 있습니다.`);
      w.price = Math.round(cmd.price / 10) * 10;
      return OK;
    }
    default: return null;
  }
}

// ---------- 5.5.0 무역 사건(달 첫 주, 시드 해시) ----------
const TRADE_NAME: Record<string, string> = { tariffUp: '관세 인상', tariffDown: '관세 인하', fxUp: '환율 변동', fxDown: '환율 변동', quota: '수입 규제', deal: '무역 협정' };
const pctOf = (x: number) => `${Math.round(x * 100)}%`;
/** 진출한 권역마다(ID 순) 무역 사건을 굴린다. 끝난 효과를 지우고 발효한 협정을 알린다 */
export function worldMonthStart(s: CarState, ev: GameEvent[], m: number): void {
  const w = s.world;
  if (!w?.regions.length) return;
  if (w.trade?.length) {
    for (const x of w.trade.filter((y) => m >= y.until)) for (const g of gensOf(s)) { const gw0 = g.world?.[x.region]; if (gw0?.nl) { delete gw0.no; delete gw0.nl; } } // 끝난 무역 사건 동안 적자로 뺀 차는 다시 자동 수출 대상
    w.trade = w.trade.filter((x) => m < x.until); if (!w.trade.length) delete w.trade;
  }
  for (const d of w.deals ?? []) if (d.at === m) addNews(s, ev, `[무역 협정] ${regionById(d.region).name}${josa(regionById(d.region).name, '과/와')}의 협정이 발효했습니다. 그 권역 관세가 영구히 ${pctOf(d.cut)} 내려갑니다.`, 'world', 'news', undefined, 'world');
  for (const r of [...w.regions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const ri = REGION_IDS.indexOf(r.id), R = regionById(r.id);
    if (m < (w.lastTrade?.[r.id] ?? -Infinity) || hash01(s.seed, 131, m, ri) >= T.perYear / config.time.monthsPerYear) continue;
    const tot = T.kinds.reduce((a, k) => a + k.w, 0);
    let x = hash01(s.seed, 132, m, ri) * tot, kd = T.kinds[T.kinds.length - 1];
    for (const k of T.kinds) { if (x < k.w) { kd = k; break; } x -= k.w; }
    const months = kd.min + Math.floor(hash01(s.seed, 133, m, ri) * (kd.max - kd.min + 1)), plant = plantLevel(r) > 0;
    if (kd.id === 'deal') {
      if ((w.deals ?? []).some((d) => d.region === r.id) || s.events.pending.some((p) => p.tr?.region === r.id)) continue; // 권역마다 협정은 한 번
      const save = Math.round((T.wait - T.fast) * r.tariff * kd.value), cost = Math.max(T.minLobby, Math.round((save * T.lobby) / 10) * 10);
      const text = `${R.name}${josa(R.name, '과/와')}의 무역 협정이 타결됐습니다. 발효되면 그 권역 관세가 영구히 ${pctOf(kd.value)} 내려갑니다. 그대로 두면 ${T.wait / config.time.monthsPerYear}년 뒤 발효됩니다.`;
      const results = [`로비 비용 ${won(cost)}${josa(won(cost), '을/를')} 냅니다. ${T.fast}개월 뒤 발효됩니다. 앞당겨 아끼는 관세는 지난달 관세 기준 약 ${won(save)}입니다.`, `돈은 들지 않습니다. ${T.wait / config.time.monthsPerYear}년 뒤 발효됩니다.`];
      const id = s.nextId++;
      s.events.pending.push({ id, eventId: 'tradeDeal', text, week: s.week, deadline: s.week + config.events.choiceWeeks, genId: null, fx: null, tr: { region: r.id, cost, save, results } });
      addNews(s, ev, `[무역 협정] ${text}`, 'choice', 'choice', id, 'world');
      (w.lastTrade ??= {})[r.id] = m + T.gap;
      continue;
    }
    if ((kd.id === 'tariffUp' || kd.id === 'quota') && plant) { // 현지 공장이 있으면 피해가 없다(뉴스만)
      addNews(s, ev, `[${TRADE_NAME[kd.id]}] ${R.name}${josa(R.name, '이/가')} 수입차 ${kd.id === 'quota' ? '판매를 제한했지만' : '관세를 올렸지만'} 우리 차는 현지 공장이 있어 영향을 받지 않습니다.`, 'world', 'news', undefined, 'world');
      (w.lastTrade ??= {})[r.id] = m + months + T.gap;
      continue;
    }
    (w.trade ??= []).push({ kind: kd.id, region: r.id, value: kd.value, until: m + months });
    (w.lastTrade ??= {})[r.id] = m + months + T.gap;
    const body = kd.id === 'tariffUp' ? `${R.name}${josa(R.name, '이/가')} 수입차 관세를 ${pctOf(kd.value)}p 올렸습니다(${months}개월). 현지 공장에서 만든 차는 관세가 없습니다.`
      : kd.id === 'tariffDown' ? `${R.name}${josa(R.name, '이/가')} 수입차 관세를 ${months}개월 동안 ${pctOf(1 - kd.value)} 내렸습니다.`
      : kd.id === 'quota' ? `${R.name}${josa(R.name, '이/가')} 수입차 판매를 제한합니다. ${months}개월 동안 그 권역 판매 상한이 ${pctOf(kd.value)}로 줄어듭니다. 현지 공장이 있으면 제한을 받지 않습니다.`
      : `${R.name} 통화가 ${kd.id === 'fxUp' ? '강해져' : '약해져'} ${months}개월 동안 그 권역에서 받는 판매 대금이 ${pctOf(Math.abs(kd.value - 1))} ${kd.id === 'fxUp' ? '늘어납니다' : '줄어듭니다'}.`;
    addNews(s, ev, `[${TRADE_NAME[kd.id]}] ${body}`, 'world', 'news', undefined, 'world');
  }
}
/** 무역 협정 결정의 효과(game.ts applyChoice가 부른다). lobby: 로비 비용을 내고 앞당겼는가(비용은 choiceMoney로 이미 냈다) */
export function applyTradeChoice(s: CarState, pc: PendingChoice, lobby: boolean): void {
  const x = pc.tr; if (!x || !s.world) return;
  const m = monthOf(s.week), kd = T.kinds.find((k) => k.id === 'deal')!;
  (s.world.deals ??= []).push({ region: x.region, at: m + (lobby ? T.fast : T.wait), cut: kd.value, lobby });
}
/** 자동 승인 '규칙대로'·해외 담당 위임의 무역 협정 답: 앞당겨 아끼는 관세가 로비 비용보다 크면 로비 */
export function tradeAuto(_s: CarState, pc: PendingChoice): { choice: number; why: string } | null {
  const x = pc.tr; if (!x) return null;
  return x.save > x.cost ? { choice: 0, why: `앞당겨 아끼는 관세(약 ${won(x.save)})가 로비 비용(${won(x.cost)})보다 커서 앞당겼습니다.` } : { choice: 1, why: `앞당겨 아끼는 관세(약 ${won(x.save)})가 로비 비용(${won(x.cost)})보다 작아 발효를 기다립니다.` };
}

// ---------- 화면용 조회 ----------
/** 권역 한 줄(세계 지도·목록) */
export interface RegionView {
  id: string; name: string; taste: string; open: boolean; since: number | null; aw: number; rep: number; office: number; auto: boolean;
  sold: number; rev: number; profit: number; share: number; total: number; totalProfit: number; tariff: number; ship: number;
  market: number; cap: number; capShare: number; entry: number; rule: string; error: string | null; officeNext: { level: number; cost: number; upkeep: number; capShare: number; error: string | null } | null; upkeep: number;
  tariffRate: number; shipCost: number; bodies: { body: string; share: number }[];
  plant: PlantView | null; trade: string[]; deal: string | null; // 5.5.0 현지 공장(판매 법인 2등급 전에는 null), 진행 중인 무역 사건, 무역 협정
}
/** 5.5.0 현지 공장 한 줄: level 지금 등급, build 공사 중인 등급·완공까지 개월, cap 월 생산, made 지난달, saved 누적 손익(아낀 관세·운송비 − 건설비 − 유지비), next 다음 등급 */
export interface PlantView { level: number; build: { level: number; monthsLeft: number } | null; cap: number; made: number; total: number; saved: number; upkeep: number; auto: boolean; cars: number[] | null;
  next: { level: number; cost: number; upkeep: number; capacity: number; months: number; error: string | null; save: number } | null }
/** 다음 등급 현지 공장의 월 이익 어림: 지난달 수출 차(관세·운송비가 큰 차부터 그 등급 생산 한도까지)의 관세·운송비 절감 − 현지 원가 가산,
 *  국내 공장이 주문을 다 못 만들고 있으면(못 판 주문이 있으면) 비는 국내 한도만큼 더 파는 이익(그 차들의 수출 대당 이익)도 더한다 */
export function plantSaveEstimate(s: CarState, rid: string, lv: number): number {
  const m = monthOf(s.week), y = Math.floor(monthTime(m)), gens = gensOf(s).filter((g) => g.status !== 'discontinued');
  const rows = gens.filter((g) => g.world?.[rid]?.on).map((g) => { const uc = genUnit(s, g, y).uc, land = landedNow(s, rid, g.body, uc, m); return { d: g.world![rid].sold, save: land - uc * (P.costMult - 1), unit: regionPrice(s, g, rid) * fxNow(s, rid, m) + genUnit(s, g, y).opRev - uc - land }; }).sort((a, b) => b.save - a.save);
  let left = plantCapOf(lv), v = 0, lost = gens.reduce((a, g) => a + g.lostSales, 0);
  for (const x of rows) { const n = Math.min(left, x.d); v += n * Math.max(0, x.save); const k = Math.min(n, lost); v += k * Math.max(0, x.unit); lost -= k; left -= n; }
  return Math.round(v);
}
function plantView(s: CarState, r: WorldRegion): PlantView | null {
  const pl = r.plant, lv = plantLevel(r), m = monthOf(s.week);
  if (!pl && r.office < P.office) return null;
  const nl = lv + 1;
  return { level: lv, build: pl?.build ? { level: pl.build.level, monthsLeft: pl.build.doneMonth - m } : null, cap: plantCapOf(lv), made: pl?.made ?? 0, total: pl?.total ?? 0, saved: pl?.saved ?? 0, upkeep: plantUpkeep(r.id, lv),
    auto: pl ? plantAuto(s, pl) : true, cars: pl?.cars ?? null,
    next: nl <= P.levels.length && !pl?.build ? { level: nl, cost: plantCost(r.id, nl), upkeep: plantUpkeep(r.id, nl), capacity: plantCapOf(nl), months: P.levels[nl - 1].months, error: plantError(s, r.id), save: plantSaveEstimate(s, r.id, nl) } : null };
}
/** 진행 중인 무역 사건 문장(그 권역) */
function tradeLines(s: CarState, rid: string, m: number): string[] {
  const left = (x: TradeMod) => `${x.until - m}개월 남음`, plant = plantLevel(regionOf(s, rid)) > 0;
  return (s.world?.trade ?? []).filter((x) => x.region === rid && m < x.until).map((x) => x.kind === 'tariffUp' ? `관세 인상 +${pctOf(x.value)}p(${left(x)})${plant ? ' · 현지 공장이 있어 받지 않음' : ''}`
    : x.kind === 'tariffDown' ? `관세 인하 −${pctOf(1 - x.value)}(${left(x)})` : x.kind === 'quota' ? `수입 규제: 판매 상한 ${pctOf(x.value)}(${left(x)})${plant ? ' · 현지 공장이 있어 받지 않음' : ''}`
    : `환율: 받는 판매 대금 ${x.value > 1 ? '+' : '−'}${pctOf(Math.abs(x.value - 1))}(${left(x)})`);
}
export function regionViews(s: CarState): RegionView[] {
  const m = monthOf(s.week), t = monthTime(m);
  return REGIONS.map((R) => {
    const r = regionOf(s, R.id), size = regionMarket(s, R.id, m), lv = r?.office ?? 0;
    const bodies = Object.keys(R.bodyShare).map((b) => ({ body: b, share: interp(R.years, R.bodyShare[b], t) })).filter((x) => x.share > 0).sort((a, b) => b.share - a.share || (a.body < b.body ? -1 : 1));
    return {
      id: R.id, name: R.name, taste: R.taste, open: !!r, since: r?.since ?? null, aw: r?.aw ?? 0, rep: r?.rep ?? s.reputation * W.repCarry, office: lv, auto: r?.auto ?? true,
      sold: r?.sold ?? 0, rev: r?.rev ?? 0, profit: r?.profit ?? 0, share: r?.share ?? 0, total: r?.total ?? 0, totalProfit: r?.totalProfit ?? 0, tariff: r?.tariff ?? 0, ship: r?.ship ?? 0,
      market: size, cap: W.capShare[lv] * size, capShare: W.capShare[lv], entry: entryCost(s, R.id), rule: `본사 ${W.hqLevel}등급, 평판 ${R.rep}`, error: r ? null : openError(s, R.id),
      officeNext: r && lv < W.office.cost.length ? { level: lv + 1, cost: officeCost(R.id, lv + 1), upkeep: officeUpkeep(R.id, lv + 1), capShare: W.capShare[lv + 1], error: officeError(s, R.id) } : null,
      upkeep: officeUpkeep(R.id, lv) + plantUpkeep(R.id, plantLevel(r)), tariffRate: r ? tariffNow(s, R.id, 'sedanM', m) : interp(R.years, R.tariff, t), shipCost: R.ship, bodies,
      plant: r ? plantView(s, r) : null, trade: tradeLines(s, R.id, m),
      deal: ((d) => (d ? (m >= d.at ? `무역 협정 발효(관세 −${pctOf(d.cut)})` : `무역 협정 ${d.at - m}개월 뒤 발효(관세 −${pctOf(d.cut)})`) : null))((s.world?.deals ?? []).find((d) => d.region === R.id)),
    };
  });
}
/** 권역의 차 한 줄(수출 목록) */
export interface RegionCarView { id: number; name: string; body: string; on: boolean; manual: boolean; price: number; base: number; sold: number; demand: number; total: number; profit: number; unit: number; tariff: number; ship: number; block: string | null; auto: boolean; dropped: boolean; loc: number; local: boolean } // loc·local(5.5.0): 지난달 현지 공장이 만든 대수, 현지 생산 차종인가
export function regionCars(s: CarState, rid: string): RegionCarView[] {
  const r = regionOf(s, rid), m = monthOf(s.week), y = Math.floor(monthTime(m));
  if (!r) return [];
  return gensOf(s).filter((g) => g.status === 'onSale' || g.world?.[rid]?.on).filter((g) => g.status !== 'discontinued').map((g) => {
    const w = gw(g, rid), price = regionPrice(s, g, rid), { uc, opRev } = genUnit(s, g, y), tr = uc * tariffNow(s, rid, g.body, m), pl = r.plant;
    return { id: g.id, name: nameOf(s, g), body: g.body, on: !!w?.on, manual: w?.price !== undefined, price, base: Math.round(regionBase(s, g, rid) / 10) * 10, sold: w?.sold ?? 0, demand: w?.demand ?? 0, total: w?.total ?? 0, profit: w?.profit ?? 0,
      unit: price * fxNow(s, rid, m) + opRev - uc - tr - regionById(rid).ship, tariff: tr, ship: regionById(rid).ship, block: regionBlock(s, g, rid, m), auto: r.auto, dropped: !!w?.no, loc: w?.loc ?? 0, local: !!pl && (plantAuto(s, pl) ? (w?.loc ?? 0) > 0 : !!pl.cars?.includes(g.id)) }; // local: 자동이면 지난달 현지에서 만든 차, 직접 고름이면 고른 차
  });
}
/** 권역 경쟁사 순위(대략 점유: 차급 규모 × 그 차급의 A^지수 몫, 고객층·사건은 무시). 내 회사·기타 현지 업체 포함 */
export interface RankRow { id: string; name: string; share: number; mine?: true; local?: true; maker?: true; sub?: true; color?: string; model?: string } // maker(5.5.0): 현지 경쟁사(model: 가장 강한 차급의 모델), sub: 내 자회사
/** 5.5.0 현지 업체 몫(local)을 현지 경쟁사와 나머지('기타')로 나눈 비율: 현지 경쟁사 j = share_j × (1 + 강약)^지수, 기타 = 1 − Σ share. 합은 1(권역 경쟁 합은 4.0.0과 같다) */
export function localSplit(rid: string, body: string): { id: string; f: number }[] {
  const mk = regionById(rid).makers ?? [], e = config.market.shareExp, w = mk.map((x) => ({ id: x.id, v: x.cells[body] === undefined ? 0 : x.share * Math.max(0, 1 + x.cells[body]) ** e }));
  const rest = Math.max(0, 1 - mk.reduce((a, x) => a + x.share, 0)), tot = w.reduce((a, x) => a + x.v, rest);
  return tot > 0 ? [...w.map((x) => ({ id: x.id, f: x.v / tot })), { id: 'local', f: rest / tot }] : [{ id: 'local', f: 1 }];
}
/** 현지 경쟁사의 가장 강한 차급과 모델 이름 */
export const makerTop = (rid: string, id: string): { body: string; model: string } | null => { const x = regionById(rid).makers?.find((y) => y.id === id); if (!x) return null; const b = Object.keys(x.cells).sort((a, c) => x.cells[c] - x.cells[a] || (a < c ? -1 : 1))[0]; return { body: b, model: x.models[b] }; };
/** 5.5.0 권역의 현지 경쟁사 소개(강한 차급 순 모델 3개) */
export const regionMakers = (rid: string) => (regionById(rid).makers ?? []).map((x) => ({ id: x.id, name: x.name, trait: x.trait, desc: x.desc, color: x.color,
  models: Object.keys(x.cells).sort((a, b) => x.cells[b] - x.cells[a] || (a < b ? -1 : 1)).slice(0, 3).map((b) => ({ body: b, name: x.models[b] })) }));
export function regionRanking(s: CarState, rid: string): RankRow[] {
  const R = regionById(rid), m = monthOf(s.week), t = monthTime(m), e = config.market.shareExp, size = regionMarket(s, rid, m);
  const r = regionOf(s, rid), mineShare = r?.share ?? 0, acc = new Map<string, number>();
  const subs = (s.subs ?? []).filter((x) => (x.abroad?.[rid]?.sold ?? 0) > 0).sort((a, b) => a.id - b.id), subShare = size > 0 ? subs.reduce((a, x) => a + x.abroad![rid].sold, 0) / size : 0;
  let local = 0;
  for (const body of Object.keys(R.bodyShare)) {
    const cell = cellMonthly(body, t, rid);
    if (cell <= 0) continue;
    const tot = regionRivalPull(s, rid, body, m), rm = diffOf(s).rivalMult, loc = R.local * (rivalBase(m) * rm) ** e, norm = cellNorm(s.rivals, s.seed, body, m);
    for (const x of s.rivals) if (x.models[body] && !s.rivalry?.out.includes(x.id)) {
      const a = rivalCellA(s.rivals, s.seed, x, body, m, norm) * (RIVALS.find((d) => d.id === x.id)?.regions[rid] ?? 1) * rm, share = tot > 0 ? a ** e / tot : 0;
      acc.set(x.id, (acc.get(x.id) ?? 0) + cell * share);
    }
    for (const x of localSplit(rid, body)) { const v = cell * (tot > 0 ? (loc * x.f) / tot : 0); if (x.id === 'local') local += v; else acc.set(`mk:${x.id}`, (acc.get(`mk:${x.id}`) ?? 0) + v); }
  }
  const scale = size > 0 ? Math.max(0, 1 - mineShare - subShare) / size : 0;
  const out: RankRow[] = s.rivals.filter((x) => acc.has(x.id)).map((x) => ({ id: x.id, name: x.name, share: (acc.get(x.id) ?? 0) * scale }));
  for (const x of R.makers ?? []) out.push({ id: x.id, name: x.name, share: (acc.get(`mk:${x.id}`) ?? 0) * scale, maker: true, color: x.color, model: makerTop(rid, x.id)?.model });
  out.push({ id: 'local', name: '기타 현지 업체', share: local * scale, local: true });
  for (const x of subs) out.push({ id: `sub:${x.id}`, name: x.name, share: x.abroad![rid].sold / size, sub: true, color: x.color });
  if (r) out.push({ id: 'mine', name: s.companyName, share: mineShare, mine: true });
  return out.sort((a, b) => b.share - a.share || (a.id < b.id ? -1 : 1));
}

/** 해외 합계(장부 몇 달 또는 연 기록): 해외 판매·매출·이익과 전체 매출 중 해외 비중 */
export function overseasShare(revenue: number, world?: Record<string, { revenue: number }>): number {
  const w = Object.values(world ?? {}).reduce((a, x) => a + x.revenue, 0);
  return revenue > 0 ? w / revenue : 0;
}
/** 세대의 권역별 판매 줄(차 상세) */
export function genWorldRows(s: CarState, g: Generation): { rid: string; name: string; on: boolean; sold: number; total: number; profit: number; price: number }[] {
  return openRegions(s).map((r) => { const w = gw(g, r.id); return { rid: r.id, name: regionById(r.id).name, on: !!w?.on, sold: w?.sold ?? 0, total: w?.total ?? 0, profit: w?.profit ?? 0, price: regionPrice(s, g, r.id) }; });
}
/** 지난달 실제로 만든 대수(국내 + 수출) */
export const madeLast = (g: Generation): number => (g.sales.at(-1) ?? 0) + Object.values(g.world ?? {}).reduce((a, w) => a + (w.on || w.sold ? w.sold : 0), 0);
export const regionName = (id: string): string => regionById(id).name;
export const REGION_IDS = REGIONS.map((r) => r.id);
