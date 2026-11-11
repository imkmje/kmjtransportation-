/** 다음 판 동기: 게임 한 판을 넘어 쌓이는 기록(브라우저에 저장). 게임 저장 파일과는 별개라서 새 게임을 해도 남는다 */
const KEY = 'the-air-profile';

/** 업적을 많이 달성해야 열리는 "도전 출발지"(아프리카·중남미·오세아니아) */
export const LOCKED_BASES = ['JNB', 'LOS', 'NBO', 'ADD', 'GRU', 'MEX', 'EZE', 'SCL', 'BOG', 'SYD', 'MEL', 'AKL'];
export const UNLOCK_NEED = 6;
export const TITLES: [number, string][] = [[0, '신입 사장'], [3, '지역 항공사 사장'], [6, '노선 개척자'], [10, '중견 항공사 회장'], [14, '항공 그룹 총수'], [18, '하늘의 제왕']];

/** 지금까지 달성한 업적 ID(모든 판을 합친 것) */
export function lifetime(): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return Array.isArray(v.ach) ? v.ach.filter((x: unknown) => typeof x === 'string') : []; } catch { return []; }
}
/** 새로 달성한 업적을 기록하고, 새로 늘어난 개수를 돌려준다 */
export function addAch(ids: string[]): number {
  const cur = new Set(lifetime()); let n = 0;
  for (const id of ids) if (!cur.has(id)) { cur.add(id); n++; }
  if (n) { try { localStorage.setItem(KEY, JSON.stringify({ ach: [...cur] })); } catch { /* 저장 불가 */ } }
  return n;
}
/** 자유 모드 시작 자금 보너스($M): 평생 업적 3개마다 $1M, 최대 $6M */
export const startBonus = (n = lifetime().length): number => Math.min(6, Math.floor(n / 3));
export const baseUnlocked = (n = lifetime().length): boolean => n >= UNLOCK_NEED;
export const titleOf = (n = lifetime().length): string => [...TITLES].reverse().find(([need]) => n >= need)![1];
