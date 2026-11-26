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
import type { CarState, Command, CommandResult, GameEvent, GenWorld, Generation, LedgerWorld, WorldRegion } from './types';

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
/** 관세 + 운송비(대당) */
export const landedCost = (rid: string, body: string, uc: number, t: number): number => uc * tariffRate(rid, body, t) + regionById(rid).ship;
/** 권역 기준가 = 차별 기준가 × 권역 가격 수준 */
export const regionBase = (s: CarState, g: Generation, rid: string): number => carBasePrice(s, toSaleCar(g, monthOf(s.week))) * regionById(rid).priceMult;
/** 권역 한 달 시장 규모(모든 차체, 시대 사건 반영) */
export function regionMarket(s: CarState, rid: string, m: number): number {
  const t = monthTime(m), n = eraNow(s.seed, m), mm = marketMult(n, rid);
  return Object.keys(regionById(rid).bodyShare).reduce((a, b) => a + cellMonthly(b, t, rid) * (n.body[b] ?? 1) * mm, 0);
}
/** 판매 상한(대/월) */
export const regionCap = (s: CarState, r: WorldRegion, m: number): number => W.capShare[r.office] * regionMarket(s, r.id, m);

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
  const base = regionBase(s, g, r.id), { uc, opRev } = genUnit(s, g, year), land = landedCost(r.id, g.body, uc, monthTime(m)), cap = regionCap(s, r, m);
  let best = Math.round(base / 10) * 10, bestP = -Infinity;
  for (const k of W.pricePcts) {
    const price = Math.round((base * k) / 10) * 10, d = Math.min(cap, regionDemandOf(s, regionCar(s, g, r, m, price), others, m, r.id)), p = d * (price + opRev - uc - land);
    if (p > bestP + 1e-9) { bestP = p; best = price; }
  }
  return best;
}

/** 월 결산 직전(판매 계산 전): 자동 가격 갱신과 자동 수출 넣기. ID 순 */
export function worldPrep(s: CarState, ev: GameEvent[], gens: Generation[], m: number, year: number): void {
  for (const r of openRegions(s)) {
    const t = monthTime(m), sale = (list: Generation[]) => list.map((x) => regionCar(s, x, r, m));
    if (r.auto) for (const g of gens) {
      if (g.status !== 'onSale' || gw(g, r.id)?.on || gw(g, r.id)?.no || regionBlock(s, g, r.id, m)) continue;
      const others = exportedIn(s, gens, r.id, m), price = autoRegionPrice(s, g, r, m, sale(others), year), { uc, opRev } = genUnit(s, g, year);
      const d = regionDemandOf(s, regionCar(s, g, r, m, price), sale(others), m, r.id);
      if (d >= W.autoMinSales && price + opRev - uc - landedCost(r.id, g.body, uc, t) > 0) {
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
export interface WorldRow { rid: string; d: number; price: number; unit: number; land: number; tr: number; n: number } // unit: 대당 이익(판매가 + 선택 사양 매출 − 원가 − 관세 − 운송비), land: 관세 + 운송비, tr: 그중 관세
/** 판매 계산: 세대마다 권역별 수요(판매 상한으로 깎음). mult: 세대별 생산 쪽 배수(출시 달 주 수·페이스리프트 전환·단종 달) */
export function worldDemand(s: CarState, gens: Generation[], m: number, year: number, mult: number[]): WorldRow[][] {
  const rows: WorldRow[][] = gens.map(() => []), t = monthTime(m);
  for (const r of openRegions(s)) {
    const list = exportedIn(s, gens, r.id, m), cars = list.map((g) => regionCar(s, g, r, m)), out: { i: number; row: WorldRow }[] = [];
    list.forEach((g, k) => {
      const i = gens.indexOf(g); if (i < 0) return;
      const { uc, opRev } = genUnit(s, g, year), tr = uc * tariffRate(r.id, g.body, t), land = tr + regionById(r.id).ship, price = cars[k].price;
      out.push({ i, row: { rid: r.id, d: regionDemandOf(s, cars[k], cars.filter((_, j) => j !== k), m, r.id) * mult[i], price, unit: price + opRev - uc - land, land, tr, n: 0 } });
    });
    const tot = out.reduce((a, x) => a + x.row.d, 0), cap = regionCap(s, r, m), k = tot > cap ? cap / tot : 1;
    for (const x of out) { x.row.d *= k; rows[x.i].push(x.row); }
  }
  return rows;
}
/** 생산 배분(세대 안): 만든 대수를 국내·권역에 나눈다. 기본은 대당 이익이 큰 곳부터, domFirst면 국내 먼저. 국내 몫을 돌려주고 rows[].n을 채운다 */
export function splitMade(made: number, domDemand: number, domUnit: number, rows: WorldRow[], domFirst: boolean): number {
  const ch = [{ d: domDemand, u: domUnit, row: null as WorldRow | null }, ...rows.map((row) => ({ d: row.d, u: row.unit, row }))];
  const order = ch.map((c, i) => ({ c, i })).sort((a, b) => (domFirst ? (a.i === 0 ? -1 : b.i === 0 ? 1 : 0) : 0) || b.c.u - a.c.u || a.i - b.i);
  let left = made, dom = 0;
  for (const { c } of order) { const n = Math.min(left, Math.round(c.d)); left -= n; if (c.row) c.row.n = n; else dom = n; }
  return dom + Math.max(0, left); // 반올림 나머지는 국내로
}

/** 세대 하나의 수출 정산(월 결산 차 줄 안에서). 돌려주는 값을 국내 합계에 더한다 */
export type RegionSum = { sold: number; revenue: number; cogs: number; landed: number; tariff: number; ship: number };
export function settleGen(g: Generation, rows: WorldRow[], uc: number): RegionSum & { by: Record<string, RegionSum> } {
  const out = { sold: 0, revenue: 0, cogs: 0, landed: 0, tariff: 0, ship: 0, by: {} as Record<string, RegionSum> };
  for (const row of rows) {
    const w = g.world![row.rid], rev = row.n * (row.unit + uc + row.land), cg = row.n * uc, ld = row.n * row.land; // unit = 판매가 + 선택 사양 매출 − 원가 − (관세 + 운송비)
    w.sold = row.n; w.demand = row.d; w.total += row.n; w.rev += rev; w.profit += rev - cg - ld;
    out.sold += row.n; out.revenue += rev; out.cogs += cg; out.landed += ld; out.tariff += row.n * row.tr; out.ship += ld - row.n * row.tr;
    out.by[row.rid] = { sold: row.n, revenue: rev, cogs: cg, landed: ld, tariff: row.n * row.tr, ship: ld - row.n * row.tr };
  }
  for (const [rid, w] of Object.entries(g.world ?? {})) if (!rows.some((x) => x.rid === rid)) { w.sold = 0; w.demand = 0; } // 이번 달 수출하지 않은 권역
  return out;
}

/** 월 결산 끝: 권역 합계·점유, 판매 법인 유지비, 인지도·평판, 자동 수출 빼기. 장부 칸을 돌려준다 */
export function worldSettle(s: CarState, ev: GameEvent[], gens: Generation[], m: number, by: Record<string, RegionSum>): { ledger: Record<string, LedgerWorld>; tariff: number; ship: number; upkeep: number } {
  const ledger: Record<string, LedgerWorld> = {};
  let tariff = 0, ship = 0, upkeep = 0;
  for (const r of openRegions(s)) {
    const b = by[r.id] ?? { sold: 0, revenue: 0, cogs: 0, landed: 0, tariff: 0, ship: 0 }, up = officeUpkeep(r.id, r.office), profit = b.revenue - b.cogs - b.landed - up;
    ledger[r.id] = { sold: b.sold, revenue: b.revenue, cogs: b.cogs, tariff: b.tariff, ship: b.ship, upkeep: up, profit };
    tariff += b.tariff; ship += b.ship; upkeep += up;
    const size = regionMarket(s, r.id, m);
    r.sold = b.sold; r.rev = b.revenue; r.profit = profit; r.share = size > 0 ? b.sold / size : 0; r.total += b.sold; r.totalProfit += profit; r.tariff = b.tariff; r.ship = b.ship;
    r.rep += Math.min(W.repYearMax, (b.sold * config.time.monthsPerYear) / W.repSoldDiv) / config.time.monthsPerYear;
    const target = Math.min(1, Math.max(0, W.awBase + repEffect(r.rep) / W.awRepDiv + W.office.aw[r.office]));
    r.aw += (target - r.aw) * (W.awRate + W.office.rate[r.office]);
    if (r.auto) for (const g of gens) { // 자동 수출: 단종된 차·연속 적자인 차를 뺀다
      const w = gw(g, r.id);
      if (!w?.on) continue;
      const ended = g.status !== 'onSale', loss = lossStreak(g, r.id) >= W.autoLossMonths;
      if (ended || loss) {
        w.on = false; if (loss) w.no = true;
        if (loss) addNews(s, ev, `자동 수출: 「${nameOf(s, g)}」${josa(nameOf(s, g), '을/를')} ${regionById(r.id).name} 수출 목록에서 뺐습니다(${W.autoLossMonths}개월 연속 적자).`, 'world', 'news', g.id, 'world');
      }
    }
  }
  return { ledger, tariff, ship, upkeep };
}
const lossStreak = (g: Generation, rid: string): number => g.world![rid].ls ?? 0;
/** 이번 달 대당 이익이 음수였는가를 세대 기록에 센다(settleGen 뒤 game.ts가 부른다) */
export function noteLoss(g: Generation, rows: WorldRow[]): void {
  for (const row of rows) { const w = g.world![row.rid]; if (row.n > 0 && row.unit < 0) w.ls = (w.ls ?? 0) + 1; else delete w.ls; }
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
    case 'setExport': case 'setRegionPrice': case 'setDomFirst': {
      const g = gen(cmd.generationId); if (!g || g.status === 'discontinued') return fail('판매 중인 차가 아닙니다.');
      if (cmd.type === 'setDomFirst') { if (cmd.on) g.domFirst = true; else delete g.domFirst; return OK; }
      const r = regionOf(s, cmd.region); if (!r) return fail('진출하지 않은 권역입니다.');
      const w = ((g.world ??= {})[r.id] ??= { on: false, sold: 0, demand: 0, total: 0, rev: 0, profit: 0 });
      if (cmd.type === 'setExport') {
        if (cmd.on) { const b = regionBlock(s, g, r.id, m); if (b) return fail(b); }
        w.on = cmd.on; if (!cmd.on && r.auto) w.no = true; else delete w.no; // 자동 수출이 켜져 있어도 손으로 뺀 차는 다시 넣지 않는다
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

// ---------- 화면용 조회 ----------
/** 권역 한 줄(세계 지도·목록) */
export interface RegionView {
  id: string; name: string; taste: string; open: boolean; since: number | null; aw: number; rep: number; office: number; auto: boolean;
  sold: number; rev: number; profit: number; share: number; total: number; totalProfit: number; tariff: number; ship: number;
  market: number; cap: number; capShare: number; entry: number; rule: string; error: string | null; officeNext: { level: number; cost: number; upkeep: number; capShare: number; error: string | null } | null; upkeep: number;
  tariffRate: number; shipCost: number; bodies: { body: string; share: number }[];
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
      upkeep: officeUpkeep(R.id, lv), tariffRate: interp(R.years, R.tariff, t), shipCost: R.ship, bodies,
    };
  });
}
/** 권역의 차 한 줄(수출 목록) */
export interface RegionCarView { id: number; name: string; body: string; on: boolean; manual: boolean; price: number; base: number; sold: number; demand: number; total: number; profit: number; unit: number; tariff: number; ship: number; block: string | null; auto: boolean; dropped: boolean }
export function regionCars(s: CarState, rid: string): RegionCarView[] {
  const r = regionOf(s, rid), m = monthOf(s.week), t = monthTime(m), y = Math.floor(t);
  if (!r) return [];
  return gensOf(s).filter((g) => g.status === 'onSale' || g.world?.[rid]?.on).filter((g) => g.status !== 'discontinued').map((g) => {
    const w = gw(g, rid), price = regionPrice(s, g, rid), { uc, opRev } = genUnit(s, g, y), tr = uc * tariffRate(rid, g.body, t);
    return { id: g.id, name: nameOf(s, g), body: g.body, on: !!w?.on, manual: w?.price !== undefined, price, base: Math.round(regionBase(s, g, rid) / 10) * 10, sold: w?.sold ?? 0, demand: w?.demand ?? 0, total: w?.total ?? 0, profit: w?.profit ?? 0,
      unit: price + opRev - uc - tr - regionById(rid).ship, tariff: tr, ship: regionById(rid).ship, block: regionBlock(s, g, rid, m), auto: r.auto, dropped: !!w?.no };
  });
}
/** 권역 경쟁사 순위(대략 점유: 차급 규모 × 그 차급의 A^지수 몫, 고객층·사건은 무시). 내 회사·기타 현지 업체 포함 */
export function regionRanking(s: CarState, rid: string): { id: string; name: string; share: number; mine?: true; local?: true }[] {
  const R = regionById(rid), m = monthOf(s.week), t = monthTime(m), e = config.market.shareExp, size = regionMarket(s, rid, m);
  const r = regionOf(s, rid), mineShare = r?.share ?? 0, acc = new Map<string, number>();
  let local = 0;
  for (const body of Object.keys(R.bodyShare)) {
    const cell = cellMonthly(body, t, rid);
    if (cell <= 0) continue;
    const tot = regionRivalPull(s, rid, body, m), rm = diffOf(s).rivalMult, loc = R.local * (rivalBase(m) * rm) ** e, norm = cellNorm(s.rivals, s.seed, body, m);
    for (const x of s.rivals) if (x.models[body] && !s.rivalry?.out.includes(x.id)) {
      const a = rivalCellA(s.rivals, s.seed, x, body, m, norm) * (RIVALS.find((d) => d.id === x.id)?.regions[rid] ?? 1) * rm, share = tot > 0 ? a ** e / tot : 0;
      acc.set(x.id, (acc.get(x.id) ?? 0) + cell * share);
    }
    local += cell * (tot > 0 ? loc / tot : 0);
  }
  const scale = size > 0 ? (1 - mineShare) / size : 0;
  const out: { id: string; name: string; share: number; mine?: true; local?: true }[] = s.rivals.filter((x) => acc.has(x.id)).map((x) => ({ id: x.id, name: x.name, share: (acc.get(x.id) ?? 0) * scale }));
  out.push({ id: 'local', name: '기타 현지 업체', share: local * scale, local: true });
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
