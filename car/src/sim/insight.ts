// 0.10.0 정보와 수습 수단: 차종별 손익, 판매 요인 분해, 직원 성장 기록, 10년 회고, 실패한 차의 수습(조건·미리보기). 순수 함수(상태를 바꾸지 않는다)
import { config } from '../config';
import { COMPAT, ERA_EVENTS, TECHS, bodyById, optionById, segmentById } from '../data';
import { avgGrade, grade, lifeFactor, standard, unitCost } from './cars';
import { LEGACY_TEXT, equipOf, expectEffect } from './equip';
import { capacityOf, costMultOf, devTeams as devTeamsOf } from './company';
import { fixWeekCost, testCut } from './dev';
import { eraNow, eraTimeline, eventImpactOn, marketMult } from './events';
import { EXEC_TITLE } from './execs';
import { allGens, linesUsed, sellingGens } from './game';
import { estimatePnl } from './history';
import { josa } from './josa';
import { faceliftEligibility, fullChangeEligibility } from './lifecycle';
import { awarenessTarget, genBasePrice, cellMonthly, currentEdition, lifeAge, monthlyDemand, rivalBase, toSaleCar, type DemandAlt, type SaleCar } from './market';
import { bestPrice, compatMark, lifeBar, nameplateOf, priceForecast } from './queries';
import { ptCostAdd } from './research';
import { mean } from './reviews';
import { monthOf, monthTime, yearOf, yearOfMonth } from './time';
import { STATS, type CarState, type ExecRole, type Generation, type ProjectKind, type Role, type Staff, type Stats } from './types';

const MPY = config.time.monthsPerYear, WPY = MPY * config.time.weeksPerMonth;
const won = (v: number): string => { const a = Math.abs(Math.round(v)), s = v < 0 ? '−' : ''; return a >= 10000 ? `${s}${(Math.round(a / 1000) / 10).toLocaleString('ko-KR')}억원` : `${s}${a.toLocaleString('ko-KR')}만원`; };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const genOf = (s: CarState, id: number) => allGens(s).find((g) => g.id === id);
const genName = (s: CarState, g: Generation) => `${nameplateOf(s, g.id)?.name ?? ''} ${g.number}세대`;

// ---------- 1. 차종별 손익 ----------
export interface FaceliftCompare { month: number; months: number; before: number; after: number; cost: number; gain: number; text: string }
export interface ModelPnL {
  generationId: number; name: string; number: number; status: Generation['status'];
  revenue: number; cogs: number; marketing: number; recall: number;
  profit: number; // 판매로 번 누적 이익(매출 − 원가 − 광고비 − 리콜비, 개발비 전)
  dev: { base: number; lift: number; retro: number; fix: number }; devTotal: number;
  net: number; // 누적 이익 − 개발비 합
  recovered: boolean; paybackMonths: number | null; // 개발비 합을 넘긴 달(출시 달 = 1)
  monthly: number[]; // 월별 이익(출시 달부터)
  estimated: boolean; // 예전 저장에서 일부 추정
  facelift: FaceliftCompare | null;
}
export function modelPnL(s: CarState, generationId: number): ModelPnL | null {
  const g = genOf(s, generationId);
  if (!g) return null;
  const p = g.pnl ?? estimatePnl(g), devTotal = p.dev.base + p.dev.lift + p.dev.retro + p.dev.fix;
  let cum = 0, payback: number | null = null;
  p.months.forEach((v, i) => { cum += v; if (payback === null && devTotal > 0 && cum >= devTotal) payback = i + 1; });
  return {
    generationId: g.id, name: nameplateOf(s, g.id)?.name ?? '', number: g.number, status: g.status,
    revenue: p.rev, cogs: p.cogs, marketing: p.mk, recall: p.recall, profit: g.profit, dev: { ...p.dev }, devTotal, net: g.profit - devTotal,
    recovered: g.profit >= devTotal, paybackMonths: payback, monthly: [...p.months], estimated: !!p.est, facelift: liftCompare(s, g, p.months, p.dev.lift, !!p.est),
  };
}
/** 1.0.0 페이스리프트 비교(반사실): 리프트 뒤 같은 개월 수(최대 12)의 실제 이익과 '하지 않았을 때' 추정 이익.
 *  추정 = 그달 실제 판매 × (리프트 없는 수명 ÷ 실제 수명) × (리프트 전 판으로 지금 시장에서 판 수요 ÷ 지금 판의 수요, 인지도 가산 뺌) × 리프트 전 판의 대당 이익 − 광고비.
 *  전에는 단순 전후 비교라 수명 감소를 무시해 이익인 리프트도 손해로 나왔다. 판매 기록을 추정으로 채운 옛 저장이면 단정하지 않는다. before는 '하지 않았을 때 추정' */
function liftCompare(s: CarState, g: Generation, months: number[], cost: number, est: boolean): FaceliftCompare | null {
  const k = g.editions.findIndex((e) => e.kind === 'facelift');
  if (k < 1) return null;
  const lift = g.editions[k], prev = g.editions[k - 1], lm = monthOf(lift.launchWeek), i = lm - g.launchMonth, n = Math.min(MPY, months.length - i);
  const none = (text: string) => ({ month: lm, months: 0, before: 0, after: 0, cost, gain: 0, text });
  if (n <= 0) return none('페이스리프트 뒤 판매 기록이 아직 없습니다.');
  if (est || g.sales.length < i + n) return none('비교할 기록이 없습니다.');
  const m = monthOf(s.week), t = monthTime(m), others = sellingGens(s).filter((x) => x.id !== g.id && x.status === 'onSale').map((x) => toSaleCar(x, m));
  const cur = { ...toSaleCar(g, m), life: 1 }, old = { ...cur, stats: prev.stats, options: prev.options, awareness: Math.max(0, g.awareness - config.lifecycle.facelift.awareness) };
  const dNow = monthlyDemand(s, cur, others, t), statR = dNow > 0 ? monthlyDemand(s, old, others, t) / dNow : 1;
  const unitOld = prev.price - unitCost(g.body, g.powertrain, prev.tier, prev.options, costMultOf(s), ptCostAdd(s, g.powertrain)), mk = config.awareness.marketingCost[g.marketing];
  let before = 0, after = 0;
  for (let j = 0; j < n; j++) {
    const mm = lm + j, lifeR = lifeFactor(mm - g.launchMonth) / Math.max(1e-9, lifeFactor(mm - g.lifeMonth));
    before += g.sales[i + j] * lifeR * statR * unitOld - mk; after += months[i + j];
  }
  const gain = after - before - cost, sign = gain >= 0 ? '+' : '';
  return { month: lm, months: n, before, after, cost, gain,
    text: `페이스리프트 뒤 ${n}개월: 하지 않았을 때 추정 ${won(before)} → 실제 ${won(after)}, 비용 ${won(cost)}${josa(won(cost), '을/를')} 빼고 ${sign}${won(gain)}${n < MPY ? `(아직 ${n}개월치)` : ''}.` };
}
export interface NameplatePnL { nameplateId: number; name: string; gens: ModelPnL[]; revenue: number; profit: number; devTotal: number; net: number; recovered: boolean; estimated: boolean }
export function nameplatePnL(s: CarState, nameplateId: number): NameplatePnL | null {
  const n = s.nameplates.find((x) => x.id === nameplateId);
  if (!n) return null;
  const gens = n.generations.map((g) => modelPnL(s, g.id)!), sum = (k: 'revenue' | 'profit' | 'devTotal') => gens.reduce((a, x) => a + x[k], 0);
  const profit = sum('profit'), devTotal = sum('devTotal');
  return { nameplateId: n.id, name: n.name, gens, revenue: sum('revenue'), profit, devTotal, net: profit - devTotal, recovered: profit >= devTotal, estimated: gens.some((x) => x.estimated) };
}

// ---------- 2. 판매 요인 ----------
export type FactorKey = 'price' | 'awareness' | 'ads' | 'life' | 'grade' | 'compat' | 'rivals' | 'ours' | 'era' | 'equip' | 'capacity'; // equip(1.1.0): 장비 기대
/** impact: 실제 수요 ÷ (이 요인만 기준 상태로 돌린 수요) − 1. 음수면 판매를 깎는 요인. units: 실제 − 기준(월 대수, 생산 한도 전). cf: 기준 상태 수요 */
export interface SalesFactor { key: FactorKey; name: string; detail: string; impact: number; units: number; cf: number; fix: string }
export interface SalesFactors { generationId: number; demand: number; sold: number | null; capacity: number; base: number; factors: SalesFactor[]; summary: string | null; equipLegacy: boolean } // equipLegacy(1.1.0): 옛 구성(장비 기대 면제)
interface Ctx { car: SaleCar; alt: DemandAlt }
/** 지금 달·지금 상태로 판매 중인 세대의 수요를 요인별로 나눈다. 계산은 market.ts monthlyDemand를 그대로 쓰고, 입력만 요인마다 기준 상태로 바꿔 다시 계산한다.
 *  다른 차는 priceForecast와 같게(판매 중, 단종 신청한 차 제외). 기준 상태: 가격 = 시장 기준가, 인지도 = config.factors.awareness, 광고 = 없음, 수명 = 1,
 *  능력치 = 그해 표시 등급 5, 궁합 = 1(공개된 조합만), 경쟁 차 = 그달 경쟁사 기본 A(강약·나이·히트작 없음), 같은 차급의 우리 다른 차 없음, 시대 사건 없음 */
export function salesFactors(s: CarState, generationId: number): SalesFactors | null {
  const g = genOf(s, generationId);
  if (!g || g.status === 'discontinued') return null;
  const m = monthOf(s.week), t = monthTime(m), y = yearOf(s.week), ed = currentEdition(g), F = config.factors, cap = capacityOf(s);
  const others = sellingGens(s).filter((x) => x.id !== g.id && x.status === 'onSale').map((x) => toSaleCar(x, m));
  const car0 = toSaleCar(g, m), dem = (c: Ctx) => monthlyDemand(s, c.car, others, t, c.alt), actual = dem({ car: car0, alt: {} });
  const qG = grade(ed.stats.Q, y), adShift = awarenessTarget(s.reputation, g.marketing, qG) - awarenessTarget(s.reputation, 0, qG);
  const known = s.knownCombos.includes(`${g.body}:${g.segment}`), mine = others.filter((o) => o.body === g.body).length;
  const std = standard(Math.floor(t)), mid = config.grade.mid, baseStats = Object.fromEntries(STATS.map((k) => [k, std])) as Stats;
  const patches: Record<FactorKey, ((c: Ctx) => Ctx) | null> = {
    price: (c) => ({ ...c, car: { ...c.car, price: genBasePrice(s, g) } }),
    ads: g.marketing > 0 ? (c) => ({ ...c, car: { ...c.car, awareness: Math.max(0, c.car.awareness - adShift) } }) : null, // 모두 돌릴 때는 인지도가 뒤에서 기준값으로 덮는다
    awareness: (c) => ({ ...c, car: { ...c.car, awareness: F.awareness } }),
    life: (c) => ({ ...c, car: { ...c.car, life: 1 } }),
    grade: (c) => ({ ...c, car: { ...c.car, stats: baseStats } }),
    compat: known ? (c) => ({ ...c, alt: { ...c.alt, compatSeg: g.segment } }) : null,
    rivals: (c) => ({ ...c, alt: { ...c.alt, rivalA: rivalBase(m) } }),
    ours: mine ? (c) => ({ ...c, alt: { ...c.alt, noOthers: true } }) : null,
    era: (c) => ({ ...c, alt: { ...c.alt, noEra: true } }),
    equip: (c) => ({ ...c, alt: { ...c.alt, noExpect: true } }),
    capacity: null, // 수요 밖(생산 한도). 지난달 실제로 못 판 몫으로 따로 센다
  };
  let all: Ctx = { car: car0, alt: {} };
  for (const f of Object.values(patches)) if (f) all = f(all);
  const out: SalesFactor[] = [];
  const add = (key: FactorKey, name: string, detail: string, fix: string) => {
    const cf = dem(patches[key]!({ car: car0, alt: {} }));
    out.push({ key, name, detail, fix, cf, units: actual - cf, impact: cf > 0 ? actual / cf - 1 : 0 });
  };
  // 가격
  const base = genBasePrice(s, g), now = priceForecast(s, g.id, ed.price) ?? 0, bp = bestPrice(s, g.id);
  const pFix = (() => {
    if (g.clearance) return '가격 인하 판매 중이라 값이 고정되어 있습니다.';
    if (bp && bp.price < ed.price) { const d = (priceForecast(s, g.id, bp.price) ?? 0) - now; return `기준가의 ${pct(bp.price / base)}(최고 이익 가격)로 내리면 월 ${d >= 0 ? '+' : '−'}${Math.abs(d)}대, 예상 월 이익 ${won(bp.profit)}.`; }
    if (ed.price > base + 1e-6) { const d = (priceForecast(s, g.id, base) ?? 0) - now; return `기준가로 내리면 월 +${d}대입니다. 다만 지금 값이 이번 달 이익으로는 가장 낫습니다.`; }
    return bp && bp.price > ed.price ? `값이 기준가 이하라 판매를 돕고 있습니다. 이익만 보면 기준가의 ${pct(bp.price / base)}가 낫습니다.` : '값이 기준가 이하라 판매를 돕고 있습니다.';
  })();
  add('price', '가격', `기준가 대비 ${ed.price >= base ? `${pct(ed.price / base - 1)} 높음` : `${pct(1 - ed.price / base)} 낮음`}`, pFix);
  // 인지도·광고
  const mk = config.awareness.marketingCost, up = g.marketing + 1 < mk.length ? g.marketing + 1 : null;
  const adFix = up === null ? '광고는 이미 가장 높은 등급입니다. 평판이 오르면 인지도 목표도 오릅니다.'
    : `광고를 ${up}등급으로 올리면 목표 인지도 ${pct(awarenessTarget(s.reputation, g.marketing, qG))} → ${pct(awarenessTarget(s.reputation, up, qG))}, 월 ${won(mk[up])}.`;
  add('awareness', '인지도', `인지도 ${pct(g.awareness)}(기준 ${pct(F.awareness)})`, adFix);
  if (patches.ads) add('ads', '광고', `광고 ${g.marketing}등급(월 ${won(mk[g.marketing])}), 광고가 없을 때와 비교`, up === null ? '가장 높은 등급입니다.' : adFix);
  // 수명
  const age = lifeAge(g, m), months = m - g.launchMonth, fl = faceliftEligibility(s, g.id), np = nameplateOf(s, g.id), fc = np ? fullChangeEligibility(s, np.id) : null;
  add('life', '수명', `출시 ${months}개월, 수명 ${pct(car0.life)}${age !== months ? '(페이스리프트로 되돌림)' : ''}`,
    car0.life >= 0.999 ? (age < config.life.rampMonths ? '출시 초기라 판매가 오르는 중입니다.' : '수명이 한창입니다.') : fl.ok ? '페이스리프트로 수명 나이를 되돌릴 수 있습니다.' : fc?.ok ? '풀체인지(다음 세대)를 준비할 때입니다.' : `수명이 줄고 있습니다. ${fc?.reason ?? ''}`.trim());
  // 등급
  const avg = avgGrade(ed.stats, y);
  add('grade', '등급', `등급 평균 ${avg.toFixed(1)}(그해 기준 보통 ${mid})`, avg >= mid ? '등급이 보통보다 높아 판매를 돕습니다.' : '해마다 기준이 올라 등급이 낮아집니다. 다음 세대에서 설계 기간·예산·팀을 늘리고, 페이스리프트는 디자인을 조금 올립니다.');
  // 궁합(공개된 조합만)
  if (patches.compat) { const v = COMPAT[g.body]?.[g.segment] ?? 1, seg = segmentById(g.segment).name; add('compat', '궁합', `${bodyById(g.body).name} × ${seg} ${compatMark(v)}`, v >= 1 ? '차체와 고객층이 잘 맞습니다.' : '차체와 주 고객층이 덜 맞습니다. 풀체인지 때 고객층이나 차체를 바꿀 수 있습니다.'); }
  // 경쟁 차
  const strongest = [...s.rivals].sort((a, b) => (b.cells[g.body] ?? 0) - (a.cells[g.body] ?? 0) || (a.id < b.id ? -1 : 1))[0];
  add('rivals', '경쟁사 세기', `${bodyById(g.body).name} 칸의 경쟁 차, 가장 센 곳 ${strongest?.name ?? '없음'}`, '경쟁 차는 4~7년마다 바뀝니다. 낡을 때를 기다리거나 가격·광고로 버팁니다.');
  if (patches.ours) add('ours', '우리 다른 차', `같은 차급의 우리 차 ${mine}대가 손님을 나눔`, '같은 차급의 차가 서로 손님을 나눠 갑니다. 고객층을 다르게 하거나 하나를 정리하세요.');
  const ev = eventImpactOn(s, g.id);
  add('era', '시대 사건', ev[0] ?? '지금 이 차에 걸린 사건 효과가 없습니다', ev.length ? '사건이 끝나면 돌아옵니다. 영구 사건이면 다음 세대에서 차체·동력을 바꿔야 합니다.' : '');
  // 1.1.0 장비 기대: 기대되는 장비가 없거나 선택 사양으로만 있으면 감점, 드문 장비를 기본으로 넣었으면 가점
  const fx = expectEffect(equipOf(ed), g.body, y), nm = (ids: string[]) => ids.map((id) => optionById(id).name).join('·');
  if (ed.equipLegacy) add('equip', '장비 기대', LEGACY_TEXT, '페이스리프트 때 추천 구성을 반영하세요.');
  else add('equip', '장비 기대', fx.missing.length ? `이 차급에서 기대되는 ${nm(fx.missing)}${josa(nm(fx.missing), '이/가')} 없음` : fx.optOnly.length ? `기대되는 ${nm(fx.optOnly)}${josa(nm(fx.optOnly), '이/가')} 선택 사양으로만 있음` : fx.fresh.length ? `아직 드문 ${nm(fx.fresh)}${josa(nm(fx.fresh), '을/를')} 기본으로 넣음` : '기대되는 장비를 모두 갖췄습니다',
    fx.missing.length || fx.optOnly.length ? '페이스리프트로 기대되는 장비를 기본 장비로 넣을 수 있습니다.' : '');
  // 생산 한도(지난달)
  if (g.lostSales >= 1 && g.lastDemand > 0) {
    const sold = g.sales.at(-1) ?? 0;
    out.push({ key: 'capacity', name: '생산 한도', detail: `지난달 주문 ${Math.round(g.lastDemand)}대 중 ${sold}대만 만듦`, cf: g.lastDemand, units: sold - g.lastDemand, impact: sold / g.lastDemand - 1, fix: s.factory.build ? '공장 증설 공사가 진행 중입니다.' : '공장 증설이나 생산 배분을 고려하세요.' });
  }
  out.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact) || (a.key < b.key ? -1 : 1));
  // 요약 한 줄: 지난달 판매가 (한도 ÷ 판매 차종 수)의 slumpShare 미만이거나 전월보다 dropShare 넘게 줄었을 때
  const last = g.sales.at(-1) ?? null, prev = g.sales.length >= 2 ? g.sales[g.sales.length - 2] : null;
  const slump = last !== null && g.sales.length >= 2 && (last < (cap / Math.max(1, linesUsed(s))) * F.slumpShare || (prev !== null && prev > 0 && last < prev * (1 - F.dropShare)));
  const bad = out.filter((f) => f.impact <= -F.minShow).slice(0, 2);
  return {
    generationId: g.id, demand: actual, sold: last, capacity: cap, base: dem(all), factors: out, equipLegacy: !!ed.equipLegacy,
    summary: slump && bad.length ? `판매가 부진합니다(지난달 ${last}대${prev !== null && prev > 0 && last! < prev ? `, 전달 ${prev}대` : ''}). 큰 원인: ${bad.map((f) => `${f.name} −${Math.round(-f.impact * 100)}%`).join(', ')}.` : null,
  };
}

// ---------- 3. 직원 성장 기록 ----------
export interface StaffHistory {
  id: number; name: string; role: Role; exec: ExecRole | null;
  join: number | null; joinAbility: number | null; since: number; years: number | null; // years: 입사 뒤 햇수(모르면 null)
  points: { year: number; ability: number; trainings: number }[]; // 입사·해마다(12월 결산)·지금
  trainings: number; // 지금까지 받은 교육 횟수
  cars: { gen: number; name: string; kind: ProjectKind; reviewAvg: number; totalSold: number; launchMonth: number }[];
  execs: { role: ExecRole; title: string; from: number; to: number | null }[];
}
const findStaff = (s: CarState, id: number): { x: Staff; exec: ExecRole | null } | null => {
  const x = s.staff.find((y) => y.id === id);
  if (x) return { x, exec: null };
  for (const [r, seat] of Object.entries(s.execs?.seats ?? {})) if (seat?.staff.id === id) return { x: seat.staff, exec: r as ExecRole };
  return null;
};
export function staffHistory(s: CarState, staffId: number): StaffHistory | null {
  const f = findStaff(s, staffId);
  if (!f) return null;
  const { x } = f, h = x.hist, since = h?.since ?? s.week, join = h?.join ?? null, yNow = yearOf(s.week);
  const tr = (y: number) => x.trainings.filter((w) => yearOf(w) === y).length;
  const points: StaffHistory['points'] = [];
  if (join !== null && h?.joinAbility != null) points.push({ year: yearOf(join), ability: h.joinAbility, trainings: 0 });
  for (const [yy, a] of Object.entries(h?.years ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]))) points.push({ year: Number(yy), ability: a, trainings: tr(Number(yy)) });
  if (!points.length || points[points.length - 1].year < yNow || points[points.length - 1].ability !== x.ability) points.push({ year: yNow, ability: x.ability, trainings: tr(yNow) });
  const cars = (h?.cars ?? []).flatMap((c) => { const g = genOf(s, c.gen); return g ? [{ gen: g.id, name: genName(s, g), kind: c.kind, reviewAvg: g.reviewAvg, totalSold: g.totalSold, launchMonth: g.launchMonth }] : []; });
  return {
    id: x.id, name: x.name, role: x.role, exec: f.exec, join, joinAbility: h?.joinAbility ?? null, since, years: join === null ? null : Math.floor((s.week - join) / WPY),
    points, trainings: x.trainings.length, cars,
    execs: (h?.execs ?? []).map((e) => ({ ...e, title: EXEC_TITLE[e.role] })),
  };
}
/** 인사 임원 보고용 한 줄: "입사 3년, 참여한 차 2대" */
export function staffBrief(s: CarState, x: Staff): string {
  const h = staffHistory(s, x.id), n = new Set(h?.cars.map((c) => c.gen) ?? []).size;
  if (!h) return '';
  return `${h.years === null ? `${yearOf(h.since)}년부터 기록` : `입사 ${h.years}년`}, 참여한 차 ${n}대`;
}

// ---------- 4. 10년 회고 ----------
export interface DecadeReview {
  decade: number; done: boolean; sold: number; revenue: number | null; profit: number | null;
  launches: string[]; best: { name: string; review: number } | null; repChange: number | null; reputation: number;
  share: number; rank: number; rivals: { name: string; share: number }[]; // 국내 점유율(대수, 경쟁사 몫은 칸 규모와 지금 경쟁 차 세기로 추정)
  events: string[]; next: string[]; headline: string;
}
/** 끝난 10년(1970, 1980, …): 지금 해가 그 10년 + 10 이상인 것, 최근이 앞 */
export const decadeYears = (s: CarState): number[] => { const out: number[] = []; for (let d = config.time.startYear; d + 10 <= yearOf(s.week); d += 10) out.unshift(d); return out; };
export function decadeReview(s: CarState, decade: number): DecadeReview {
  const m0 = (decade - config.time.startYear) * MPY, m1 = Math.min(m0 + 10 * MPY, monthOf(s.week)), inD = (m: number) => m >= m0 && m < m1, gens = allGens(s);
  let sold = 0;
  for (const g of gens) g.sales.forEach((n, i) => { if (inD(g.launchMonth + i)) sold += n; });
  const logs = Array.from({ length: 10 }, (_, i) => s.years?.[decade + i]).filter((x) => !!x);
  const full = logs.length === 10 && logs.every((x) => x!.months >= MPY);
  const launched = gens.filter((g) => inD(g.launchMonth)), best = [...launched].sort((a, b) => b.reviewAvg - a.reviewAvg || a.id - b.id)[0];
  // 점유율: 국내 시장(칸 규모 × 사건 배수)의 10년 합 대비 우리 판매. 경쟁사 몫은 칸마다 지금 경쟁 차 A²로 나눈 추정
  let market = 0; const w: Record<string, number> = {};
  for (let m = m0; m < m1; m++) { const n = eraNow(s.seed, m), mm = marketMult(n); for (const b of Object.keys(s.rivals[0]?.cells ?? {})) { const v = cellMonthly(b, monthTime(m)) * (n.body[b] ?? 1) * mm; market += v; w[b] = (w[b] ?? 0) + v; } }
  const share = market > 0 ? Math.min(1, sold / market) : 0, wsum = Object.values(w).reduce((a, x) => a + x, 0) || 1;
  const rivals = s.rivals.map((r) => ({ name: r.name, share: (1 - share) * Object.keys(w).reduce((a, b) => { const tot = s.rivals.reduce((t, q) => t + (q.cells[b] ?? 0) ** 2, 0); return a + (tot > 0 ? (w[b] / wsum) * ((r.cells[b] ?? 0) ** 2 / tot) : 0); }, 0) })).sort((a, b) => b.share - a.share);
  const rank = 1 + rivals.filter((r) => r.share > share).length;
  const events = eraTimeline(s.seed).filter((sp) => inD(sp.start)).sort((a, b) => a.start - b.start).slice(0, 3).map((sp) => `${yearOfMonth(sp.start)}년 ${sp.def.name}`);
  const nd = decade + 10, regs = ERA_EVENTS.filter((e) => e.year >= nd && e.year < nd + 10 && e.effects.some((x) => x.type === 'regulation')).map((e) => `${e.year}년 무렵 ${e.name}`);
  const techs = TECHS.filter((t) => !t.repeatable && t.year >= nd && t.year < nd + 10);
  const next = [...regs, ...(techs.length ? [`새 기술 ${techs.length}개 등장 예정: ${techs.slice(0, 4).map((t) => `「${t.name}」`).join(', ')}${techs.length > 4 ? ' 등' : ''}`] : [])];
  const repChange = logs.length ? logs.reduce((a, x) => a + Object.values(x!.rep).reduce((b, d) => b + d, 0), 0) : null;
  const co = s.companyName;
  return {
    decade, done: m1 >= m0 + 10 * MPY, sold, revenue: full ? logs.reduce((a, x) => a + x!.revenue, 0) : null, profit: full ? logs.reduce((a, x) => a + x!.profit, 0) : null,
    launches: launched.map((g) => genName(s, g)), best: best ? { name: genName(s, best), review: best.reviewAvg } : null, repChange, reputation: s.reputation,
    share, rank, rivals, events, next,
    headline: sold > 0 ? `${co}, ${decade}년대 ${sold.toLocaleString('ko-KR')}대 판매 · 국내 ${rank}위(점유율 약 ${(share * 100).toFixed(1)}%)` : `${co}, ${decade}년대에는 차를 팔지 못했다`,
  };
}

// ---------- 5. 실패한 차의 수습 ----------
/** 수습 대상인가(평론 reviewMax 이하이거나 최근 판매 부진). 대상이 아니면 이유 */
export function rescueTargetError(s: CarState, g: Generation): string | null {
  const R = config.rescue, recent = g.sales.slice(-R.poorMonths), line = capacityOf(s) / Math.max(1, linesUsed(s));
  if (g.reviewAvg <= R.reviewMax + 1e-9) return null;
  if (recent.length >= R.poorMonths && mean(recent) < line * R.poorShare) return null;
  return `평론이 ${R.reviewMax} 이하이거나 최근 ${R.poorMonths}개월 판매가 생산 라인 하나 몫의 ${pct(R.poorShare)} 미만인 차만 할 수 있습니다.`;
}
const onSaleError = (g: Generation | undefined): string | null => (!g || g.status !== 'onSale' ? '판매 중인 차가 아닙니다.' : null);
const busyOn = (s: CarState, g: Generation) => s.projects.some((p) => (p.kind === 'facelift' || p.kind === 'fix') && p.targetId === g.id);
/** 긴급 개선 팀 기본값: 쉬는 테스터·엔지니어(전담 연구원 제외) */
export const fixTeam = (s: CarState): Staff[] => s.staff.filter((x) => x.projectId === null && !x.lab && (x.role === 'tester' || x.role === 'engineer')).sort((a, b) => a.id - b.id);
export function fixError(s: CarState, generationId: number): string | null {
  const g = genOf(s, generationId);
  return onSaleError(g) ?? (g!.fixed ? '이 세대는 이미 긴급 개선을 했습니다(세대당 1회).' : null) ?? (busyOn(s, g!) ? '이 차의 페이스리프트나 긴급 개선이 이미 진행 중입니다.' : null)
    ?? (g!.clearance ? '가격 인하 판매 중인 차입니다.' : null) ?? rescueTargetError(s, g!);
}
export function clearError(s: CarState, generationId: number): string | null {
  const g = genOf(s, generationId), R = config.rescue;
  if (onSaleError(g)) return onSaleError(g);
  if (g!.clearance) return '이미 가격 인하 판매 중입니다.';
  if (busyOn(s, g!)) return '진행 중인 페이스리프트나 긴급 개선을 먼저 취소하세요.';
  const life = lifeBar(s, g!);
  return life <= R.lifeMax + 1e-9 || g!.reviewAvg <= R.reviewMax + 1e-9 ? null : `수명이 ${pct(R.lifeMax)} 넘게 남았고 혹평도 아니어서 할 수 없습니다(수명 ${pct(life)}, 평론 ${g!.reviewAvg.toFixed(1)}).`;
}
/** 가격 인하 판매 가격: 시장 기준가 × clearPct(10만원 단위, 허용 가격 안) */
export const clearPriceOf = (s: CarState, g: Generation): number => {
  const b = bodyById(g.body).basePrice;
  return Math.min(Math.floor((b * config.price.max) / 10) * 10, Math.max(Math.ceil((b * config.price.min) / 10) * 10, Math.round((genBasePrice(s, g) * config.rescue.clearPct) / 10) * 10));
};
export interface RescueOptions {
  target: string | null; // 대상이 아니면 이유
  fix: { ok: boolean; reason: string | null; weeks: number; cost: number; team: number[]; defectsNow: number; defectsAfter: number; recallNow: number; recallAfter: number; qNow: number; qAfter: number };
  clearance: { ok: boolean; reason: string | null; price: number; pct: number; months: number; salesNow: number; salesAfter: number; profitNow: number; profitAfter: number };
}
export function rescueOptions(s: CarState, generationId: number): RescueOptions | null {
  const g = genOf(s, generationId);
  if (!g) return null;
  const R = config.rescue, ed = currentEdition(g), y = yearOf(s.week), team = fixTeam(s), m = monthOf(s.week);
  const left = Math.max(0, ed.defects - testCut(team) * R.fixWeeks), rec = (d: number) => Math.min(config.recall.maxYear, d * config.recall.perDefect);
  const q0 = ed.stats.Q / (1 - Math.min(config.dev.defectQMax, ed.defects * config.dev.defectQPer)), qAfter = q0 * (1 + R.qGain) * (1 - Math.min(config.dev.defectQMax, left * config.dev.defectQPer));
  const fe = fixError(s, g.id) ?? (team.length ? null : '쉬고 있는 테스터나 엔지니어가 없습니다.') ?? (s.projects.length >= devTeamsOf(s) ? '개발팀이 모두 바쁩니다.' : null);
  const price = clearPriceOf(s, g), uc = unitCost(g.body, g.powertrain, ed.tier, ed.options, costMultOf(s), ptCostAdd(s, g.powertrain)), mk = config.awareness.marketingCost[g.marketing], cap = capacityOf(s);
  const others = sellingGens(s).filter((x) => x.id !== g.id && x.status === 'onSale').map((x) => toSaleCar(x, m));
  const salesNow = g.status === 'discontinued' ? 0 : priceForecast(s, g.id, ed.price) ?? 0;
  const salesAfter = g.status === 'discontinued' ? 0 : Math.round(Math.min(cap, monthlyDemand(s, { ...toSaleCar(g, m), price, awareness: Math.min(1, g.awareness + R.clearAwareness) }, others, monthTime(m))));
  const ce = clearError(s, g.id);
  return {
    target: g.status === 'onSale' ? rescueTargetError(s, g) : '판매 중인 차가 아닙니다.',
    fix: { ok: fe === null, reason: fe, weeks: R.fixWeeks, cost: fixWeekCost(s, g.devCost, team) * R.fixWeeks, team: team.map((x) => x.id), defectsNow: ed.defects, defectsAfter: left, recallNow: rec(ed.defects), recallAfter: rec(left), qNow: grade(ed.stats.Q, y), qAfter: grade(qAfter, y) },
    clearance: { ok: ce === null, reason: ce, price, pct: price / genBasePrice(s, g), months: R.clearMonths, salesNow, salesAfter, profitNow: salesNow * (ed.price - uc) - mk, profitAfter: salesAfter * (price - uc) - mk },
  };
}
