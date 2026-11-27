// 3.7.0 결정 자동 승인: 켠 종류의 결정 창은 뜨자마자 정해진 선택지로 처리한다(임원 자동 처리 규칙이 있으면 그 규칙, 없으면 기본 선택).
// 3.7.1 종류마다 자동으로 고를 답을 정한다(autoDecide.pick, 없으면 위의 처음 값). 고른 답을 그때 할 수 없으면 묻는다
// 안전선: 고른 선택지의 현금 지출이 지금 현금의 guardShare 이상이거나 현금보다 크면 자동으로 하지 않고 평소처럼 묻는다(끌 수 있다)
import { config } from '../config';
import { RANDOM_EVENTS } from '../data';
import { staffCap, staffCount } from './company';
import { choiceMoney } from './events';
import { autoChoice } from './rivalry';
import { tradeAuto } from './world';
import { limitedAuto } from './motor';
import type { AutoAnswer, CarState, PendingChoice } from './types';

/** 자동 승인할 수 있는 결정 종류(무작위 사건 + 경쟁 2부 결정 창), 자료 순서 */
export const AUTO_KINDS = RANDOM_EVENTS.map((d) => ({ id: d.id, name: d.name, rule: d.needs === 'rivalry' || d.needs === 'world' || d.needs === 'motorsport' ? 'exec' as const : 'default' as const, defaultLabel: d.choices[d.defaultChoice].label,
  defaultChoice: d.defaultChoice, choices: d.choices.map((c) => ({ label: c.label, result: c.result })) }));
type AutoKind = typeof AUTO_KINDS[number];
/** 3.7.1 답을 정하지 않은 종류의 답: 규칙 종류는 규칙대로, 나머지는 기본 선택(3.7.0과 같다) */
export const autoInitial = (k: AutoKind): AutoAnswer => k.rule === 'exec' ? 'rule' : k.defaultChoice;
export const autoAnswerOk = (k: AutoKind, a: unknown): a is AutoAnswer => a === 'rule' ? k.rule === 'exec' : Number.isInteger(a) && (a as number) >= 0 && (a as number) < k.choices.length;
/** 3.7.1 그 종류의 자동 답(저장 파일의 잘못된 값은 처음 값으로) */
export function autoAnswer(s: CarState, kind: string): AutoAnswer {
  const k = AUTO_KINDS.find((x) => x.id === kind)!, a = s.autoDecide?.pick?.[kind];
  return autoAnswerOk(k, a) ? a : autoInitial(k);
}
export const autoOn = (s: CarState, kind: string): boolean => !!s.autoDecide?.on.includes(kind);
export const autoGuardOn = (s: CarState): boolean => s.autoDecide?.guard !== false;
/** 고를 선택지: 정한 답, 규칙대로면 임원 규칙(가격 전쟁·이직 제안)이 답하면 그것, 아니면 기본 선택 */
export function autoPick(s: CarState, pc: PendingChoice): { choice: number; why: string | null } {
  const ans = autoAnswer(s, pc.eventId);
  if (ans !== 'rule') return { choice: ans, why: null };
  const a = pc.tr ? tradeAuto(s, pc) : pc.ms ? limitedAuto(s, pc) : autoChoice(s, pc); // 5.5.0 무역 협정: 아끼는 관세가 로비 비용보다 크면 로비. 5.6.0 한정판: 다 팔아 남으면 낸다
  return a ? { choice: a.choice, why: a.why } : { choice: RANDOM_EVENTS.find((d) => d.id === pc.eventId)!.defaultChoice, why: null };
}
/** 3.7.1 그 선택지를 지금 할 수 없으면 이유(효과가 걸 대상이 없음), 아니면 null */
export function autoBlocked(s: CarState, pc: PendingChoice, choice: number): string | null {
  const def = RANDOM_EVENTS.find((d) => d.id === pc.eventId)!, x = pc.rv;
  const car = pc.genId !== null && s.nameplates.some((n) => n.generations.some((g) => g.id === pc.genId && g.status !== 'discontinued')); // applyChoice·choiceMoney와 같은 대상
  for (const e of def.choices[choice].effects) {
    if (e.type === 'hire' && staffCount(s) >= staffCap(s)) return '직원 정원이 다 찼습니다';
    if ((e.type === 'fixDefects' || e.type === 'awarenessMult' || (e.type === 'awareness' && e.target === 'car')) && !car) return '대상 차가 판매 중이 아닙니다';
    if (e.type === 'warFollow' && !(s.rivalry?.wars ?? []).some((w) => w.id === x?.war && w.follow === null)) return '가격 전쟁이 이미 끝났습니다';
    if (e.type === 'retain' && !s.staff.some((y) => y.id === x?.staffId)) return '대상 직원이 회사에 없습니다';
  }
  return null;
}
/** 자동으로 하지 않고 물을 이유(고른 답을 할 수 없음, 안전선), 아니면 null. 지출 = 그 선택지의 현금 지출(수입이면 0) */
export function autoHold(s: CarState, pc: PendingChoice, choice: number): string | null {
  const blocked = autoBlocked(s, pc, choice);
  if (blocked) return blocked;
  const cost = -choiceMoney(s, pc, choice);
  if (!autoGuardOn(s) || cost <= 0) return null;
  if (cost > s.cash) return '현금이 모자랍니다';
  return cost >= s.cash * config.autoDecide.guardShare ? `지금 현금의 ${Math.round(config.autoDecide.guardShare * 100)}% 이상이 듭니다` : null;
}
/** 최근 자동 승인 기록(뉴스에서, 최신이 앞) */
export const autoLog = (s: CarState, n: number = config.autoDecide.logShow): { week: number; text: string }[] =>
  s.events.news.filter((x) => x.topic === 'auto').slice(-n).reverse().map((x) => ({ week: x.week, text: x.text }));
