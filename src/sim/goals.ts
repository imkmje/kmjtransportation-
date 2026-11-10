import type { Network } from './network';
import type { DayRecord } from './metrics';

/**
 * 목표·업적(돈과 무관). 저장 파일에 따로 넣지 않고, 하루 기록(history)과 도로망에서 매번 계산한다 →
 * 저장·불러오기 후에도 자동으로 같은 결과가 나온다(저장 형식 변경 없음).
 */
export interface Ctx { history: DayRecord[]; net: Network; day: number }
export interface Goal { id: string; name: string; desc: string; test: (c: Ctx) => boolean }

const run = (h: DayRecord[], ok: (r: DayRecord) => boolean, n: number) => { let c = 0; for (const r of h) { c = ok(r) ? c + 1 : 0; if (c >= n) return true; } return false; };
const count = (net: Network, kind: string) => [...net.buildings.values()].filter((b) => b.kind === kind).length;
const big = (r: DayRecord) => r.generated >= 200; // 이동이 너무 적은 날은 목표 달성으로 치지 않는다

export const GOALS: Goal[] = [
  { id: 'first-day', name: '첫 하루', desc: '하루(04:00 경계)를 무사히 보낸다', test: (c) => c.history.length >= 1 },
  { id: 'week', name: '일주일 버티기', desc: '7일이 지난다', test: (c) => c.history.length >= 7 },
  { id: 'smooth', name: '원활한 하루', desc: '이동 200건 이상인 날 완료율 95% 이상', test: (c) => c.history.some((r) => big(r) && (r.completion ?? 0) >= 95) },
  { id: 'smooth3', name: '3일 연속 원활', desc: '이동 200건 이상인 날 3일 연속 완료율 95% 이상', test: (c) => run(c.history, (r) => big(r) && (r.completion ?? 0) >= 95, 3) },
  { id: 'calm', name: '쾌적한 도로', desc: '이동 200건 이상인 날 정체 지수 25 미만(양호 이상)', test: (c) => c.history.some((r) => big(r) && r.ci !== null && r.ci < 25) },
  { id: 'busy', name: '북적이는 하루', desc: '하루에 이동 1,000건 이상 도착', test: (c) => c.history.some((r) => r.arrived >= 1000) },
  { id: 'metro', name: '대도시', desc: '하루에 이동 3,000건 이상 도착', test: (c) => c.history.some((r) => r.arrived >= 3000) },
  { id: 'homes30', name: '마을', desc: '주거 건물 30채', test: (c) => count(c.net, 'home') >= 30 },
  { id: 'homes100', name: '도시', desc: '주거 건물 100채', test: (c) => count(c.net, 'home') >= 100 },
  { id: 'lights3', name: '신호 관리자', desc: '신호등 3곳 이상', test: (c) => [...c.net.nodes.keys()].filter((id) => c.net.hasSignal(id)).length >= 3 },
  { id: 'fixed', name: '병목 해결', desc: '정체 지수 60 이상(심각)이던 날 다음 날 40 미만으로 회복', test: (c) => c.history.some((r, i) => i > 0 && c.history[i - 1].ci !== null && c.history[i - 1].ci! >= 60 && r.ci !== null && r.ci < 40) },
  { id: 'school', name: '학교 개교', desc: '학교 1곳', test: (c) => count(c.net, 'school') >= 1 },
];

export const goalsDone = (c: Ctx): string[] => GOALS.filter((g) => g.test(c)).map((g) => g.id);

/** 하루 점수(0~100): 완료율 60% + (100 − 정체 지수) 40%. 이동이 없던 날은 null */
export const dayScore = (r: DayRecord): number | null => (r.completion === null || r.ci === null ? null : Math.round(r.completion * 0.6 + (100 - Math.min(100, r.ci)) * 0.4));
