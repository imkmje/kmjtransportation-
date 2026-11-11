/** 저장 보호: 저장 칸 3개와 파일 내보내기·가져오기. 브라우저 저장소(사파리는 오래 안 쓰면 지울 수 있다)에만 의존하지 않게 한다 */
import { Game } from '../sim/game';
import type { GameState } from '../sim/types';

export const SLOTS = 3;
const slotKey = (i: number) => `the-air-slot-${i}`;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (s?: Store): Store | null => { try { return s ?? localStorage; } catch { return null; } };

export interface SlotInfo { slot: number; empty: boolean; when?: string; summary?: string }

/** 한 줄 요약: "2년차 5개월 · 현금 $42M · 항공기 7대 · 노선 6개" */
export function summarize(st: GameState): string {
  const months = Math.floor(st.day / 30);
  return `${Math.floor(months / 12) + 1}년차 ${(months % 12) + 1}개월 · 현금 $${st.cash.toFixed(0)}M · 항공기 ${st.planes.length}대 · 노선 ${st.routes.filter((r) => r.open).length}개`;
}
export function saveSlot(i: number, game: Game, s?: Store): boolean {
  const st = store(s); if (!st || i < 1 || i > SLOTS) return false;
  try { st.setItem(slotKey(i), JSON.stringify({ v: 1, when: new Date().toISOString(), game: game.toJSON() })); return true; } catch { return false; }
}
export function slotInfos(s?: Store): SlotInfo[] {
  const st = store(s);
  return Array.from({ length: SLOTS }, (_, k) => {
    const slot = k + 1;
    try { const raw = st?.getItem(slotKey(slot)); if (!raw) return { slot, empty: true }; const v = JSON.parse(raw); return { slot, empty: false, when: String(v.when ?? '').slice(0, 16).replace('T', ' '), summary: summarize(v.game) }; } catch { return { slot, empty: true }; }
  });
}
/** 저장 칸의 게임을 불러온다(깨진 파일이면 null) */
export function loadSlot(i: number, s?: Store): Game | null {
  try { const raw = store(s)?.getItem(slotKey(i)); return raw ? Game.fromJSON(JSON.parse(raw).game) : null; } catch { return null; }
}
export function deleteSlot(i: number, s?: Store): void { try { store(s)?.removeItem(slotKey(i)); } catch { /* 무시 */ } }

/** 내보내기 파일 내용: 게임 저장 + 평생 업적(다음 판 동기) */
export function exportText(game: Game, ach: string[]): string {
  return JSON.stringify({ 'the-air-export': 1, exportedAt: new Date().toISOString(), game: game.toJSON(), profile: { ach } });
}
/** 가져오기: 내보내기 파일이나 게임 저장 JSON을 읽는다. 실패하면 이유를 돌려준다 */
export function parseImport(text: string): { ok: true; game: Game; ach: string[] } | { ok: false; error: string } {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return { ok: false, error: '파일이 올바른 형식이 아닙니다(JSON이 아님)' }; }
  const o = v as { 'the-air-export'?: number; game?: unknown; profile?: { ach?: unknown } } | null;
  const data = o && typeof o === 'object' && o['the-air-export'] ? o.game : v;
  try {
    const game = Game.fromJSON(data), ach = Array.isArray(o?.profile?.ach) ? (o!.profile!.ach as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    return { ok: true, game, ach };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : '불러오지 못했습니다' }; }
}
