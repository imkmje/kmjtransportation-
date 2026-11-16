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
/** 연말 자동 백업: 저장 칸과 따로 둔다(덮어쓰는 실수·깨진 저장 대비. 브라우저 저장소가 지워지면 함께 사라진다) */
const BACKUP_KEY = 'the-air-backup';
export function saveBackup(game: Game, s?: Store): boolean { const st = store(s); if (!st) return false; try { st.setItem(BACKUP_KEY, JSON.stringify({ v: 1, when: new Date().toISOString(), game: game.toJSON() })); return true; } catch { return false; } }
export function backupInfo(s?: Store): { when: string; summary: string } | null { try { const raw = store(s)?.getItem(BACKUP_KEY); if (!raw) return null; const v = JSON.parse(raw); return { when: String(v.when ?? '').slice(0, 16).replace('T', ' '), summary: summarize(v.game) }; } catch { return null; } }
export function loadBackup(s?: Store): Game | null { try { const raw = store(s)?.getItem(BACKUP_KEY); return raw ? Game.fromJSON(JSON.parse(raw).game) : null; } catch { return null; } }
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

/** 기기 옮기기: 이 기기의 The Air 기록 전부(이어하기·저장 칸·연말 백업·평생 업적·통계·시나리오 기록·설정)를 파일 하나로 */
type AllStore = Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>;
const allStore = (s?: AllStore): AllStore | null => { try { return s ?? localStorage; } catch { return null; } };
export function exportAll(s?: AllStore): string {
  const st = allStore(s), data: Record<string, string> = {};
  if (st) for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k && k.startsWith('the-air')) { const v = st.getItem(k); if (v !== null) data[k] = v; } }
  return JSON.stringify({ 'the-air-all': 1, exportedAt: new Date().toISOString(), data });
}
/** 기기 옮기기 파일을 읽어 이 기기에 넣는다. 평생 업적·통계·시나리오 기록은 합치고(어느 기기 것도 잃지 않게), 게임 저장·설정은 파일 것으로 바꾼다 */
export function importAll(text: string, s?: AllStore): { ok: true; n: number } | { ok: false; error: string } {
  let v: unknown; try { v = JSON.parse(text); } catch { return { ok: false, error: '파일이 올바른 형식이 아닙니다(JSON이 아님)' }; }
  const o = v as { 'the-air-all'?: number; data?: unknown } | null;
  if (!o || typeof o !== 'object' || !o['the-air-all'] || !o.data || typeof o.data !== 'object') return { ok: false, error: '기기 옮기기 파일이 아닙니다(게임 하나만 담긴 파일은 "파일에서 가져오기"를 쓰세요)' };
  const st = allStore(s); if (!st) return { ok: false, error: '이 브라우저에 저장할 수 없습니다' };
  const data = o.data as Record<string, unknown>; let n = 0;
  const j = (x: string | null) => { try { return x ? JSON.parse(x) : null; } catch { return null; } };
  for (const [k, raw] of Object.entries(data)) {
    if (!k.startsWith('the-air') || typeof raw !== 'string') continue;
    let val = raw;
    if (k === 'the-air-profile') { // 업적은 합치고, 통계는 항목마다 큰 값
      const a = j(raw) ?? {}, b = j(st.getItem(k)) ?? {}, ach = [...new Set([...(Array.isArray(a.ach) ? a.ach : []), ...(Array.isArray(b.ach) ? b.ach : [])])].filter((x) => typeof x === 'string');
      const sa = a.stats ?? {}, sb = b.stats ?? {}, stx: Record<string, number> = {}; for (const key of new Set([...Object.keys(sa), ...Object.keys(sb)])) stx[key] = Math.max(Number(sa[key]) || 0, Number(sb[key]) || 0);
      val = JSON.stringify({ ...b, ...a, ach, stats: stx });
    } else if (k === 'the-air-records') { // 시나리오 기록: 합쳐서 점수 높은 5개
      const a = j(raw) ?? {}, b = j(st.getItem(k)) ?? {}, out: Record<string, unknown[]> = {};
      for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) { const seen = new Set<string>(); out[id] = [...(a[id] ?? []), ...(b[id] ?? [])].filter((r) => { const key = JSON.stringify(r); if (seen.has(key)) return false; seen.add(key); return true; }).sort((x: { score?: number }, y: { score?: number }) => (y.score ?? 0) - (x.score ?? 0)).slice(0, 5); }
      val = JSON.stringify(out);
    }
    try { st.setItem(k, val); n++; } catch { return { ok: false, error: '저장 공간이 모자랍니다' }; }
  }
  return n ? { ok: true, n } : { ok: false, error: '파일에 옮길 기록이 없습니다' };
}
