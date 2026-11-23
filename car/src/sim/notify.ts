// 1.3.0 알림 유형: 화면이 유형별로 켜고 끌 수 있게 sim의 이벤트·뉴스를 11가지(2.0.0 경쟁사 신차 추가)로 나눈다(목록·한국어 이름·끌 수 없음은 data/notify.json)
import { NOTIFY } from '../data';
import type { GameEvent, NewsItem, NotifyDef, NotifyTopic } from './types';

export const NOTIFY_TOPICS: NotifyDef[] = NOTIFY;
const NEWS: Record<string, NotifyTopic> = { preview: 'market', start: 'market', end: 'market', result: 'market', choice: 'market', regulation: 'warning', research: 'research', rival: 'rival', other: 'launch' };
const KIND: Record<string, NotifyTopic> = {
  devWeek: 'dev', designDone: 'dev', advice: 'launch', recall: 'warning', cashWarning: 'warning', gameOver: 'warning', monthEnd: 'finance', discontinued: 'launch',
  unlock: 'research', reputation: 'launch', execReport: 'exec', replacement: 'hiring', company: 'hiring', choice: 'market',
};
/** 이벤트의 알림 유형: 붙어 있는 topic, 뉴스는 분류, 그 밖은 종류로 */
export function eventTopic(e: GameEvent): NotifyTopic {
  if ('topic' in e && e.topic) return e.topic;
  if (e.kind === 'news') return NEWS[('category' in e && e.category) || 'other'] ?? 'launch';
  return KIND[e.kind] ?? 'launch';
}
/** 뉴스 기록 한 줄의 알림 유형 */
export const newsTopic = (n: NewsItem): NotifyTopic => n.topic ?? NEWS[n.category ?? 'other'] ?? 'launch';
/** 끌 수 없는 유형인가(경고) */
export const topicLocked = (t: NotifyTopic): boolean => !!NOTIFY.find((x) => x.id === t)?.locked;
