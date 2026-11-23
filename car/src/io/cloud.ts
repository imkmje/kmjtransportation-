// 1.6.0 기기 연동: 사용자의 GitHub 비밀 Gist 하나를 보관함으로 써서 자동 저장 한 판과 지난 판의 차 이름을 올리고 받는다. sim과 무관.
// 토큰은 이 기기 localStorage에만 둔다. 오류 문구·저장 파일·내보내기에는 넣지 않는다. fetch는 테스트에서 가짜로 바꿔 넣는다.
// Gist API(REST 2022-11-28): GET /gists(목록, 내용 없음), POST /gists, GET/PATCH /gists/{id}. 파일이 1MB를 넘으면 GET 응답의 content가 잘리고 truncated: true → raw_url로 받는다.
import { SAVE_VERSION } from '../sim/game';
import { SAVE_FILE_V, type SaveData } from './saves';
import type { PastRun } from './pastnames';

const API = 'https://api.github.com', RAW = 'https://gist.githubusercontent.com/';
export const META_FILE = 'carcompany-sync-meta.json', BODY_FILE = 'carcompany-sync-save.txt';
export const UPLOAD_GAP_MS = 60_000;
const KEY = 'car-company-sync';

/** 이 기기의 연동 설정. rev: 이 기기가 마지막으로 서버와 맞춘 판 번호, last: 마지막으로 올린 시각(ISO), fail: 마지막 실패 이유(성공하면 지움) */
export interface SyncCfg { token: string; device: string; id?: string; rev?: number; last?: string; fail?: string }
/** 보관함의 작은 meta 파일. rev 0 = 아직 저장 없음 */
export interface CloudMeta { rev: number; at: string; device: string; company: string; date: string; saveVersion: number; gameVersion: string }
export interface CloudBody { save: SaveData; past: PastRun[] }
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
interface GistFile { content?: string; truncated?: boolean; raw_url?: string }
interface Gist { id: string; files: Record<string, GistFile | null> }

export class CloudError extends Error {}
export const NEWER_TEXT = '서버의 저장이 이 기기의 게임보다 새 버전에서 만들어졌습니다. 이 기기에서 페이지를 새로 고쳐 최신 버전으로 만든 뒤 다시 시도하세요.';
const why = (status: number) => status === 401 ? '토큰이 틀렸거나 만료되었습니다. 새 토큰으로 연동을 다시 켜 주세요'
  : status === 403 || status === 429 ? 'GitHub가 요청을 거절했습니다(요청 한도에 걸렸거나 토큰에 gist 권한이 없음). 잠시 뒤 다시 시도하세요'
  : status === 404 ? '보관함을 찾지 못했습니다. 연동을 끄고 다시 켜 주세요' : `GitHub 응답 오류(${status})`;
/** 실패 이유 한 줄(토큰이 섞이지 않게 정해 둔 문구만) */
export const failText = (e: unknown): string => (e instanceof CloudError ? e.message : '연동 중 알 수 없는 오류가 났습니다');

async function call<T>(f: Fetch, token: string | null, url: string, method = 'GET', body?: unknown): Promise<T> {
  let r: Response;
  const headers: Record<string, string> = token ? { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try { r = await f(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' }); } // no-store: Gist 응답의 max-age=60 캐시로 낡은 rev를 읽지 않게
  catch { throw new CloudError('인터넷에 연결되지 않았거나 GitHub에 닿지 못했습니다'); }
  if (!r.ok) throw new CloudError(why(r.status));
  try { return (token ? await r.json() : await r.text()) as T; } catch { throw new CloudError('보관함의 내용을 읽지 못했습니다'); }
}

export function loadCfg(): SyncCfg | null {
  try { const o = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return o && typeof o.token === 'string' && o.token && typeof o.device === 'string' ? o : null; } catch { return null; }
}
export const saveCfg = (c: SyncCfg): void => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* 저장 불가: 이번 열람 동안만 연동 */ } };
/** [연동 끄기]: 이 기기의 토큰·보관함 id·rev를 지운다(서버의 Gist는 그대로) */
export const clearCfg = (): void => { try { localStorage.removeItem(KEY); } catch { /* 무시 */ } };

/** 보관함 찾기: 내 Gist 목록에서 meta 파일이 있는 것, 없으면 비밀 Gist를 새로 만든다 */
export async function findBox(f: Fetch, token: string): Promise<string> {
  // shortcut: 최근 Gist 100개만 본다, 사용자의 Gist가 100개를 넘으면 페이지를 넘겨 찾게 고친다
  const list = await call<Gist[]>(f, token, `${API}/gists?per_page=100`);
  const hit = Array.isArray(list) ? list.find((g) => g?.files && META_FILE in g.files) : undefined;
  if (hit) return hit.id;
  const made = await call<Gist>(f, token, `${API}/gists`, 'POST', { description: '카 컴퍼니 기기 연동 보관함(지우면 연동이 끊깁니다)', public: false, files: { [META_FILE]: { content: JSON.stringify({ rev: 0 }) } } });
  return made.id;
}

async function getBox(f: Fetch, c: SyncCfg): Promise<{ meta: CloudMeta; gist: Gist }> {
  if (!c.id) throw new CloudError('보관함을 찾지 못했습니다. 연동을 끄고 다시 켜 주세요');
  const gist = await call<Gist>(f, c.token, `${API}/gists/${encodeURIComponent(c.id)}`);
  let meta: CloudMeta | null = null;
  try { meta = JSON.parse(gist.files?.[META_FILE]?.content ?? 'null'); } catch { /* 아래에서 */ }
  if (!meta || !Number.isInteger(meta.rev) || meta.rev < 0) throw new CloudError('보관함의 내용을 읽지 못했습니다');
  return { meta, gist };
}
/** 서버 meta만 확인(받기 전 물음용) */
export const peek = async (f: Fetch, c: SyncCfg): Promise<CloudMeta> => (await getBox(f, c)).meta;

/** 올리기. 서버 rev가 이 기기가 아는 rev와 다르면 force가 아닌 한 올리지 않고 서버 meta를 돌려준다(병합하지 않음). 성공하면 c.rev·c.last를 바꾼다(저장은 부른 쪽) */
export async function upload(f: Fetch, c: SyncCfg, body: CloudBody, info: Pick<CloudMeta, 'date' | 'gameVersion'>, now: Date, force = false): Promise<{ meta: CloudMeta; conflict: boolean }> {
  const { meta } = await getBox(f, c);
  if (!force && meta.rev !== (c.rev ?? 0)) return { meta, conflict: true };
  const g = body.save.game;
  const next: CloudMeta = { rev: meta.rev + 1, at: now.toISOString(), device: c.device, company: g.companyName, date: info.date, saveVersion: g.saveVersion, gameVersion: info.gameVersion };
  await call(f, c.token, `${API}/gists/${encodeURIComponent(c.id!)}`, 'PATCH', { files: { [META_FILE]: { content: JSON.stringify(next) }, [BODY_FILE]: { content: await pack(body) } } });
  c.rev = next.rev; c.last = next.at; c.fail = undefined;
  return { meta: next, conflict: false };
}

/** 받기: 서버 저장 한 판과 지난 판의 차 이름. 저장 형식이 이 기기보다 새 것이면 거절 */
export async function download(f: Fetch, c: SyncCfg): Promise<{ meta: CloudMeta; body: CloudBody }> {
  const { meta, gist } = await getBox(f, c);
  if (meta.saveVersion > SAVE_VERSION) throw new CloudError(NEWER_TEXT);
  const file = gist.files?.[BODY_FILE];
  if (meta.rev === 0 || !file) throw new CloudError('서버에 아직 올린 저장이 없습니다');
  let text = file.content ?? '';
  if (file.truncated) { // 1MB를 넘어 잘린 파일: raw_url(비밀 Gist도 주소만으로 받는다)로 전부 받는다. 토큰은 보내지 않는다
    if (!file.raw_url?.startsWith(RAW)) throw new CloudError('보관함의 내용을 읽지 못했습니다');
    text = await call<string>(f, null, file.raw_url);
  }
  let body: CloudBody;
  try { body = await unpack(text) as CloudBody; } catch { throw new CloudError('보관함의 내용을 읽지 못했습니다'); }
  if (!body?.save?.game) throw new CloudError('보관함의 내용을 읽지 못했습니다');
  if ((body.save.v ?? 0) > SAVE_FILE_V || (body.save.game.saveVersion ?? 0) > SAVE_VERSION) throw new CloudError(NEWER_TEXT);
  return { meta, body: { save: body.save, past: Array.isArray(body.past) ? body.past : [] } };
}

/** JSON → gzip → base64(Gist 파일은 글자만 받는다) */
export async function pack(v: unknown): Promise<string> {
  const b = new Uint8Array(await new Response(new Blob([JSON.stringify(v)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function unpack(t: string): Promise<unknown> {
  const b = Uint8Array.from(atob(t.trim()), (ch) => ch.charCodeAt(0));
  return JSON.parse(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}

/** 60초에 한 번까지: 그 사이에 온 요청은 하나로 묶어 남은 시간 뒤에 한 번 */
export function throttle(fn: () => void, gap = UPLOAD_GAP_MS, now = () => Date.now(), later: (f: () => void, ms: number) => unknown = setTimeout): () => void {
  let last = -Infinity, waiting = false;
  const fire = () => { waiting = false; last = now(); fn(); };
  return () => {
    if (waiting) return;
    const wait = last + gap - now();
    if (wait <= 0) fire(); else { waiting = true; later(fire, wait); }
  };
}
