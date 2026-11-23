// 2.0.0 경쟁 1부: 경쟁사 모델의 이름과 겉으로 보이는 값. 모두 시드·저장된 모델(market.ts RivalModel)에서 셈하는 표시용 파생값이며 저장하지 않는다.
// 판매 계산(market.ts)과 게임 난수는 건드리지 않는다(해시만 쓴다). 수치는 config.rivals.view
import { config } from '../config';
import { RIVALS, bodyById } from '../data';
import { addNews, rivalHitAdd } from './events';
import { josa } from './josa';
import { basePriceOf, bodyKey, cellMonthly, rivalBase, rivalCycle, subPull, updateRivals } from './market';
import { hash01 } from './rng';
import { monthOf, monthTime, yearOfMonth } from './time';
import { STATS, type CarState, type GameEvent, type RivalDef, type Stats } from './types';

const V = config.rivals.view;
const defOf = (id: string): RivalDef => RIVALS.find((x) => x.id === id)!;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

/** 모델 이름: 회사 이름 목록을 시드로 섞어 차체 순서대로 나눈다(같은 판 안에서 겹치지 않고, 세대가 바뀌어도 그대로). ri: 경쟁사 순번(state.rivals 순) */
export function rivalModelName(seed: number, ri: number, id: string, body: string): string {
  const d = defOf(id), order = d.models.map((n, i) => [hash01(seed, 8, ri, i), n] as const).sort((a, b) => a[0] - b[0]);
  return order[Object.keys(d.cells).sort().indexOf(body)]?.[1] ?? bodyById(body).name;
}

/** 지난 세대 포함 한 칸의 세대 목록(오래된 것부터). 시작 달은 지금 모델에서 주기를 거꾸로 빼서 셈하고, 기본 A는 갱신 규칙(updateRivals)의 해시로 다시 셈한다.
 *  첫 모델(n = 0)의 강약 난수는 게임 난수라 지금 모델이 아니면 알 수 없어 0으로 본다(늦게 더한 칸은 해시라 정확) */
export interface RivalGen { n: number; number: number; start: number; year: number; critic: number; hit: boolean; d: number }
export function rivalHistory(s: CarState, ri: number, body: string): RivalGen[] {
  const r = s.rivals[ri], md = r.models[body], cell = defOf(r.id).cells[body] ?? 0, key = bodyKey(body), noise = config.rivals.noise;
  const out: RivalGen[] = [];
  for (let n = md.n, start = md.start; n >= 0; n--) {
    if (n < md.n) start -= rivalCycle(s.seed, ri, body, n);
    const late = (config.rivals.lateCells as readonly string[]).includes(body);
    const nz = n === md.n ? md.base - rivalBase(Math.max(0, start)) - cell : n > 0 ? (hash01(s.seed, 3, ri, key, n) * 2 - 1) * noise : late ? (hash01(s.seed, 4, ri, key) * 2 - 1) * noise : 0;
    const d = cell + nz;
    out.push({ n, number: n + 1, start, year: yearOfMonth(start), critic: r1(clamp(V.criticMid + d * V.criticPer, 1, 10)), hit: nz >= V.hitAt * noise, d });
  }
  return out.reverse();
}

/** 지금 팔리는 경쟁 모델 하나의 겉으로 보이는 값. grades: 지금 그해 기준 능력치 등급(나이 들수록 내려간다), price: 시장 기준가 근처(만원), share: 그 칸에서의 대략적 점유 */
export interface RivalModelView extends RivalGen { rivalId: string; company: string; body: string; name: string; grades: Stats; price: number; share: number; seed: number }
export function rivalModelView(s: CarState, ri: number, body: string): RivalModelView {
  const r = s.rivals[ri], md = r.models[body], m = monthOf(s.week), def = defOf(r.id), g = rivalHistory(s, ri, body).at(-1)!;
  const now = g.critic - (1 - r.cells[body] / (md.base * (1 + config.rivals.fresh))) * V.criticPer; // 지금 세기: 출시 때 평론에서 낡은 만큼(새 모델 A 대비 줄어든 비율 × criticPer) 뺀다
  const grades = Object.fromEntries(STATS.map((k, i) => [k, r1(clamp(now + def.shape[k] + (hash01(s.seed, 9, ri, bodyKey(body), md.n, i) * 2 - 1) * V.statJitter, 0, 10))])) as Stats;
  const e = config.market.shareExp, tot = s.rivals.reduce((a, q) => a + (q.cells[body] ?? 0) ** e, 0) + subPull(s, body); // 3.0.0 자회사 모델도 그 칸을 나눠 갖는다
  const share = tot > 0 ? (1 - myCellShare(s, body)) * (r.cells[body] ?? 0) ** e / tot : 0; // 내 몫을 뺀 나머지를 경쟁 차 A^지수로 나눈다(고객층·사건은 무시한 어림)
  return { ...g, hit: g.hit || rivalHitAdd(s, r.id, body, m) > 0, rivalId: r.id, company: r.name, body, name: rivalModelName(s.seed, ri, r.id, body), grades,
    price: Math.round(basePriceOf(s, body) * (1 + (g.critic - V.criticMid) * V.pricePer) / 10) * 10, share, seed: Math.floor(hash01(s.seed, 10, ri, bodyKey(body), md.n) * 2 ** 31) };
}
/** 내 회사의 그 칸 점유(지난달 판매 ÷ 칸 월 규모, 0~1) */
export function myCellShare(s: CarState, body: string): number {
  let mine = 0;
  for (const n of s.nameplates) for (const x of n.generations) if (x.body === body && x.status !== 'discontinued') mine += x.sales.at(-1) ?? 0;
  const size = cellMonthly(body, monthTime(monthOf(s.week)));
  return size > 0 ? Math.min(1, mine / size) : 0;
}
/** 한 차체 칸의 경쟁 모델(경쟁사 순) */
export const rivalModelsIn = (s: CarState, body: string): RivalModelView[] => s.rivals.flatMap((r, ri) => (r.models[body] ? [rivalModelView(s, ri, body)] : []));
/** 경쟁사 하나의 라인업(차체 순)과 한 줄 성격 */
export function rivalLineup(s: CarState, id: string): { name: string; trait: string; desc: string; models: RivalModelView[] } | null {
  const ri = s.rivals.findIndex((r) => r.id === id);
  if (ri < 0) return null;
  const d = defOf(id);
  return { name: s.rivals[ri].name, trait: d.trait, desc: d.desc, models: Object.keys(s.rivals[ri].models).sort().map((b) => rivalModelView(s, ri, b)) };
}

/** 월말: 경쟁 차 갱신(updateRivals) + 세대가 바뀐 칸마다 뉴스 한 줄. 내가 그 칸에 차를 팔고 있으면 관련을 덧붙이고 알림(이벤트)도 낸다.
 *  늦은 시작의 과거 갱신(start.ts)은 이것을 거치지 않으므로 지난 세대교체 뉴스가 쏟아지지 않는다 */
export function updateRivalsWithNews(s: CarState, ev: GameEvent[], m: number): void {
  const before = s.rivals.map((r) => Object.fromEntries(Object.entries(r.models).map(([b, md]) => [b, md.n])));
  updateRivals(s.rivals, s.seed, m);
  s.rivals.forEach((r, ri) => {
    for (const body of Object.keys(r.models).sort()) {
      if (r.models[body].n === before[ri][body]) continue;
      const v = rivalModelView(s, ri, body), bn = bodyById(body).name;
      const mine = s.nameplates.find((n) => n.generations.some((g) => g.body === body && g.status !== 'discontinued'))?.name;
      const text = `${r.name}, ${v.name} ${v.number}세대 출시. ${mine ? `「${mine}」${josa(mine, '과/와')} 같은 ${bn}` : bn}, 추정 평론 ${v.critic.toFixed(1)}.${v.hit ? ' 이 회사의 평소 모델보다 뚜렷이 강한 히트작이다.' : ''}`;
      addNews(s, mine ? ev : [], text, 'rival', 'news', undefined, 'rival');
    }
  });
}
