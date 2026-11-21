// 저장: IndexedDB 칸 3개 + 자동 저장 1칸, JSON 파일 내보내기·가져오기. IndexedDB가 안 되면 localStorage로 대신한다.
import { Game } from '../sim/game';
import type { CarState, Difficulty } from '../sim/types';
import { DEFAULT_LOGO, cleanLogo, type LogoSpec } from '../ui/art';

/** 저장 데이터 형식 번호(게임 버전·sim 저장 형식과 따로) */
export const SAVE_FILE_V = 1;
// photos: 세대 id → 출시 때 찍은 사진(작은 JPEG data URL), colors: 개발 중 프로젝트 id → 기획 때 고른 색, logo: 회사 로고(0.4.1~, 없던 옛 파일은 기본 로고)
// plan: 기획 초안·출시 준비 값(0.4.1~, 화면이 쓰는 모양 그대로. 불러올 때 화면이 검사·보정한다)
export interface PlanSave { draft?: ({ body: string; direction: object; options: string[]; team: number[] } & Record<string, unknown>) | null; planTab?: string; lift?: ({ genId: number; options: string[]; team: number[] } & Record<string, unknown>) | null; launch?: ({ pid: number } & Record<string, unknown>) | null }
/** 기획 프리셋(0.8.0): 이름과 기획 값(body가 없으면 차체 제외). 값이 지금 쓸 수 있는지는 불러올 때 화면이 본다 */
export interface PlanPreset { name: string; body?: string; segment: string; powertrain: string; tier: number; options: string[]; direction: Record<string, number>; designWeeks: number; budget: string }
export const PRESET_MAX = 8;
export interface UiExtra { photos: Record<string, string>; colors: Record<string, string>; logo: LogoSpec; plan?: PlanSave; presets?: PlanPreset[] }
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

export function makeSave(game: Game, ui: UiExtra): SaveData { return { v: SAVE_FILE_V, when: new Date().toISOString(), game: game.toJSON(), ui: { photos: { ...ui.photos }, colors: { ...ui.colors }, logo: { ...ui.logo }, ...(ui.plan ? { plan: ui.plan } : {}), ...(ui.presets?.length ? { presets: JSON.parse(JSON.stringify(ui.presets)) as PlanPreset[] } : {}) } }; }

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
export interface SlotInfo { key: SlotKey; when: string; company: string; week: number; cars: number; logo: LogoSpec; difficulty: Difficulty } // difficulty: 예전 저장은 normal
export async function list(): Promise<SlotInfo[]> {
  const out: SlotInfo[] = [];
  for (const key of ['auto', ...SLOT_KEYS] as SlotKey[]) {
    const d = await get(key);
    if (d?.game) out.push({ key, when: d.when, company: d.game.companyName, week: d.game.week, cars: d.game.nameplates?.length ?? 0, difficulty: d.game.difficulty ?? 'normal', logo: d.ui?.logo ? cleanLogo(d.ui.logo) : { ...DEFAULT_LOGO } });
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
    const game = Game.fromJSON(raw), photos: Record<string, string> = {}, colors: Record<string, string> = {};
    const p = o.ui?.photos, c = o.ui?.colors;
    if (p && typeof p === 'object') for (const [k, x] of Object.entries(p)) if (typeof x === 'string' && x.startsWith('data:image/')) photos[k] = x;
    if (c && typeof c === 'object') for (const [k, x] of Object.entries(c)) if (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x)) colors[k] = x;
    return { ok: true, game, ui: { photos, colors, logo: o.ui?.logo ? cleanLogo(o.ui.logo) : { ...DEFAULT_LOGO }, plan: o.ui?.plan && typeof o.ui.plan === 'object' ? o.ui.plan : undefined, presets: presetsOf(o.ui?.presets) } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : '불러오지 못했습니다' }; }
}
/** 저장 파일의 프리셋: 모양이 맞는 것만 최대 PRESET_MAX개 */
function presetsOf(v: unknown): PlanPreset[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const str = (x: unknown) => typeof x === 'string';
  return v.filter((p): p is PlanPreset => !!p && typeof p === 'object' && str(p.name) && (p.body === undefined || str(p.body)) && str(p.segment) && str(p.powertrain) && Number.isFinite(p.tier)
    && Array.isArray(p.options) && p.options.every(str) && !!p.direction && typeof p.direction === 'object' && Number.isFinite(p.designWeeks) && str(p.budget)).slice(0, PRESET_MAX).map((p) => JSON.parse(JSON.stringify(p)));
}
export function parseText(text: string): ReturnType<typeof parse> {
  try { return parse(JSON.parse(text)); } catch { return { ok: false, error: '파일이 올바른 형식이 아닙니다' }; }
}
