// 저장: IndexedDB 칸 3개 + 자동 저장 1칸, JSON 파일 내보내기·가져오기. IndexedDB가 안 되면 localStorage로 대신한다.
import { Game } from '../sim/game';
import type { CarState } from '../sim/types';

/** 저장 데이터 형식 번호(게임 버전·sim 저장 형식과 따로) */
export const SAVE_FILE_V = 1;
export interface UiExtra { photos: Record<string, string> } // 세대 id → 출시 때 찍은 사진(작은 JPEG data URL)
export interface SaveData { v: number; when: string; game: CarState; ui: UiExtra }
export type SlotKey = 'auto' | 'slot1' | 'slot2' | 'slot3';
export const SLOT_KEYS: SlotKey[] = ['slot1', 'slot2', 'slot3'];

const DB = 'car-company', STORE = 'saves', LS = (k: string) => `car-company-${k}`;
let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  return (dbp ??= new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = r.onblocked = () => res(null);
    } catch { res(null); }
  }));
}
function req<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then((d) => new Promise<T>((res, rej) => {
    if (!d) return rej(new Error('no-idb'));
    try { const r = f(d.transaction(STORE, mode).objectStore(STORE)); r.onsuccess = () => res(r.result as T); r.onerror = () => rej(r.error); } catch (e) { rej(e); }
  }));
}

export function makeSave(game: Game, ui: UiExtra): SaveData { return { v: SAVE_FILE_V, when: new Date().toISOString(), game: game.toJSON(), ui: { photos: { ...ui.photos } } }; }

export async function put(key: SlotKey, data: SaveData): Promise<boolean> {
  try { await req('readwrite', (s) => s.put(data, key)); return true; } catch { /* localStorage로 */ }
  try { localStorage.setItem(LS(key), JSON.stringify(data)); return true; } catch { return false; }
}
export async function get(key: SlotKey): Promise<SaveData | null> {
  try { const v = await req<SaveData | undefined>('readonly', (s) => s.get(key)); if (v) return v; } catch { /* localStorage로 */ }
  try { const raw = localStorage.getItem(LS(key)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export async function del(key: SlotKey): Promise<void> {
  try { await req('readwrite', (s) => s.delete(key)); } catch { /* 무시 */ }
  try { localStorage.removeItem(LS(key)); } catch { /* 무시 */ }
}

/** 저장 칸 요약(목록 표시용) */
export interface SlotInfo { key: SlotKey; when: string; company: string; week: number; cars: number }
export async function list(): Promise<SlotInfo[]> {
  const out: SlotInfo[] = [];
  for (const key of ['auto', ...SLOT_KEYS] as SlotKey[]) {
    const d = await get(key);
    if (d?.game) out.push({ key, when: d.when, company: d.game.companyName, week: d.game.week, cars: d.game.nameplates?.length ?? 0 });
  }
  return out;
}

/** 저장 데이터 검증 → 게임과 화면 부가 정보. 실패하면 이유 */
export function parse(v: unknown): { ok: true; game: Game; ui: UiExtra } | { ok: false; error: string } {
  const o = v as Partial<SaveData> | null;
  if (!o || typeof o !== 'object') return { ok: false, error: '카 컴퍼니 저장 파일이 아닙니다' };
  const raw = 'game' in o ? o.game : o; // 게임 상태만 들어 있는 파일도 받는다
  if (typeof o.v === 'number' && o.v > SAVE_FILE_V) return { ok: false, error: '더 새로운 버전에서 저장한 파일입니다' };
  try {
    const game = Game.fromJSON(raw), photos: Record<string, string> = {};
    const p = o.ui?.photos;
    if (p && typeof p === 'object') for (const [k, x] of Object.entries(p)) if (typeof x === 'string' && x.startsWith('data:image/')) photos[k] = x;
    return { ok: true, game, ui: { photos } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : '불러오지 못했습니다' }; }
}
export function parseText(text: string): ReturnType<typeof parse> {
  try { return parse(JSON.parse(text)); } catch { return { ok: false, error: '파일이 올바른 형식이 아닙니다' }; }
}
