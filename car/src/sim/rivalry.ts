// 3.5.0 경쟁 2부(설계서 7.4): 경쟁사가 플레이어에게 반응하고(대응 신차·가격 전쟁·이직 제안), 플레이어도 경쟁사에 손을 쓴다(인재 영입·기술 제휴·인수),
// 해마다 시상식, 자회사 상장. 무작위는 모두 시드 해시(게임 난수를 쓰지 않는다). 수치는 config.rivalry, 균형은 "쓰면 이득, 당하는 쪽은 약하게"
import { config } from '../config';
import { NAMES, RIVALS, TECHS, bodyById, techById } from '../data';
import { grade, payOf, salaryOf } from './cars';
import { staffCap } from './company';
import { addNews } from './events';
import { startHist } from './history';
import { josa } from './josa';
import { basePriceOf, bodyKey, cellMonthly, currentEdition, monthlyDemand, rivalA, rivalBase, rivalCycle, subPull, toSaleCar } from './market';
import { isDone, researchCost } from './research';
import { activeRivals, isOut, myCellShare, rivalHooks, rivalModelView } from './rivals';
import { hash01 } from './rng';
import { startOf } from './start';
import { brandFixed, brandMonth, buildAcquired, isBrand, subById, subModelView } from './subs';
import { monthLabel, monthOf, monthTime, yearOf, yearOfMonth } from './time';
import { type Award, type CarState, type Command, type CommandResult, type GameEvent, type Generation, type PendingChoice, type PriceWar, type RivalDef, type RivalryState, type Role, type Staff, type Subsidiary } from './types';

const R = config.rivalry, MPY = config.time.monthsPerYear;
const defOf = (id: string): RivalDef => RIVALS.find((x) => x.id === id)!;
const ROLE_KO: Record<Role, string> = { designer: '디자이너', engineer: '엔지니어', tester: '테스터', sales: '영업' };
const won = (x: number): string => { const v = Math.abs(x), k = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d }); if (v >= 1e8) { const e = Math.round(v / 1e4), jo = Math.floor(e / 1e4), eok = e % 1e4; return `${jo.toLocaleString('ko-KR')}조${eok ? ` ${k(eok)}억` : ''}원`; } return v >= 10000 ? `${k(v / 10000, 1)}억원` : `${k(Math.round(v))}만원`; };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const strKey = (t: string) => [...t].reduce((h, ch) => Math.imul(h, 31) + ch.charCodeAt(0), 11) >>> 0;

export const emptyRivalry = (): RivalryState => ({ counters: [], counterCool: {}, wars: [], lastWar: -9999, lastPoach: -9999, talent: [], talentMonth: -9999, weak: {}, alliances: [], out: [], awards: [], log: [] });
/** 경쟁 2부 상태(없으면 빈 상태로 만든다: 형식 9 이하 저장도 다음 달부터 자연스럽게 시작) */
export const rv = (s: CarState): RivalryState => (s.rivalry ??= emptyRivalry());
const log = (s: CarState, text: string) => { const st = rv(s); st.log.push({ week: s.week, text }); if (st.log.length > R.logMax) st.log.splice(0, st.log.length - R.logMax); };
const news = (s: CarState, ev: GameEvent[], text: string, alert = true) => { addNews(s, alert ? ev : [], text, 'rival', 'news', undefined, 'rival'); log(s, text); };
/** 이 판이 시작한 달(늦은 시작이면 그 해 1월) */
const startMonthOf = (s: CarState): number => (startOf(s).year - config.time.startYear) * MPY;
/** 경쟁사의 공세(가격 전쟁·이직 제안)가 시작되는 달: 설립 뒤 난이도별 햇수 */
export const pressureFrom = (s: CarState): number => startMonthOf(s) + (R.war.startYears[s.difficulty ?? 'normal'] ?? R.war.startYears.normal) * MPY;
const monthChance = (perYear: number): number => 1 - (1 - perYear) ** (1 / MPY);
const riOf = (s: CarState, id: string): number => s.rivals.findIndex((r) => r.id === id);
const onSale = (s: CarState): Generation[] => s.nameplates.flatMap((n) => n.generations).filter((g) => g.status === 'onSale').sort((a, b) => a.id - b.id);
const nameOfGen = (s: CarState, g: Generation): string => s.nameplates.find((n) => n.generations.includes(g))?.name ?? '';

// ---------- 시장에 주는 효과 ----------
/** 가격 전쟁에서 따라 내린 내 차 가격 배수(그 차급, 그 달). 없으면 1 */
export function warPriceMult(s: CarState, body: string, m: number): number {
  const w = s.rivalry?.wars.find((x) => x.body === body && x.follow && m >= x.from && m < x.until);
  return w ? 1 - w.cut : 1;
}
/** 진행 중인 가격 전쟁(그 달) */
export const activeWar = (s: CarState, m = monthOf(s.week)): PriceWar | undefined => s.rivalry?.wars.find((x) => m >= x.from && m < x.until);
/** 월말 경쟁 차 갱신 뒤: 칸 세기 × (1 − 인재 유출) × 가격 전쟁 × 인수 빈 몫(남은 경쟁사가 absorb만큼 이어받는다). 다음 달 갱신이 다시 셈하므로 쌓이지 않는다 */
function applyCells(s: CarState, m: number): void {
  const st = rv(s), ghost = R.acquire.absorb ** (1 / config.market.shareExp);
  for (const r of s.rivals) {
    const base = (1 - (st.weak[r.id] ?? 0)) * (isOut(s, r.id) ? ghost : 1);
    for (const body of Object.keys(r.cells)) {
      const w = st.wars.find((x) => x.rivalId === r.id && x.body === body && m >= x.from && m < x.until);
      const k = base * (w ? 1 + w.cut * R.war.aPer : 1);
      if (k !== 1) r.cells[body] *= k;
    }
  }
}
/** 예고한 대응 신차를 낸다(그 칸의 새 세대, 기본 A + boost). 낸 칸("경쟁사:차급")을 돌려준다(세대교체 뉴스를 겹쳐 내지 않게) */
function launchCounters(s: CarState, ev: GameEvent[], m: number): Set<string> {
  const st = rv(s), done = new Set<string>();
  for (const c of st.counters.filter((x) => x.launch <= m).sort((a, b) => a.id - b.id)) {
    st.counters = st.counters.filter((x) => x !== c);
    const ri = riOf(s, c.rivalId), r = s.rivals[ri];
    if (!r || isOut(s, r.id) || !r.models[c.body]) continue;
    const md = r.models[c.body], n = md.n + 1, def = defOf(r.id);
    r.models[c.body] = { n, start: m, cycle: rivalCycle(s.seed, ri, c.body, n), base: rivalBase(m) + (def.cells[c.body] ?? 0) + (hash01(s.seed, 3, ri, bodyKey(c.body), n) * 2 - 1) * config.rivals.noise + R.counter.boost };
    r.cells[c.body] = rivalA(r.models[c.body], m);
    st.counterCool[c.body] = m + R.counter.cooldown;
    done.add(`${r.id}:${c.body}`);
    const v = rivalModelView(s, ri, c.body);
    news(s, ev, `[대응 신차] ${r.name}, 「${c.target}」${josa(c.target, '을/를')} 겨냥한 ${v.name} ${v.number}세대 출시. ${bodyById(c.body).name}, 추정 평론 ${v.critic.toFixed(1)}.`);
  }
  return done;
}
rivalHooks.launch = launchCounters;
rivalHooks.cells = applyCells;

/** 한 칸에서 경쟁사 각각의 점유 어림(rivalModelView와 같은 셈) */
const rivalShares = (s: CarState, body: string): { id: string; share: number }[] => {
  const e = config.market.shareExp, act = activeRivals(s), tot = s.rivals.reduce((a, r) => a + (r.cells[body] ?? 0) ** e, 0) + subPull(s, body), mine = myCellShare(s, body);
  return act.filter((r) => r.models[body]).map((r) => ({ id: r.id, share: tot > 0 ? (1 - mine) * (r.cells[body] ?? 0) ** e / tot : 0 }));
};

// ---------- 월초: 가격 전쟁·이직 제안·인재 후보·계약 만료 ----------
export function rivalryMonthStart(s: CarState, ev: GameEvent[]): void {
  if (!R.on) return;
  const st = rv(s), m = monthOf(s.week);
  for (const w of st.wars.filter((x) => m >= x.until)) {
    st.wars = st.wars.filter((x) => x !== w);
    const rn = s.rivals.find((r) => r.id === w.rivalId)?.name ?? '';
    news(s, ev, `[가격 전쟁 끝] ${rn}의 ${bodyById(w.body).name} 가격 인하가 끝났습니다.${w.follow ? ' 따라 내렸던 내 차 가격도 원래대로 돌아갑니다.' : ''}`);
  }
  for (const a of st.alliances.filter((x) => m >= x.until)) {
    st.alliances = st.alliances.filter((x) => x !== a);
    news(s, ev, `[기술 제휴 만료] ${s.rivals.find((r) => r.id === a.rivalId)?.name ?? ''}와의 기술 제휴 계약 기간이 끝났습니다.`);
  }
  st.talent = st.talent.filter((t) => m < t.until && !isOut(s, t.rivalId));
  if (s.hqLevel >= R.talent.hqMin && m - st.talentMonth >= R.talent.refreshMonths) refreshTalent(s, m);
  if (m < pressureFrom(s) || activeRivals(s).length === 0) return;
  rollWar(s, ev, m);
  rollPoach(s, ev, m);
}
function rollWar(s: CarState, ev: GameEvent[], m: number): void {
  const st = rv(s), W = R.war;
  if (st.wars.length || m < st.lastWar + W.gap || hash01(s.seed, 80, m) >= monthChance(W.perYear)) return;
  const bodies = [...new Set(onSale(s).map((g) => g.body))].filter((b) => activeRivals(s).some((r) => r.models[b])).sort();
  if (!bodies.length) return;
  const body = bodies[Math.floor(hash01(s.seed, 81, m) * bodies.length)], cands = activeRivals(s).filter((r) => r.models[body]);
  const r = cands[Math.floor(hash01(s.seed, 82, m) * cands.length)];
  const cut = Math.round((W.cutMin + hash01(s.seed, 83, m) * (W.cutMax - W.cutMin)) * 100) / 100, months = W.monthsMin + Math.floor(hash01(s.seed, 84, m) * (W.monthsMax - W.monthsMin + 1));
  const war: PriceWar = { id: s.nextId++, rivalId: r.id, body, from: m, until: m + months, cut, follow: null };
  st.wars.push(war); st.lastWar = war.until;
  const est = warEstimate(s, war), bn = bodyById(body).name, cars = est.names.map((x) => `「${x}」`).join('·');
  const text = `${r.name}${josa(r.name, '이/가')} ${bn} 차급 가격을 ${pct(cut)} 내렸습니다(${months}개월, ${monthLabel(war.until - 1)}까지). 이 차급의 내 차는 ${cars}입니다. 따라 내릴까요?`;
  const results = [
    `${months}개월 동안 ${cars} 가격을 ${pct(cut)} 내리고, 끝나면 원래대로 돌립니다. 판매는 지키지만 한 달 매출이 약 ${won(est.revenueCut)} 줄어듭니다.`,
    `가격은 그대로 둡니다. 그 기간 이 차급의 내 차 판매가 약 ${pct(est.holdLoss)} 줄어듭니다.`,
  ];
  pushChoice(s, ev, 'priceWar', '가격 전쟁', text, { rivalId: r.id, war: war.id, results });
}
/** 가격 전쟁 어림: 버티면 줄어드는 판매 비율, 따라 내리면 줄어드는 한 달 매출(지금 판매 × 가격 × 인하 폭) */
export function warEstimate(s: CarState, w: PriceWar): { holdLoss: number; revenueCut: number; names: string[] } {
  const m = monthOf(s.week), t = monthTime(m), gens = onSale(s), cars = gens.map((g) => toSaleCar(g, m)), mine = gens.map((g, i) => ({ g, i })).filter((x) => x.g.body === w.body);
  const r = s.rivals.find((x) => x.id === w.rivalId)!, keep = r.cells[w.body];
  const dem = () => mine.map(({ i }) => monthlyDemand(s, cars[i], cars.filter((_, j) => j !== i), t));
  const d0 = dem();
  r.cells[w.body] = keep * (1 + w.cut * R.war.aPer);
  const d1 = dem();
  r.cells[w.body] = keep;
  const a = d0.reduce((x, y) => x + y, 0), b = d1.reduce((x, y) => x + y, 0);
  return { holdLoss: a > 0 ? Math.max(0, 1 - b / a) : 0, revenueCut: mine.reduce((x, { g }, k) => x + Math.min(d0[k], g.sales.at(-1) ?? d0[k]) * currentEdition(g).price * w.cut, 0), names: mine.map(({ g }) => nameOfGen(s, g)) };
}
function rollPoach(s: CarState, ev: GameEvent[], m: number): void {
  const st = rv(s), P = R.poach;
  if (s.staff.length < P.minStaff || m < st.lastPoach + P.gap || hash01(s.seed, 85, m) >= monthChance(P.perYear)) return;
  const taken = new Set(s.events.pending.flatMap((p) => (p.rv?.staffId === undefined ? [] : [p.rv.staffId])));
  const top = [...s.staff].filter((x) => !taken.has(x.id)).sort((a, b) => b.ability - a.ability || a.id - b.id).slice(0, P.top);
  if (!top.length) return;
  const x = top[Math.floor(hash01(s.seed, 86, m) * top.length)], act = activeRivals(s), r = act[Math.floor(hash01(s.seed, 87, m) * act.length)];
  const raise = Math.round(payOf(x) * P.raise);
  st.lastPoach = m;
  const text = `${r.name}${josa(r.name, '이/가')} ${x.name}(${ROLE_KO[x.role]}, 능력 ${x.ability})에게 이직을 제안했습니다. ${x.name}${josa(x.name, '은/는')} 회사에 남을 생각이지만 처우를 기대하고 있습니다.`;
  const results = [`월급을 ${won(raise)} 올립니다(지금 ${won(payOf(x))}). ${x.name}의 능력이 ${P.ability} 오르고 컨디션이 좋아집니다.`, `${x.name}${josa(x.name, '은/는')} 제안을 거절하고 남습니다. 달라지는 것은 없습니다.`];
  pushChoice(s, ev, 'poach', '이직 제안', text, { rivalId: r.id, staffId: x.id, raise, results });
}
function pushChoice(s: CarState, ev: GameEvent[], eventId: string, name: string, text: string, rv0: NonNullable<PendingChoice['rv']>): void {
  const id = s.nextId++;
  s.events.pending.push({ id, eventId, text, week: s.week, deadline: s.week + config.events.choiceWeeks, genId: null, fx: null, rv: rv0 });
  addNews(s, ev, `[${name}] ${text}`, 'choice', 'choice', id, 'rival');
}
/** 결정 창 선택의 효과(game.ts applyChoice가 부른다). 직원은 어느 선택이든 남는다 */
export function applyRivalChoice(s: CarState, pc: PendingChoice, type: 'warFollow' | 'retain' | 'none'): void {
  const st = rv(s), x = pc.rv;
  if (!x) return;
  if (x.war !== undefined) { const w = st.wars.find((y) => y.id === x.war); if (w && w.follow === null) w.follow = type === 'warFollow'; }
  if (type === 'retain' && x.staffId !== undefined) {
    const y = s.staff.find((z) => z.id === x.staffId);
    if (y) { y.pay = (y.pay ?? 0) + (x.raise ?? 0); y.ability = Math.min(100, y.ability + R.poach.ability); y.potential = Math.max(y.potential, y.ability); y.condition = Math.min(1, y.condition + R.poach.condition); }
  }
}
/** 위임(재무 임원 '가격 전쟁 대응', 인사 임원 '이직 제안 대응')의 자동 선택과 이유. 기준: 가격 전쟁은 버틸 때 잃는 판매가 매출 감소보다 크면 따라 내린다.
 *  이직 제안은 그 직원 능력이 같은 직무 평균 이상이면 붙잡는다 */
export function autoChoice(s: CarState, pc: PendingChoice): { choice: number; why: string } | null {
  const x = pc.rv;
  if (!x) return null;
  if (x.war !== undefined) {
    const w = rv(s).wars.find((y) => y.id === x.war);
    if (!w) return null;
    const e = warEstimate(s, w), follow = e.holdLoss >= w.cut;
    return { choice: follow ? 0 : 1, why: follow ? `버티면 판매가 약 ${pct(e.holdLoss)} 줄어 인하 폭(${pct(w.cut)})보다 손해가 커서 따라 내렸습니다.` : `버틸 때 줄어드는 판매(약 ${pct(e.holdLoss)})가 인하 폭(${pct(w.cut)})보다 작아 가격을 지켰습니다.` };
  }
  if (x.staffId !== undefined) {
    const y = s.staff.find((z) => z.id === x.staffId);
    if (!y) return { choice: 1, why: '대상 직원이 이미 다른 자리로 옮겼습니다.' };
    const same = s.staff.filter((z) => z.role === y.role), avg = same.reduce((a, z) => a + z.ability, 0) / same.length;
    return y.ability >= avg ? { choice: 0, why: `${y.name}의 능력(${y.ability})이 같은 직무 평균(${Math.round(avg)}) 이상이라 월급을 올려 붙잡았습니다.` } : { choice: 1, why: `${y.name}의 능력(${y.ability})이 같은 직무 평균(${Math.round(avg)})보다 낮아 그대로 두었습니다. ${y.name}${josa(y.name, '은/는')} 남습니다.` };
  }
  return null;
}

// ---------- 월말: 대응 신차 예고, 시상식 ----------
export function rivalryMonthEnd(s: CarState, ev: GameEvent[], m: number): { value: number; reason: string }[] {
  if (!R.on) return [];
  detectCounters(s, ev, m);
  return (m + 1) % MPY === 0 ? awards(s, ev, m) : [];
}
function detectCounters(s: CarState, ev: GameEvent[], m: number): void {
  const st = rv(s), C = R.counter;
  if (yearOfMonth(m) < C.from) return;
  const t = monthTime(m), sold = new Map<string, number>(), top = new Map<string, Generation>();
  for (const g of onSale(s)) { const n = g.sales.at(-1) ?? 0; sold.set(g.body, (sold.get(g.body) ?? 0) + n); if (n > (top.get(g.body)?.sales.at(-1) ?? -1)) top.set(g.body, g); }
  for (const body of [...sold.keys()].sort()) {
    const size = cellMonthly(body, t), share = size > 0 ? (sold.get(body) ?? 0) / size : 0;
    if (share < C.share || st.counters.some((c) => c.body === body) || (st.counterCool[body] ?? -1) > m) continue;
    const rs = rivalShares(s, body);
    if (!rs.length || rs.some((x) => x.share > share)) continue; // 점유율 1위일 때만
    const r = activeRivals(s).filter((x) => x.models[body]).sort((a, b) => (defOf(b.id).cells[body] ?? 0) - (defOf(a.id).cells[body] ?? 0) || (a.id < b.id ? -1 : 1))[0];
    const launch = m + C.delayMin + Math.floor(hash01(s.seed, 88, m, bodyKey(body)) * (C.delayMax - C.delayMin + 1)), target = nameOfGen(s, top.get(body)!);
    st.counters.push({ id: s.nextId++, rivalId: r.id, body, announced: m, launch, target });
    st.counterCool[body] = launch + C.cooldown;
    news(s, ev, `[대응 신차 예고] ${r.name}, ${bodyById(body).name} 차급에 「${target}」${josa(target, '을/를')} 겨냥한 신차를 준비 중. 약 ${launch - m}개월 뒤(${monthLabel(launch)}) 출시 예정.`);
  }
}
/** 시상 후보 한 대 */
interface Entry { who: Award['who']; company: string; car: string; body: string; critic: number; tech: number; design: number; genId?: number; subId?: number }
function entries(s: CarState, m: number): Entry[] {
  const W = R.awards.window, y = yearOfMonth(m), out: Entry[] = [];
  for (const g of onSale(s)) if (m - g.launchMonth < W) {
    const st = currentEdition(g).stats, gr = (k: 'P' | 'E' | 'U' | 'D' | 'Q') => grade(st[k], y);
    out.push({ who: 'mine', company: s.companyName, car: nameOfGen(s, g), body: g.body, critic: g.reviewAvg, tech: (gr('P') + gr('E') + gr('Q')) / 3, design: gr('D'), genId: g.id });
  }
  for (const sub of [...(s.subs ?? [])].sort((a, b) => a.id - b.id)) if (isBrand(sub.kind)) for (const md of sub.models) if (m - md.start < W) {
    const v = subModelView(s, sub, md);
    out.push({ who: 'sub', company: sub.name, car: md.name, body: md.body, critic: v.critic, tech: (v.grades.P + v.grades.E + v.grades.Q) / 3, design: v.grades.D, subId: sub.id });
  }
  s.rivals.forEach((r, ri) => { if (isOut(s, r.id)) return; for (const body of Object.keys(r.models).sort()) if (m - r.models[body].start < W) {
    const v = rivalModelView(s, ri, body);
    out.push({ who: 'rival', company: r.name, car: v.name, body, critic: v.critic, tech: (v.grades.P + v.grades.E + v.grades.Q) / 3, design: v.grades.D });
  } });
  return out;
}
function awards(s: CarState, ev: GameEvent[], m: number): { value: number; reason: string }[] {
  const A = R.awards, y = yearOfMonth(m), all = entries(s, m), st = rv(s), rep: { value: number; reason: string }[] = [], lines: string[] = [];
  A.cats.forEach((c, ci) => {
    const pool = all.filter((x) => !c.bodies || c.bodies.includes(x.body));
    if (!pool.length) return;
    const score = (x: Entry) => (c.score === 'critic' ? x.critic : c.score === 'tech' ? x.tech : x.design) + (hash01(s.seed, 89, y, ci, strKey(x.car)) * 2 - 1) * A.jitter;
    const win = pool.map((x) => ({ x, v: score(x) })).sort((a, b) => b.v - a.v || (a.x.car < b.x.car ? -1 : 1))[0].x;
    const label = `${y}년 ${c.name}`;
    st.awards.push({ year: y, cat: c.id, name: c.name, who: win.who, company: win.company, car: win.car, body: win.body, score: Math.round((c.score === 'critic' ? win.critic : c.score === 'tech' ? win.tech : win.design) * 10) / 10, ...(win.genId !== undefined ? { genId: win.genId } : {}), ...(win.subId !== undefined ? { subId: win.subId } : {}) });
    lines.push(`${c.name} 「${win.car}」(${win.company})`);
    if (win.who === 'mine') {
      const g = s.nameplates.flatMap((n) => n.generations).find((x) => x.id === win.genId)!;
      (g.awards ??= []).push(label); g.awardUntil = m + 1 + A.boostMonths; g.awareness = Math.min(1, g.awareness + A.awareness);
      rep.push({ value: c.rep, reason: `「${win.car}」 ${label}` });
    } else if (win.who === 'sub') {
      const sub = subById(s, win.subId!)!, md = sub.models.find((x) => x.name === win.car)!;
      (md.awards ??= []).push(label); md.awardUntil = m + 1 + A.boostMonths; sub.rep += A.subRep;
    }
  });
  if (st.awards.length > A.keep) st.awards.splice(0, st.awards.length - A.keep);
  if (lines.length) {
    const mineWon = lines.length && st.awards.filter((a) => a.year === y && a.who !== 'rival').length;
    addNews(s, mineWon ? ev : [], `[${y}년 자동차 시상식] ${lines.join(', ')}.`, 'other', 'news', undefined, 'launch');
  }
  return rep;
}

// ---------- 인재 ----------
function hashName(s: CarState, k: number): string {
  const used = new Set([...s.staff, ...s.candidates, ...rv(s).talent].map((x) => x.name));
  for (let i = 0; i < 20; i++) {
    const n = NAMES.family[Math.floor(hash01(s.seed, 90, k, i) * NAMES.family.length)] + NAMES.given[Math.floor(hash01(s.seed, 91, k, i) * NAMES.given.length)];
    if (!used.has(n)) return n;
  }
  return `${NAMES.family[0]}${NAMES.given[k % NAMES.given.length]}`;
}
function refreshTalent(s: CarState, m: number): void {
  const st = rv(s), T = R.talent, act = activeRivals(s), roles: Role[] = ['designer', 'engineer', 'tester', 'sales'];
  st.talentMonth = m;
  if (!act.length) return;
  const top = [...s.staff].sort((a, b) => b.ability - a.ability).slice(0, 3), avg = top.length ? top.reduce((a, x) => a + x.ability, 0) / top.length : T.minAbility;
  st.talent = Array.from({ length: T.count }, (_, k) => {
    const r = act[Math.floor(hash01(s.seed, 92, m, k) * act.length)], role = roles[Math.floor(hash01(s.seed, 93, m, k) * (roles.length - 1 + (k === T.count - 1 ? 1 : 0)))];
    const ability = Math.round(Math.min(T.maxAbility, Math.max(T.minAbility, avg + T.addMin + hash01(s.seed, 94, m, k) * (T.addMax - T.addMin))));
    const pay = Math.round(salaryOf(ability) * T.payPremium);
    return { id: s.nextId++, rivalId: r.id, name: hashName(s, m * 8 + k), role, ability, potential: Math.min(100, ability + 3 + Math.floor(hash01(s.seed, 95, m, k) * 6)), pay, fee: (salaryOf(ability) + pay) * T.feeMonths, until: m + T.refreshMonths };
  });
}
/** 경쟁사 인재를 영입할 수 없는 이유 */
export function talentError(s: CarState, id: number): string | null {
  const t = s.rivalry?.talent.find((x) => x.id === id);
  if (!t) return '없는 후보입니다.';
  if (s.staff.length >= staffCap(s)) return `직원 정원(${staffCap(s)}명)이 찼습니다.`;
  if (s.cash < t.fee) return `현금이 모자랍니다(영입비 ${won(t.fee)}).`;
  return null;
}

// ---------- 기술 제휴 ----------
/** 계약금 = 지금 앞뒤 5년에 나온 기술의 평균 연구비 × feeTechs */
export function allianceFee(s: CarState): number {
  const y = yearOf(s.week), near = TECHS.filter((t) => Math.abs(t.year - y) <= 5);
  const list = near.length ? near : TECHS;
  return Math.round(list.reduce((a, t) => a + t.cost.money, 0) / list.length * R.alliance.feeTechs / 100) * 100;
}
export function allianceError(s: CarState, id: string): string | null {
  const st = s.rivalry, A = R.alliance;
  if (!s.rivals.some((r) => r.id === id) || isOut(s, id)) return '없는 경쟁사입니다.';
  if (s.hqLevel < A.hqMin) return `기술 제휴는 본사 ${A.hqMin}등급부터 맺을 수 있습니다.`;
  if (st?.alliances.some((a) => a.rivalId === id)) return '이미 제휴 중입니다.';
  if ((st?.alliances.length ?? 0) >= A.max) return `기술 제휴는 동시에 ${A.max}곳까지 맺을 수 있습니다.`;
  if (s.cash < allianceFee(s)) return `현금이 모자랍니다(계약금 ${won(allianceFee(s))}).`;
  return null;
}
/** 제휴 중인 곳 수만큼 연구 속도 가산 */
export const allianceSpeed = (s: Pick<CarState, 'rivalry'>): number => (s.rivalry?.alliances.length ?? 0) * R.alliance.speed;
/** 제휴한 경쟁사에서 사 올 수 있는 기술: 그 회사가 앞선 분야, 그해까지 나온 것, 선행 기술 완료, 아직 안 한 것(반복 기술 제외) */
export function buyableTechs(s: CarState, id: string): { id: string; name: string; year: number; cost: number; desc: string }[] {
  const f = defOf(id).field, y = yearOf(s.week);
  return TECHS.filter((t) => t.field === f && !t.repeatable && t.year <= y && !isDone(s, t.id) && t.pre.every((q) => isDone(s, q)))
    .map((t) => ({ id: t.id, name: t.name, year: t.year, cost: Math.round(researchCost(s, t).money * R.alliance.buyMult), desc: t.desc }));
}

// ---------- 상장 ----------
/** 평가액 = 자본 + 지난 12개월 이익 × per(손실이면 자본만) */
export function subValue(sub: Subsidiary): number {
  const p12 = sub.months.slice(-MPY).reduce((a, x) => a + x.profit, 0);
  return Math.max(0, sub.capital) + Math.max(0, p12) * R.ipo.per;
}
export function listError(s: CarState, sub: Subsidiary, pctTotal: number): string | null {
  const I = R.ipo, m = monthOf(s.week), cur = Math.round((sub.listed ?? 0) * 100);
  if (!isBrand(sub.kind)) return '상장은 브랜드 자회사만 할 수 있습니다.';
  if (!I.steps.includes(pctTotal)) return `상장 지분은 ${I.steps.join('·')}% 중에서 고르세요.`;
  if (pctTotal <= cur) return cur >= I.steps[I.steps.length - 1] ? `이미 ${cur}%를 팔았습니다. ${I.steps[I.steps.length - 1]}%까지만 팔 수 있습니다.` : `이미 ${cur}%를 팔았습니다. 그보다 큰 지분을 고르세요.`;
  if (m - sub.founded < I.years * MPY) return `설립(인수) 뒤 ${I.years}년이 지나야 상장할 수 있습니다(${monthLabel(sub.founded + I.years * MPY)}부터).`;
  if (sub.months.slice(-MPY).reduce((a, x) => a + x.profit, 0) <= 0) return '지난 12개월 흑자여야 상장할 수 있습니다.';
  return null;
}

// ---------- 인수 ----------
/** 경쟁사의 연 매출 어림(칸 규모 × 점유 × 시장 기준가)과 값 */
export function rivalValue(s: CarState, id: string): { revenue: number; value: number; price: number; monthly: number } {
  const r = s.rivals.find((x) => x.id === id)!, t = monthTime(monthOf(s.week)), A = R.acquire;
  let revenue = 0, monthly = 0;
  for (const body of Object.keys(r.models).sort()) {
    const sh = rivalShares(s, body).find((x) => x.id === id)?.share ?? 0, n = sh * cellMonthly(body, t);
    monthly += n; revenue += n * basePriceOf(s, body) * MPY;
  }
  const value = revenue * A.salesMult;
  return { revenue, value, price: Math.max(A.minPrice, Math.round(value * (1 + A.premium) / 10000) * 10000), monthly };
}
export function acquireError(s: CarState, id: string): string | null {
  const A = R.acquire, max = config.subs.maxByHq[s.hqLevel - 1] ?? 0;
  if (!s.rivals.some((r) => r.id === id) || isOut(s, id)) return '없는 경쟁사입니다.';
  if (s.hqLevel < A.hqMin) return `경쟁사 인수는 본사 ${A.hqMin}등급(${config.hq.levels[A.hqMin - 1].name})부터 할 수 있습니다.`;
  if (activeRivals(s).length <= 1) return '마지막 남은 경쟁사는 인수할 수 없습니다. 독점 규제로 공정거래 당국이 승인하지 않습니다.';
  if ((s.subs?.length ?? 0) >= max) return `자회사를 더 둘 수 없습니다(본사 ${s.hqLevel}등급 상한 ${max}곳). 인수한 회사도 자회사 수에 들어갑니다.`;
  const p = rivalValue(s, id).price;
  if (s.cash < p) return `현금이 모자랍니다(인수 값 ${won(p)}).`;
  return null;
}
/** 인수 창: 평가액·웃돈·값, 인수 뒤 예상 실적(월 판매·연 매출·연 이익·연 배당). 상태를 복사해 인수한 것처럼 만든 뒤 월 결산과 같은 계산(brandMonth)으로 이번 달을 셈해 12배 한다 */
export function acquireInfo(s: CarState, id: string) {
  const ri = riOf(s, id);
  if (ri < 0 || isOut(s, id)) return null;
  const v = rivalValue(s, id), m = monthOf(s.week), r = s.rivals[ri];
  const c: CarState = JSON.parse(JSON.stringify(s)), sub = buildAcquired(c, ri, v.price), ghost = R.acquire.absorb ** (1 / config.market.shareExp);
  rv(c).out.push(id); for (const b of Object.keys(c.rivals[ri].cells)) c.rivals[ri].cells[b] *= ghost; // 월말 applyCells와 같은 빈 몫
  (c.subs ??= []).push(sub);
  const b = brandMonth(c, sub, m), profit = (b.revenue - b.cost - brandFixed(sub, b.sold)) * MPY;
  return { id, name: r.name, newName: sub.name, color: sub.color, models: sub.models.length, revenue: v.revenue, value: v.value, premium: v.price - v.value, price: v.price, capital: sub.capital, rep: sub.rep,
    rivalMonthly: Math.round(v.monthly), monthly: b.sold, yearRevenue: b.revenue * MPY, yearProfit: profit, yearDividend: Math.max(0, profit) * Math.min(1, sub.dividend / 100 * config.subs.strat.growth.payout), reason: acquireError(s, id) };
}

// ---------- 명령 ----------
export interface RivalryCtx { s: CarState; spend(c: number): void }
const fail = (reason: string): CommandResult => ({ ok: false, reason });
export function rivalryCommand(c: RivalryCtx, cmd: Command): CommandResult | null {
  const s = c.s, m = monthOf(s.week), ev: GameEvent[] = [];
  switch (cmd.type) {
    case 'hireRivalTalent': {
      const err = talentError(s, cmd.talentId); if (err) return fail(err);
      const st = rv(s), t = st.talent.find((x) => x.id === cmd.talentId)!, r = s.rivals.find((x) => x.id === t.rivalId)!;
      c.spend(t.fee);
      const x: Staff = startHist({ id: s.nextId++, name: t.name, role: t.role, ability: t.ability, potential: t.potential, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false, pay: t.pay, from: t.rivalId }, s.week);
      s.staff.push(x);
      st.talent = st.talent.filter((y) => y !== t);
      st.weak[r.id] = Math.min(R.talent.weakMax, (st.weak[r.id] ?? 0) + R.talent.weaken);
      news(s, ev, `${s.companyName}, ${r.name}의 ${ROLE_KO[t.role]} ${t.name}(능력 ${t.ability})${josa(t.name, '을/를')} 영입했습니다. 영입비 ${won(t.fee)}. ${r.name}의 차가 조금 약해집니다(인재 유출 −${pct(st.weak[r.id])}).`);
      return { ok: true, events: ev };
    }
    case 'allyRival': {
      const err = allianceError(s, cmd.rivalId); if (err) return fail(err);
      const fee = allianceFee(s), r = s.rivals.find((x) => x.id === cmd.rivalId)!;
      c.spend(fee); s.pendingResearch = (s.pendingResearch ?? 0) + fee;
      rv(s).alliances.push({ rivalId: r.id, from: m, until: m + R.alliance.months, fee });
      news(s, ev, `${s.companyName}, ${r.name}${josa(r.name, '과/와')} 기술 제휴. 계약금 ${won(fee)}, ${R.alliance.months}개월. 연구 속도 +${pct(R.alliance.speed)}.`);
      return { ok: true, events: ev };
    }
    case 'endAlliance': {
      const st = rv(s), a = st.alliances.find((x) => x.rivalId === cmd.rivalId);
      if (!a) return fail('제휴 중인 회사가 아닙니다.');
      st.alliances = st.alliances.filter((x) => x !== a); // 계약금은 돌아오지 않는다
      log(s, `${s.rivals.find((x) => x.id === cmd.rivalId)?.name ?? ''}와의 기술 제휴를 끝냈습니다.`);
      return { ok: true };
    }
    case 'buyRivalTech': {
      if (!rv(s).alliances.some((a) => a.rivalId === cmd.rivalId)) return fail('제휴 중인 경쟁사에서만 기술을 사 올 수 있습니다.');
      const b = buyableTechs(s, cmd.rivalId).find((x) => x.id === cmd.techId);
      if (!b) return fail('그 회사에서 사 올 수 있는 기술이 아닙니다.');
      if (s.cash < b.cost) return fail(`현금이 모자랍니다(${won(b.cost)}).`);
      c.spend(b.cost); s.pendingResearch = (s.pendingResearch ?? 0) + b.cost;
      s.research.active = s.research.active.filter((a) => a.techId !== b.id); // 진행 중이었으면 그 점수는 버린다
      if (s.research.priority === b.id) delete s.research.priority;
      s.research.done.push(b.id);
      const rn = s.rivals.find((x) => x.id === cmd.rivalId)!.name;
      ev.push({ kind: 'unlock', category: 'research', text: `${rn}에서 「${techById(b.id).name}」 기술을 ${won(b.cost)}에 사 왔습니다. 연구를 마친 것으로 처리합니다.` });
      log(s, `${rn}에서 「${b.name}」 기술을 ${won(b.cost)}에 사 왔습니다.`);
      return { ok: true, events: ev };
    }
    case 'listSub': {
      const sub = subById(s, cmd.subId); if (!sub) return fail('없는 자회사입니다.');
      const err = listError(s, sub, cmd.pct); if (err) return fail(err);
      const add = cmd.pct / 100 - (sub.listed ?? 0), cash = Math.round(subValue(sub) * add);
      c.spend(-cash);
      sub.listed = cmd.pct / 100; sub.listedMonth ??= m;
      const t = `${s.companyName}, 자회사 「${sub.name}」 지분 ${Math.round(add * 100)}%를 상장해 ${won(cash)}${josa(won(cash), '을/를')} 받았습니다. 평가액 ${won(subValue(sub))}. 앞으로 배당은 본사 지분 ${Math.round((1 - sub.listed) * 100)}%만큼 받습니다.`;
      addNews(s, ev, t, 'sub', 'news', sub.id, 'sub'); sub.reports.push({ week: s.week, text: t });
      return { ok: true, events: ev };
    }
    case 'acquireRival': {
      const err = acquireError(s, cmd.rivalId); if (err) return fail(err);
      const st = rv(s), ri = riOf(s, cmd.rivalId), r = s.rivals[ri], { price } = rivalValue(s, cmd.rivalId), sub = buildAcquired(s, ri, price);
      s.nextId++; // buildAcquired가 쓴 ID
      c.spend(price); s.pendingSubInv = (s.pendingSubInv ?? 0) + price;
      (s.subs ??= []).push(sub);
      st.out.push(r.id);
      for (const w of st.wars.filter((x) => x.rivalId === r.id)) st.wars = st.wars.filter((x) => x !== w);
      st.counters = st.counters.filter((x) => x.rivalId !== r.id); st.alliances = st.alliances.filter((x) => x.rivalId !== r.id); st.talent = st.talent.filter((x) => x.rivalId !== r.id);
      s.events.pending = s.events.pending.filter((p) => p.rv?.rivalId !== r.id);
      for (const x of s.subs) if (x.rivalId === r.id) x.rivalId = null;
      const t = `${s.companyName}, ${r.name}${josa(r.name, '을/를')} ${won(price)}에 인수했습니다. ${r.name}${josa(r.name, '은/는')} 경쟁사 목록에서 빠지고 인수 브랜드 「${sub.name}」로 모델 ${sub.models.length}종을 이어 팝니다.`;
      news(s, ev, t); sub.reports.push({ week: s.week, text: t });
      return { ok: true, events: ev };
    }
    default: return null;
  }
}

// ---------- 조회(화면용) ----------
export interface RivalRelation {
  id: string; name: string; color: string; trait: string; field: string; out: boolean; weak: number;
  alliance: { until: number; monthsLeft: number } | null; allianceError: string | null; allianceFee: number; buyable: ReturnType<typeof buyableTechs>;
  war: { body: string; bodyName: string; cut: number; monthsLeft: number; follow: boolean | null } | null;
  counters: { body: string; bodyName: string; monthsLeft: number; target: string }[];
  talent: { id: number; name: string; role: Role; roleName: string; ability: number; potential: number; pay: number; salary: number; fee: number; monthsLeft: number; reason: string | null }[];
  acquire: { price: number; reason: string | null };
}
const FIELD_KO: Record<string, string> = { powertrain: '동력', body: '차체·안전', electronics: '편의 장비', production: '생산', eco: '친환경' };
export function rivalRelations(s: CarState): RivalRelation[] {
  const st = s.rivalry ?? emptyRivalry(), m = monthOf(s.week);
  return s.rivals.map((r) => {
    const d = defOf(r.id), a = st.alliances.find((x) => x.rivalId === r.id), w = st.wars.find((x) => x.rivalId === r.id && m >= x.from && m < x.until), out = isOut(s, r.id);
    return {
      id: r.id, name: r.name, color: d.color, trait: d.trait, field: FIELD_KO[d.field], out, weak: st.weak[r.id] ?? 0,
      alliance: a ? { until: a.until, monthsLeft: a.until - m } : null, allianceError: out ? null : allianceError(s, r.id), allianceFee: allianceFee(s), buyable: a ? buyableTechs(s, r.id) : [],
      war: w ? { body: w.body, bodyName: bodyById(w.body).name, cut: w.cut, monthsLeft: w.until - m, follow: w.follow } : null,
      counters: st.counters.filter((x) => x.rivalId === r.id).map((x) => ({ body: x.body, bodyName: bodyById(x.body).name, monthsLeft: x.launch - m, target: x.target })),
      talent: st.talent.filter((x) => x.rivalId === r.id).map((x) => ({ id: x.id, name: x.name, role: x.role, roleName: ROLE_KO[x.role], ability: x.ability, potential: x.potential, pay: x.pay, salary: salaryOf(x.ability) + x.pay, fee: x.fee, monthsLeft: x.until - m, reason: talentError(s, x.id) })),
      acquire: out ? { price: 0, reason: null } : { price: rivalValue(s, r.id).price, reason: acquireError(s, r.id) },
    };
  });
}
/** 시상식 이력(최근 해가 앞) */
export function awardHistory(s: CarState): { year: number; list: Award[] }[] {
  const by = new Map<number, Award[]>();
  for (const a of s.rivalry?.awards ?? []) (by.get(a.year) ?? by.set(a.year, []).get(a.year)!).push(a);
  return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([year, list]) => ({ year, list }));
}
/** 경쟁사 관계 기록(최근 것이 앞) */
export const rivalryLog = (s: CarState) => [...(s.rivalry?.log ?? [])].reverse();
