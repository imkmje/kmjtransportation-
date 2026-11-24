// 3.7.0 결정 자동 승인: 켠 종류의 결정 창은 뜨자마자 정해진 선택지로 처리한다(임원 자동 처리 규칙이 있으면 그 규칙, 없으면 기본 선택).
// 안전선: 고른 선택지의 현금 지출이 지금 현금의 guardShare 이상이거나 현금보다 크면 자동으로 하지 않고 평소처럼 묻는다(끌 수 있다)
import { config } from '../config';
import { RANDOM_EVENTS } from '../data';
import { choiceMoney } from './events';
import { autoChoice } from './rivalry';
import type { CarState, PendingChoice } from './types';

/** 자동 승인할 수 있는 결정 종류(무작위 사건 + 경쟁 2부 결정 창), 자료 순서 */
export const AUTO_KINDS = RANDOM_EVENTS.map((d) => ({ id: d.id, name: d.name, rule: d.needs === 'rivalry' ? 'exec' as const : 'default' as const, defaultLabel: d.choices[d.defaultChoice].label }));
export const autoOn = (s: CarState, kind: string): boolean => !!s.autoDecide?.on.includes(kind);
export const autoGuardOn = (s: CarState): boolean => s.autoDecide?.guard !== false;
/** 고를 선택지: 임원 규칙(가격 전쟁·이직 제안)이 답하면 그것, 아니면 기본 선택 */
export function autoPick(s: CarState, pc: PendingChoice): { choice: number; why: string | null } {
  const a = autoChoice(s, pc);
  return a ? { choice: a.choice, why: a.why } : { choice: RANDOM_EVENTS.find((d) => d.id === pc.eventId)!.defaultChoice, why: null };
}
/** 안전선에 걸리면 이유(묻는다), 아니면 null. 지출 = 그 선택지의 현금 지출(수입이면 0) */
export function autoHold(s: CarState, pc: PendingChoice, choice: number): string | null {
  const cost = -choiceMoney(s, pc, choice);
  if (!autoGuardOn(s) || cost <= 0) return null;
  if (cost > s.cash) return '현금이 모자랍니다';
  return cost >= s.cash * config.autoDecide.guardShare ? `지금 현금의 ${Math.round(config.autoDecide.guardShare * 100)}% 이상이 듭니다` : null;
}
/** 최근 자동 승인 기록(뉴스에서, 최신이 앞) */
export const autoLog = (s: CarState, n: number = config.autoDecide.logShow): { week: number; text: string }[] =>
  s.events.news.filter((x) => x.topic === 'auto').slice(-n).reverse().map((x) => ({ week: x.week, text: x.text }));
