// 차종의 일생(설계서 8장): 페이스리프트·풀체인지 조건, 차종 자산, 3D 모양 후보, 기획 첫 화면 목록. 순수 함수(상태를 바꾸지 않는다)
import { config } from '../config';
import { avgGrade, grade } from './cars';
import { currentEdition } from './market';
import { hash32 } from './rng';
import { regulationBlock, requiredOptions } from './events';
import { bodyById, optionById } from '../data';
import { monthOf, yearOf } from './time';
import { STATS, type CarState, type Generation, type Nameplate, type Stat, type Stats } from './types';

const L = config.lifecycle;
const gens = (s: CarState): Generation[] => s.nameplates.flatMap((n) => n.generations);
export const nameplateById = (s: CarState, id: number): Nameplate | undefined => s.nameplates.find((n) => n.id === id);
export const latestGen = (n: Nameplate): Generation => n.generations[n.generations.length - 1];
const genAge = (s: CarState, g: Generation): number => monthOf(s.week) - g.launchMonth;

/** 조건 판정 결과: ok면 reason null. monthsLeft: 시간만 지나면 되는 경우 남은 개월(아니면 0) */
export interface Eligibility { ok: boolean; reason: string | null; monthsLeft: number }
const yes: Eligibility = { ok: true, reason: null, monthsLeft: 0 };
const no = (reason: string, monthsLeft = 0): Eligibility => ({ ok: false, reason, monthsLeft });
/** 0.4.2: 규제 의무 장비의 기술을 연구하지 않았으면 새 개발을 시작할 수 없다 */
const regulated = (s: CarState): Eligibility => { const b = regulationBlock(s); return b ? no(b) : yes; };

/** 페이스리프트의 연식 개선(0.4.2): 디자인 밖의 능력치 × (1 + refresh). 디자인은 디자이너 점수(상한 dCap)로 따로 오른다 */
export function faceliftRefresh(st: Stats): Stats { for (const k of STATS) if (k !== 'D') st[k] *= 1 + L.facelift.refresh; return st; }

/** 0.4.2 의무 장비 추가(retrofit): 판매 중인 세대의 지금 판에 빠진 의무 장비, 일시 비용, 대당 원가 상승. 할 수 없으면 reason */
export interface RetrofitInfo { needed: boolean; options: string[]; cost: number; unitCostAdd: number; ok: boolean; reason: string | null }
export function retrofitInfo(s: CarState, generationId: number): RetrofitInfo {
  const g = gens(s).find((x) => x.id === generationId);
  const ed = g ? g.editions[g.editions.length - 1] : undefined, options = ed ? requiredOptions(s).filter((o) => !ed.options.includes(o)) : [];
  const cost = g ? Math.max(L.retrofit.min, g.devCost * L.retrofit.costShare) : 0, unitCostAdd = options.reduce((a, o) => a + optionById(o).cost, 0);
  const reason = !g ? '없는 세대입니다.' : g.status !== 'onSale' ? '판매 중인 세대만 장비를 추가할 수 있습니다.' : !options.length ? '추가할 의무 장비가 없습니다.'
    : regulationBlock(s) ?? (s.cash < cost ? '현금이 모자랍니다.' : null);
  return { needed: options.length > 0 && g?.status === 'onSale', options, cost, unitCostAdd, ok: reason === null, reason };
}

/** 페이스리프트 가능 여부(8.2): 판매 중, 출시 18개월 뒤, 세대당 1회, 이미 진행 중이 아님 */
export function faceliftEligibility(s: CarState, generationId: number): Eligibility {
  const g = gens(s).find((x) => x.id === generationId);
  if (!g) return no('없는 세대입니다.');
  if (g.status !== 'onSale') return no('판매 중인 세대만 페이스리프트할 수 있습니다.');
  if (g.editions.some((e) => e.kind === 'facelift')) return no('이 세대는 이미 페이스리프트를 했습니다(세대당 1회).');
  if (s.projects.some((p) => p.kind === 'facelift' && p.targetId === g.id)) return no('이 세대의 페이스리프트를 이미 개발하고 있습니다.');
  if (s.projects.some((p) => p.kind === 'fix' && p.targetId === g.id)) return no('이 세대의 긴급 개선이 진행 중입니다. 끝난 뒤에 할 수 있습니다.');
  if (g.clearance) return no('가격 인하 판매 중인 차는 페이스리프트할 수 없습니다.');
  const left = L.facelift.afterMonths - genAge(s, g);
  if (left > 0) return no(`출시 후 ${L.facelift.afterMonths}개월이 지나야 합니다. 앞으로 ${left}개월 남았습니다.`, left);
  return regulated(s);
}

/** 풀체인지 가능 여부(8.3): 현 세대 출시 36개월 뒤이거나 단종(신청 포함) 상태, 다음 세대를 이미 개발 중이 아님 */
export function fullChangeEligibility(s: CarState, nameplateId: number): Eligibility {
  const n = nameplateById(s, nameplateId);
  if (!n || !n.generations.length) return no('없는 차종입니다.');
  if (n.baseOf !== undefined) return no('파생 모델은 바탕 차의 새 세대로 다음 세대를 만듭니다(파생 모델 개발).'); // 1.3.0
  if (s.projects.some((p) => p.kind === 'fullchange' && p.targetId === n.id)) return no('이 차종의 풀체인지(다음 세대)를 이미 개발하고 있습니다.');
  const g = latestGen(n);
  if (g.status !== 'onSale') return regulated(s);
  const left = L.fullChange.afterMonths - genAge(s, g);
  if (left > 0) return no(`출시 후 ${L.fullChange.afterMonths}개월이 지나야 합니다. 앞으로 ${left}개월 남았습니다.`, left);
  return regulated(s);
}

/** 차종 자산(8.3, 0~0.3) = clamp(0.03 × 전 세대 평론 − 0.12, 0, 0.2) + min(0.1, 차종 누적 판매/50만), 전 세대에 리콜이 있었으면 −0.05 */
export function nameplateEquity(s: CarState, nameplateId: number): number {
  const n = nameplateById(s, nameplateId);
  if (!n || !n.generations.length) return 0;
  const f = L.fullChange, g = latestGen(n), sold = n.generations.reduce((a, x) => a + x.totalSold, 0);
  const review = Math.min(f.equityReviewMax, Math.max(0, f.equityPerReview * g.reviewAvg - f.equityReviewBase));
  const v = review + Math.min(f.equitySalesMax, sold / f.equitySalesDiv) + (g.recalls > 0 ? f.recallEquity : 0);
  return Math.min(f.equityMax, Math.max(0, v));
}

/** 풀체인지가 실제로 이어받는 자산: 차체를 바꾸면 절반, 단종 36개월이 넘었으면 "부활"로 절반 */
export function carriedEquity(s: CarState, nameplateId: number, body: string): { equity: number; base: number; bodyChanged: boolean; revival: boolean } {
  const n = nameplateById(s, nameplateId), base = nameplateEquity(s, nameplateId);
  if (!n || !n.generations.length) return { equity: 0, base: 0, bodyChanged: false, revival: false };
  const f = L.fullChange, g = latestGen(n);
  const bodyChanged = g.body !== body;
  const revival = g.status === 'discontinued' && g.endMonth !== null && monthOf(s.week) - g.endMonth > f.revivalMonths;
  return { equity: base * (bodyChanged ? f.newBodyEquity : 1) * (revival ? f.revivalEquity : 1), base, bodyChanged, revival };
}

/** 전작 비교(8.3, 0.4.2): 원점수(절대 성능)로 비교한다. 차체 배수를 나눈 값(차체를 바꿔도 같은 잣대)으로, 새 세대의 어느 능력치든 전 세대 마지막 판보다 2% 넘게 낮으면 worse,
 *  모두 낮지 않고 평균이 10% 이상 높으면 better, 그 밖은 same. body: 새 세대 차체. (예전: 출시 당시 표시 등급 평균. 기준 상승 탓에 꾸준히 연구해도 절반 넘게 감점이었다) */
export function compareToPrev(prev: Generation, stats: Stats, body: string): 'better' | 'worse' | 'same' {
  const f = L.fullChange, mo = bodyById(prev.body).mult, mn = bodyById(body).mult, last = prev.editions[prev.editions.length - 1].stats;
  const o = (k: Stat) => last[k] / mo[k], n = (k: Stat) => stats[k] / mn[k], avg = (x: (k: Stat) => number) => STATS.reduce((a, k) => a + x(k), 0) / STATS.length;
  if (avg(n) < avg(o) * (1 - f.worseTolerance)) return 'worse';
  return avg(n) >= avg(o) * (1 + f.betterShare) ? 'better' : 'same';
}

/** 세대의 출시 당시 표시 등급 평균(화면·봇 참고용) */
export const launchAvgGrade = (g: Generation): number => avgGrade(g.editions[0].stats, yearOf(g.launchWeek));
/** 기존 고객 재구매(8.3): 전 세대 누적 판매 × 3% ÷ 12 (매달). 전 세대 품질 등급(마지막 판 출시 당시)이 5 미만이면 0 */
export function rebuyPerMonth(prev: Generation): number {
  const f = L.fullChange, ed = currentEdition(prev);
  return grade(ed.stats.Q, yearOf(ed.launchWeek)) < f.rebuyMinQ ? 0 : (prev.totalSold * f.rebuyShare) / f.rebuyMonths;
}

// ---------- 3D 모양 후보(8.5) ----------
export type LookKind = 'face' | 'chassis';
/** 후보를 무엇에 쓸지: facelift = 지금 세대의 새 얼굴, nextGen = 다음 세대(새 차종이면 1세대)의 차대·얼굴 */
export type LookTarget = 'facelift' | 'nextGen';
/**
 * 모양 후보 시드 3개. 게임 시드·차종 ID·세대 번호·판 번호·종류를 섞은 순수 해시(게임 난수를 쓰지 않는다, 같은 입력 = 같은 후보).
 * nameplateId = 0은 새 차종(지금까지 만든 차종 수를 섞어 차종마다 다르게).
 * target을 빼면: 얼굴은 판매 중이고 아직 페이스리프트하지 않은 세대가 있으면 facelift, 아니면 nextGen. 차대는 항상 nextGen.
 */
export function lookCandidates(s: CarState, nameplateId: number, kind: LookKind, target?: LookTarget): number[] {
  const n = nameplateById(s, nameplateId), g = n?.generations.length ? latestGen(n) : undefined;
  const canLift = !!g && g.status === 'onSale' && !g.editions.some((e) => e.kind === 'facelift');
  const t: LookTarget = kind === 'chassis' ? 'nextGen' : (target ?? (canLift ? 'facelift' : 'nextGen'));
  const genNo = t === 'facelift' && g ? g.number : (g?.number ?? 0) + 1;
  const edNo = t === 'facelift' && g ? g.editions.length + 1 : 1;
  const np = n ? n.id : 0, salt = n ? 0 : s.nameplates.length;
  return Array.from({ length: L.lookCandidates }, (_, i) => hash32(s.seed, np, salt, genNo, edNo, kind === 'face' ? 1 : 2, i));
}

// ---------- 기획 첫 화면(8.7) ----------
export interface NameplateEntry {
  nameplateId: number; name: string;
  generation: number; generationId: number; // 최신 세대 번호·ID
  status: Generation['status'];
  reviewAvg: number; // 최신 세대 평론 평균
  totalSold: number; // 차종 누적 판매(전 세대 합)
  equity: number; // 차종 자산(이름값, 0~0.3)
  fullChange: Eligibility; facelift: Eligibility;
}
/** blockedBy: 규제 의무 장비의 기술을 연구하지 않아 어떤 개발도 시작할 수 없는 이유(0.4.2, 없으면 null). newModel도 같은 이유로 막힌다 */
export interface PlanEntries { newModel: Eligibility; blockedBy: string | null; nameplates: NameplateEntry[] }
/** [신차 기획] 첫 화면: 새 차종(규제 기술 미연구가 아니면 가능) + 차종별 풀체인지·페이스리프트 가능 여부와 이유. 차종 ID 순 */
export function planEntries(s: CarState): PlanEntries {
  const nameplates = [...s.nameplates].filter((n) => n.generations.length).sort((a, b) => a.id - b.id).map((n): NameplateEntry => {
    const g = latestGen(n);
    return {
      nameplateId: n.id, name: n.name, generation: g.number, generationId: g.id, status: g.status,
      reviewAvg: g.reviewAvg, totalSold: n.generations.reduce((a, x) => a + x.totalSold, 0), equity: nameplateEquity(s, n.id),
      fullChange: fullChangeEligibility(s, n.id), facelift: faceliftEligibility(s, g.id),
    };
  });
  return { newModel: regulated(s), blockedBy: regulationBlock(s), nameplates };
}
