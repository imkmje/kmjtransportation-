// 5.6.0 모터스포츠(설계서 9.11): 매년 큰돈을 쓰고 평판·판매·인지도·연구 보상을 받는 장기 지출처. 벌칙 없음(성적이 나빠도 잃는 것은 쓴 예산뿐).
// 시즌은 1년: 2월 결산에 그해 계획을 확정, 3~12월 월 결산마다 경기 한 번, 12월 결산에 최종 순위·보상·기록. 성적은 시드 해시(게임 난수를 쓰지 않는다).
// 모터스포츠를 쓰지 않은 판(s.motor 없음)은 아무것도 바뀌지 않는다. 수치는 config.motorsport
import { config } from '../config';
import { RIVALS, REGIONS, TECHS, bodyById } from '../data';
import { unitCost } from './cars';
import { genCostMult, variantById } from './derive';
import { eliteBusy, eliteMembers } from './elite';
import { addNews } from './events';
import { addReport, delegationOn, monthlyFixed } from './execs';
import { josa } from './josa';
import { currentEdition, genBasePrice } from './market';
import { ptCostAdd } from './research';
import { hash01 } from './rng';
import { monthOf, yearOf, yearOfMonth } from './time';
import { won } from './won';
import type { CarState, CommandResult, GameEvent, Generation, MotorBoost, MotorEntry, MotorPlan, MotorState, PendingChoice } from './types';

const M = config.motorsport, MPY = config.time.monthsPerYear;
export type Series = typeof M.series[number];
export const SERIES = M.series;
export const seriesById = (id: string): Series | undefined => M.series.find((x) => x.id === id);
const fail = (reason: string): CommandResult => ({ ok: false, reason });
const OK: CommandResult = { ok: true };
const gensOf = (s: CarState): Generation[] => s.nameplates.flatMap((n) => n.generations).sort((a, b) => a.id - b.id);
const npOf = (s: CarState, g: Generation) => s.nameplates.find((n) => n.generations.includes(g))!;
const sellingOnSale = (s: CarState) => gensOf(s).filter((g) => g.status === 'onSale');

export const motorState = (s: CarState): MotorState => (s.motor ??= { plan: {}, season: null, exp: {}, history: [], boosts: [], limited: [], spent: 0, earned: 0 });
/** 위임: 시장 조사 임원 '모터스포츠 예산 자동 조정' */
export const motorDelegated = (s: CarState): boolean => delegationOn(s, 'market', 'autoMotor');

// ---------- 조건 ----------
/** 그 급에 나갈 수 없는 이유(나갈 수 있으면 null) */
export function seriesError(s: CarState, id: string): string | null {
  const x = seriesById(id); if (!x) return '없는 대회입니다.';
  if (!M.on) return '모터스포츠가 꺼져 있습니다.';
  if (s.hqLevel < x.hq) return `본사 ${x.hq}등급(${config.hq.levels[x.hq - 1].name})부터 나갈 수 있습니다.`;
  if (x.region && !s.world?.regions.length) return `본사 ${x.hq}등급 + 해외 권역 1곳 이상 진출이 필요합니다.`;
  return null;
}
/** 지금 고치는 계획이 반영되는 시즌(2월 결산 전이면 올해, 아니면 내년) */
export const planYear = (s: CarState): number => { const m = monthOf(s.week); return yearOfMonth(m) + (m % MPY > M.lockMonth ? 1 : 0); };
/** 출전 차로 고를 수 있는 차종(판매 중 세대가 그 급 차급인 것), 평론 높은 순 */
export function carChoices(s: CarState, id: string): { nameplate: number; gen: number; name: string; body: string; review: number }[] {
  const x = seriesById(id); if (!x || !x.bodies.length) return [];
  return sellingOnSale(s).filter((g) => x.bodies.includes(g.body)).map((g) => ({ nameplate: npOf(s, g).id, gen: g.id, name: npOf(s, g).name, body: g.body, review: g.reviewAvg }))
    .sort((a, b) => b.review - a.review || a.gen - b.gen);
}
const carGen = (s: CarState, x: Series, np?: number): Generation | null => {
  if (!x.bodies.length) return null;
  const c = carChoices(s, x.id), pick = (np === undefined ? c[0] : c.find((y) => y.nameplate === np)) ?? null; // 고르지 않으면 평론이 가장 높은 차(2월 확정 때와 같다)
  return pick ? gensOf(s).find((g) => g.id === pick.gen)! : null;
};

// ---------- 전력 ----------
/** 관련 연구 몫(0~1): 그해까지 나온 관련 기술 중 완료한 몫 */
export function researchShare(s: CarState, x: Series): number {
  const y = yearOf(s.week), out = x.techs.filter((id) => (TECHS.find((t) => t.id === id)?.year ?? 9999) <= y);
  return out.length ? out.filter((id) => s.research.done.includes(id)).length / out.length : 0;
}
const carPart = (x: Series, g: Generation | null): number => !g || !x.car ? 0 : x.car * Math.min(1, Math.max(0, (g.reviewAvg - M.carRef[0]) / (M.carRef[1] - M.carRef[0])));
const elitePart = (s: CarState): number => M.elite.pts * Math.min(1, eliteMembers(s).length / M.elite.full);
/** 계획(또는 가정한 계획)의 전력 부분 */
export function powerParts(s: CarState, id: string, p: MotorPlan): MotorEntry['parts'] {
  const x = seriesById(id)!;
  return { budget: M.stepPts[p.step], research: x.researchPts * researchShare(s, x), car: carPart(x, carGen(s, x, p.car)), elite: p.elite && eliteMembers(s).length ? elitePart(s) : 0, exp: s.motor?.exp[id] ?? 0 };
}
const sum = (p: MotorEntry['parts']): number => p.budget + p.research + p.car + p.elite + p.exp;
/** 경기 때 전력: 예산 부분은 낸 비율만큼 */
const entryPower = (e: MotorEntry): number => sum(e.parts) - e.parts.budget * (e.due > 0 ? 1 - Math.min(1, e.paid / e.due) : 0);
/** 그해 그 급의 상대 팀(ID 순 고정, 인수했거나 아직 등장하지 않은 경쟁사 제외)과 전력 */
export function rivalField(s: CarState, id: string, year: number): { id: string; power: number }[] {
  const x = seriesById(id)!, si = M.series.indexOf(x), out = new Set(s.rivalry?.out ?? []), list: { id: string; power: number }[] = [];
  const jit = (i: number) => (hash01(s.seed, 5601, year, si, i) * 2 - 1) * M.rivalJitter;
  Object.entries(x.rivals).forEach(([rid, p], i) => { const d = RIVALS.find((r) => r.id === rid); if (d && !out.has(rid) && year >= (d.from ?? 0)) list.push({ id: rid, power: p + jit(i) }); });
  if (x.locals && x.localPower) Object.entries(x.localPower).forEach(([rid, p], i) => list.push({ id: rid, power: p + jit(10 + i) }));
  return list;
}
const STEP_N = M.stepPts.length;
/** 한 경기 순서(성적 높은 순, 같으면 ID 순) */
function raceOrder(s: CarState, si: number, year: number, race: number, field: { id: string; power: number }[], salt = 5602, run = 0): string[] {
  const perf = field.map((t, i) => ({ id: t.id, v: t.power + M.noise * (hash01(s.seed, salt, year, si, race, i, run) + hash01(s.seed, salt + 1, year, si, race, i, run) - 1) }));
  return perf.sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1)).map((x) => x.id);
}
const addPts = (pts: Record<string, number>, order: string[]) => order.forEach((id, i) => { pts[id] = (pts[id] ?? 0) + (M.points[i] ?? 0); });
/** 순위표(점수 높은 순, 같으면 전력 높은 순, 그다음 ID 순) */
export function standings(e: Pick<MotorEntry, 'field' | 'pts'>): { id: string; pts: number }[] {
  const pw = new Map(e.field.map((t) => [t.id, t.power]));
  return e.field.map((t) => ({ id: t.id, pts: e.pts[t.id] ?? 0 })).sort((a, b) => b.pts - a.pts || (pw.get(b.id)! - pw.get(a.id)!) || (a.id < b.id ? -1 : 1));
}
/** 시즌 전 예상 순위 범위(시드 해시로 forecastRuns 시즌을 굴린 10%·90% 지점)와 우승 확률 */
export function forecast(s: CarState, id: string, p: MotorPlan, year = planYear(s)): { best: number; worst: number; win: number; of: number; power: number } {
  const x = seriesById(id)!, si = M.series.indexOf(x), parts = powerParts(s, id, p), power = sum(parts), field = [...rivalField(s, id, year), { id: 'me', power }].sort((a, b) => (a.id < b.id ? -1 : 1));
  const ranks: number[] = [];
  for (let k = 0; k < M.forecastRuns; k++) {
    const pts: Record<string, number> = {};
    for (let r = 0; r < M.races; r++) addPts(pts, raceOrder(s, si, year, r, field, 5611, k + 1));
    ranks.push(standings({ field, pts }).findIndex((t) => t.id === 'me') + 1);
  }
  ranks.sort((a, b) => a - b);
  const q = (f: number) => ranks[Math.min(ranks.length - 1, Math.floor(f * ranks.length))];
  return { best: q(0.1), worst: q(0.9), win: ranks.filter((r) => r === 1).length / ranks.length, of: field.length, power };
}
/** 보상 배수: 우승 1, 그 밖은 0.6 × (팀 수 − 순위) ÷ (팀 수 − 2), 꼴찌 0 */
export const rewardShare = (rank: number, of: number): number => rank === 1 ? 1 : of <= 2 ? 0 : Math.max(0, 0.6 * (of - rank) / (of - 2));
/** 연 예산 합(계획) */
export const planTotal = (s: CarState): number => Object.entries(s.motor?.plan ?? {}).reduce((a, [id, p]) => a + (seriesById(id)?.budget[p.step] ?? 0), 0);

// ---------- 명령 ----------
export function motorCommand(s: CarState, cmd: { type: string; series?: string; step?: number | null; car?: number | null; elite?: boolean }): CommandResult | null {
  switch (cmd.type) {
    case 'setMotor': {
      const x = seriesById(cmd.series ?? ''); if (!x) return fail('없는 대회입니다.');
      const st = motorState(s), cur = st.plan[x.id];
      if (cmd.step === null) { delete st.plan[x.id]; st.planned = planYear(s); return OK; }
      const step = cmd.step ?? cur?.step ?? 1;
      if (!Number.isInteger(step) || step < 0 || step >= STEP_N) return fail(`예산 단계는 0~${STEP_N - 1} 중에서 고르세요.`);
      const err = seriesError(s, x.id); if (err) return fail(err);
      const p: MotorPlan = { step };
      const car = cmd.car === undefined ? cur?.car : cmd.car ?? undefined;
      if (car !== undefined && x.bodies.length) { if (!carChoices(s, x.id).some((c) => c.nameplate === car)) return fail(`출전 차는 판매 중인 ${x.bodies.map((b) => bodyById(b).name).join('·')} 중에서 고르세요.`); p.car = car; }
      const elite = cmd.elite ?? !!cur?.elite;
      if (elite) {
        if (!eliteMembers(s).length) return fail('직속 전담팀원이 없습니다.');
        for (const [k, q] of Object.entries(st.plan)) if (k !== x.id) delete q.elite; // 전담팀은 한 급에만
        p.elite = true;
      }
      st.plan[x.id] = p; st.planned = planYear(s);
      return OK;
    }
    case 'confirmMotor': motorState(s).planned = planYear(s); return OK;
    case 'ackMotor': { const st = motorState(s); st.seen = st.history.at(-1)?.year ?? st.seen; return OK; }
    default: return null;
  }
}

// ---------- 매달(월 결산) ----------
export interface MotorMonth { spend: number; rev: number; rep: { value: number; reason: string }[] }
/** 월 결산(장부 직전): 시즌 확정(2월)·예산·경기·최종 순위(12월)·보상 만료·한정판 판매. avail: 이번 달 모터스포츠를 빼기 전 결산 뒤 현금(이보다 많이 내지 않는다) */
export function motorMonth(s: CarState, ev: GameEvent[], m: number, avail: number): MotorMonth {
  const st = motorState(s), mo = m % MPY, year = yearOfMonth(m), out: MotorMonth = { spend: 0, rev: 0, rep: [] };
  st.boosts = st.boosts.filter((b) => m < b.until);
  for (const L of st.limited) if (L.left > 0) { const n = Math.min(L.left, L.per); L.left -= n; L.rev += n * L.price; out.rev += n * L.price; }
  st.limited = st.limited.filter((L) => L.left > 0 || L.year >= year - 1);
  if (mo === M.lockMonth) lockSeason(s, ev, year);
  const ss = st.season;
  if (ss && ss.year === year && mo >= M.firstMonth && mo < M.firstMonth + M.races) {
    let cash = avail + out.rev;
    const lines: string[] = [];
    for (const e of ss.entries) {
      const due = e.budget / M.races, pay = Math.max(0, Math.min(due, cash));
      cash -= pay; e.due += due; e.paid += pay; out.spend += pay;
      if (pay < due - 1) addNews(s, ev, `[모터스포츠] 현금이 모자라 ${seriesById(e.series)!.name} 이번 달 예산을 ${won(pay)}만 냈습니다. 낸 비율만큼 전력이 줄어듭니다.`, 'other', 'news', undefined, 'warning');
      const me = e.field.find((t) => t.id === 'me')!; me.power = entryPower(e);
      const si = M.series.findIndex((x) => x.id === e.series), order = raceOrder(s, si, year, e.races, e.field);
      addPts(e.pts, order); e.races++; e.last = order;
      const pos = order.indexOf('me') + 1, rank = standings(e).findIndex((t) => t.id === 'me') + 1;
      lines.push(`${seriesById(e.series)!.name} ${pos}위(종합 ${rank}위, ${e.pts.me ?? 0}점)`);
    }
    if (lines.length) addNews(s, ev, `[모터스포츠] ${mo - M.firstMonth + 1}전: ${lines.join(', ')}${mo - M.firstMonth + 1 < M.races ? `. 남은 경기 ${M.races - (mo - M.firstMonth + 1)}` : ''}.`, 'other', 'news', undefined, 'market'); // 달마다 한 건(급마다 쌓으면 뉴스 보관이 빨리 밀린다)
    st.spent += out.spend;
    if (mo === M.firstMonth + M.races - 1) out.rep.push(...finishSeason(s, ev, year));
  }
  if (mo === MPY - 1) bumpExp(s, year);
  st.earned += out.rev;
  return out;
}
/** 2월 결산: 위임이면 예산을 고치고, 계획을 그해 시즌으로 확정한다(조건이 안 되는 급은 빠진다) */
function lockSeason(s: CarState, ev: GameEvent[], year: number): void {
  const st = s.motor!;
  if (motorDelegated(s)) autoPlan(s);
  const entries: MotorEntry[] = [];
  for (const x of M.series) {
    const p = st.plan[x.id]; if (!p) continue;
    const err = seriesError(s, x.id);
    if (err) { addNews(s, ev, `[모터스포츠] ${x.name}: ${err} 올해는 나가지 않습니다.`, 'other', 'news', undefined, 'market'); continue; }
    let g = carGen(s, x, p.car);
    if (x.bodies.length && !g) { const c = carChoices(s, x.id)[0]; g = c ? gensOf(s).find((y) => y.id === c.gen)! : null; if (g) p.car = npOf(s, g).id; }
    let elite = !!p.elite && eliteMembers(s).length > 0;
    if (elite && eliteBusy(s)) { elite = false; addNews(s, ev, `[모터스포츠] 직속 전담팀이 차를 개발 중이라 ${x.name}에 배치하지 못했습니다.`, 'other', 'news', undefined, 'market'); }
    const parts = powerParts(s, x.id, { ...p, ...(elite ? { elite: true as const } : { elite: undefined }) });
    const field = [...rivalField(s, x.id, year), { id: 'me', power: sum(parts) }].sort((a, b) => (a.id < b.id ? -1 : 1));
    entries.push({ series: x.id, step: p.step, budget: x.budget[p.step], car: g?.id ?? null, carName: g ? npOf(s, g).name : '', elite, parts, due: 0, paid: 0, field, pts: {}, races: 0, last: [] });
  }
  st.season = entries.length ? { year, entries } : null;
  if (entries.length) addNews(s, ev, `[모터스포츠] ${year} 시즌 계획 확정: ${entries.map((e) => `${seriesById(e.series)!.name} ${M.stepNames[e.step]}(${won(e.budget)})`).join(', ')}. 3월부터 10경기를 치릅니다.`, 'other', 'news', undefined, 'market');
}
/** 위임: 참가할 수 있는 급에 모두 나가되 연 예산 합이 현금의 autoShare를 넘지 않게 단계를 낮춘다(가장 비싼 급부터 한 단계씩, 0단계로도 넘으면 그 급은 쉰다). 출전 차가 없으면 평론이 가장 높은 차 */
export function autoPlan(s: CarState): void {
  const st = motorState(s), cap = Math.max(0, s.cash) * M.autoShare, before = JSON.stringify(st.plan);
  const plan: Record<string, MotorPlan> = {};
  for (const x of M.series) if (!seriesError(s, x.id)) { const c = carChoices(s, x.id), cur = st.plan[x.id]; plan[x.id] = { step: STEP_N - 1, ...(x.bodies.length && c.length ? { car: c.some((y) => y.nameplate === cur?.car) ? cur!.car : c[0].nameplate } : {}), ...(cur?.elite ? { elite: true as const } : {}) }; }
  const total = () => Object.entries(plan).reduce((a, [id, p]) => a + seriesById(id)!.budget[p.step], 0);
  while (Object.keys(plan).length && total() > cap) {
    const [id] = Object.entries(plan).sort((a, b) => seriesById(b[0])!.budget[b[1].step] - seriesById(a[0])!.budget[a[1].step] || (a[0] < b[0] ? -1 : 1))[0];
    if (plan[id].step > 0) plan[id].step--; else delete plan[id];
  }
  st.plan = plan; st.planned = planYear(s);
  if (JSON.stringify(plan) !== before) addReport(s, 'market', 'autoMotor', Object.keys(plan).length ? `올해 모터스포츠 예산을 현금의 ${Math.round(M.autoShare * 100)}% 안으로 정했습니다: ${Object.entries(plan).map(([id, p]) => `${seriesById(id)!.name} ${M.stepNames[p.step]}(${won(seriesById(id)!.budget[p.step])})`).join(', ')}.` : `현금의 ${Math.round(M.autoShare * 100)}% 안에서는 가장 작은 예산도 낼 수 없어 올해는 모터스포츠에 나가지 않습니다.`, [`현금 ${won(s.cash)}`], { tab: 'motor' }, true);
}
/** 12월 결산: 최종 순위, 보상(평판·판매·인지도·연구·전 차종), 기록, 우승 기념 한정판 결정 */
function finishSeason(s: CarState, ev: GameEvent[], year: number): { value: number; reason: string }[] {
  const st = s.motor!, rep: { value: number; reason: string }[] = [], m = monthOf(s.week);
  for (const e of st.season!.entries) {
    const x = seriesById(e.series)!, table = standings(e), rank = table.findIndex((t) => t.id === 'me') + 1, of = table.length, f = rewardShare(rank, of);
    st.history.push({ year, series: x.id, rank, of, pts: e.pts.me ?? 0, budget: e.budget, paid: e.paid, car: e.carName, elite: e.elite });
    const win = rank === 1, gotRep = x.rep * f;
    if (gotRep > 0) rep.push({ value: gotRep, reason: `${x.name} ${rank}위` });
    const bodies = [...new Set([...M.sports, ...(e.car !== null ? [gensOf(s).find((g) => g.id === e.car)?.body ?? ''] : [])].filter(Boolean))];
    const add = (b: MotorBoost) => { if (b.value > 0) st.boosts.push(b); };
    add({ kind: 'sales', series: x.id, value: x.sales * f, until: m + 1 + x.salesMonths, bodies });
    if (x.region) add({ kind: 'aw', series: x.id, value: M.aw.value * f, until: m + 1 + M.aw.months });
    if (x.id === 'formula' && rank <= M.brand.top) add({ kind: 'brand', series: x.id, value: M.brand.value * f, until: m + 1 + M.brand.months });
    if (win) add({ kind: 'research', series: x.id, value: M.research.mult, until: m + 1 + M.research.months, fields: [...x.fields] });
    const wins = st.history.filter((h) => h.series === x.id && h.rank === 1).length;
    addNews(s, ev, `[모터스포츠] ${year} ${x.name} 최종 ${rank}위(${of}팀 중, ${e.pts.me ?? 0}점)${win ? `. 우승입니다(통산 ${wins}회)` : ''}. ${f > 0 ? `${bodies.map((b) => bodyById(b).name).join('·')} 판매가 ${x.salesMonths}개월 동안 ${Math.round(x.sales * f * 1000) / 10}% 늘어납니다.` : '이번 시즌 보상은 없습니다. 쓴 예산 말고 잃는 것은 없습니다.'}`, 'other', 'news', undefined, 'market');
    if (win) limitedOffer(s, ev, x, e);
  }
  return rep;
}
/** 12월 결산 뒤: 나간 급은 경험 + step, 쉰 급은 − decay */
function bumpExp(s: CarState, year: number): void {
  const st = s.motor!, went = new Set(st.season?.year === year ? st.season.entries.map((e) => e.series) : []);
  for (const x of M.series) { const v = st.exp[x.id] ?? 0, n = went.has(x.id) ? Math.min(M.exp.max, v + M.exp.step) : Math.max(0, v - M.exp.decay); if (n) st.exp[x.id] = n; else delete st.exp[x.id]; }
}

// ---------- 우승 기념 한정판 ----------
/** 한정판의 바탕 세대: 출전 차(판매 중), 포뮬러는 판매 중 평론이 가장 높은 차 */
const limitedBase = (s: CarState, e: MotorEntry): Generation | undefined => {
  const g = e.car === null ? undefined : gensOf(s).find((y) => y.id === e.car && y.status === 'onSale');
  return g ?? [...sellingOnSale(s)].sort((a, b) => b.reviewAvg - a.reviewAvg || a.id - b.id)[0];
};
export function limitedPlan(s: CarState, x: Series, g: Generation): { name: string; units: number; price: number; unit: number; cost: number; rep: number } {
  const gt = variantById('gt')!, L = M.limited, ed = currentEdition(g), already = g.variant === 'gt';
  const price = Math.round(genBasePrice(s, g) * (already ? 1 : gt.price) * L.priceMult / 10) * 10;
  const unit = unitCost(g.body, g.powertrain, ed.tier, ed.options, genCostMult(s, g), ptCostAdd(s, g.powertrain, ed.battery, g.evPlatform)) * (already ? 1 : gt.cost);
  const cost = Math.round(x.units * unit + Math.max(L.devMin, g.devCost * gt.devShare * L.devShare));
  return { name: `${npOf(s, g).name} ${x.short} 우승 기념판`, units: x.units, price, unit, cost, rep: x.limitedRep };
}
function limitedOffer(s: CarState, ev: GameEvent[], x: Series, e: MotorEntry): void {
  const g = limitedBase(s, e); if (!g) return;
  const L = limitedPlan(s, x, g), profit = L.units * L.price - L.cost, id = s.nextId++;
  const text = `${x.name} 우승을 기념해 「${npOf(s, g).name}」 바탕 고성능 한정판 「${L.name}」 ${L.units.toLocaleString()}대를 낼 수 있습니다. 대당 ${won(L.price)}, 비용 ${won(L.cost)}(생산·개발), ${M.limited.months}개월에 나눠 모두 팔립니다.`;
  const results = [`비용 ${won(L.cost)}${josa(won(L.cost), '을/를')} 지금 냅니다. ${M.limited.months}개월 동안 ${won(L.units * L.price)}어치가 팔려 약 ${won(profit)}${profit >= 0 ? '이 남고' : '을 잃고'}, 평판이 ${L.rep} 오릅니다.`, '돈은 들지 않습니다. 우승 보상은 그대로 받습니다.'];
  s.events.pending.push({ id, eventId: 'motorLimited', text, week: s.week + 1, deadline: s.week + 1 + config.events.choiceWeeks, genId: g.id, fx: null, ms: { series: x.id, gen: g.id, name: L.name, units: L.units, price: L.price, unit: L.unit, cost: L.cost, rep: L.rep, results } });
  addNews(s, ev, `[우승 기념 한정판] ${text}`, 'choice', 'choice', id, 'market'); // week: 월 결산 주에 생기지만 결정 자동 승인은 달 첫 주에 그 주에 생긴 결정만 보므로 다음 주(1월 첫 주) 결정으로 둔다
}
/** 결정의 효과(game.ts applyChoice가 부른다, 비용은 choiceMoney로 이미 냈다): 한정판 판매를 건다. 평판은 돌려준다(game이 더한다) */
export function applyLimited(s: CarState, pc: PendingChoice): number {
  const x = pc.ms; if (!x) return 0;
  motorState(s).limited.push({ name: x.name, series: x.series, year: yearOf(s.week), units: x.units, left: x.units, price: x.price, per: Math.ceil(x.units / M.limited.months), rev: 0 });
  return x.rep;
}
/** 자동 승인 '규칙대로'·위임의 답: 다 팔았을 때 남는 돈이 있으면 낸다 */
export function limitedAuto(_s: CarState, pc: PendingChoice): { choice: number; why: string } | null {
  const x = pc.ms; if (!x) return null;
  const profit = x.units * x.price - x.cost;
  return profit > 0 ? { choice: 0, why: `다 팔면 약 ${won(profit)}${josa(won(profit), '이/가')} 남아 한정판을 냈습니다.` } : { choice: 1, why: `다 팔아도 약 ${won(-profit)}${josa(won(-profit), '을/를')} 잃어 내지 않았습니다.` };
}
/** 위임 결정 처리 기준: 비용을 내고도 운영비 6개월 치가 남는가 */
export const limitedAffordable = (s: CarState, pc: PendingChoice): boolean => s.cash - (pc.ms?.cost ?? 0) >= monthlyFixed(s) * config.exec.research.cashMonths;

// ---------- 효과(다른 계산이 부른다) ----------
/** 그 세대의 판매 배수(차급 판매·고성능판·전 차종). 보상이 없으면 1 */
export function motorSalesMult(s: CarState, g: Pick<Generation, 'body' | 'variant'>, m: number): number {
  let k = 1;
  for (const b of s.motor?.boosts ?? []) if (m < b.until && ((b.kind === 'sales' && (b.bodies!.includes(g.body) || g.variant === 'gt')) || b.kind === 'brand')) k += b.value;
  return k;
}
/** 진출한 권역 인지도 목표 가산 */
export const motorAw = (s: CarState, m: number): number => (s.motor?.boosts ?? []).filter((b) => b.kind === 'aw' && m < b.until).reduce((a, b) => a + b.value, 0);
/** 그 기술 연구 점수 배수(우승 보상의 관련 분야) */
export function motorResearchMult(s: CarState, techId: string, m: number): number {
  const f = TECHS.find((t) => t.id === techId)?.field;
  return 1 + (s.motor?.boosts ?? []).filter((b) => b.kind === 'research' && m < b.until && !!f && b.fields!.includes(f)).reduce((a, b) => a + b.value, 0);
}
/** 올해 시즌에 직속 전담팀이 배치되어 있는가(그동안 전담팀은 차를 개발하지 못한다) */
export const motorEliteBusy = (s: CarState): boolean => { const ss = s.motor?.season; return !!ss && ss.year === yearOf(s.week) && ss.entries.some((e) => e.elite && e.races < M.races); };

// ---------- 화면용 ----------
export const teamName = (s: CarState, id: string): string => id === 'me' ? s.companyName : RIVALS.find((r) => r.id === id)?.name ?? REGIONS.flatMap((r) => r.makers).find((x) => x.id === id)?.name ?? id;
/** fc: 예상 순위까지 셈한다(시즌 200번 굴림, 화면의 모터스포츠 구역만) */
export function motorInfo(s: CarState, fc = true) {
  const st = s.motor, m = monthOf(s.week), year = yearOfMonth(m), ss = st?.season?.year === year ? st.season : null, py = planYear(s);
  const series = M.series.map((x) => {
    const err = seriesError(s, x.id), p = st?.plan[x.id] ?? null, e = ss?.entries.find((y) => y.series === x.id) ?? null;
    const table = e ? standings(e).map((t, i) => ({ rank: i + 1, id: t.id, name: teamName(s, t.id), pts: t.pts, me: t.id === 'me' })) : [];
    const hist = (st?.history ?? []).filter((h) => h.series === x.id);
    return {
      id: x.id, name: x.name, short: x.short, hq: x.hq, region: x.region, eligible: !err, why: err, steps: x.budget.map((b, i) => ({ step: i, name: M.stepNames[i], budget: b, pts: M.stepPts[i] })),
      plan: p, cars: carChoices(s, x.id), needCar: x.bodies.length > 0, bodies: x.bodies.map((b) => bodyById(b).name),
      parts: p && !err ? powerParts(s, x.id, p) : null, fc: fc && p && !err ? forecast(s, x.id, p) : null, exp: st?.exp[x.id] ?? 0,
      season: e ? { races: e.races, of: M.races, rank: table.find((t) => t.me)!.rank, pts: e.pts.me ?? 0, budget: e.budget, paid: e.paid, step: e.step, car: e.carName, elite: e.elite, last: e.last.map((id) => teamName(s, id)), lastPos: e.last.indexOf('me') + 1, table, power: entryPower(e) } : null,
      history: [...hist].reverse(), wins: hist.filter((h) => h.rank === 1).length,
    };
  });
  const total = planTotal(s), seasonBudget = ss?.entries.reduce((a, e) => a + e.budget, 0) ?? 0;
  return {
    on: M.on, open: series.some((x) => x.eligible), year, planYear: py, locked: m % MPY > M.lockMonth, delegated: motorDelegated(s), delegateKey: 'autoMotor', series, total,
    warn: !motorDelegated(s) && total > Math.max(0, s.cash) * M.warnShare ? `계획한 연 예산 합 ${won(total)}${josa(won(total), '이/가')} 지금 현금의 ${Math.round(M.warnShare * 100)}%를 넘습니다. 현금이 모자라면 남은 현금까지만 내고, 그만큼 전력이 줄어듭니다.` : null,
    seasonBudget, seasonPaid: ss?.entries.reduce((a, e) => a + e.paid, 0) ?? 0, entered: ss?.entries.length ?? 0, wins: (st?.history ?? []).filter((h) => h.rank === 1).length,
    spent: st?.spent ?? 0, earned: st?.earned ?? 0, boosts: (st?.boosts ?? []).map((b) => ({ ...b, left: b.until - m, name: seriesById(b.series)?.name ?? '' })), limited: [...(st?.limited ?? [])],
    lastYear: st?.history.at(-1)?.year ?? null, seen: st?.seen ?? null, planned: st?.planned ?? null, autoShare: M.autoShare, warnShare: M.warnShare, stepNames: M.stepNames,
    eliteN: eliteMembers(s).length, eliteBusyNow: motorEliteBusy(s),
  };
}
