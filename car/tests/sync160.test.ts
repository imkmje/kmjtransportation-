// 1.6.0 기기 연동: 가짜 GitHub Gist 서버(메모리)로 보관함 찾기·만들기, 올리기→받기 왕복, rev 충돌, 실패 처리, 새 저장 형식 거절, 1MB 넘는 파일(truncated), 60초 제한
import { describe, expect, it } from 'vitest';
import { Game, SAVE_VERSION } from '../src/sim/game';
import { makeSave } from '../src/io/saves';
import * as CL from '../src/io/cloud';
import type { PastRun } from '../src/io/pastnames';

/** 메모리 Gist 서버. limit: 이 길이를 넘는 파일은 GET에서 잘라 truncated·raw_url로 준다(실제 GitHub는 1MB) */
function fakeGitHub(token: string, limit = 1_000_000) {
  const gists = new Map<string, Record<string, string>>(), log: { method: string; url: string; auth?: string }[] = [];
  let seq = 0, down: number | 'net' | null = null;
  const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const view = (id: string) => ({ id, files: Object.fromEntries(Object.entries(gists.get(id)!).map(([n, c]) => [n, { filename: n, size: c.length, raw_url: `https://gist.githubusercontent.com/me/${id}/raw/${seq}/${n}`, truncated: c.length > limit, content: c.slice(0, limit) }])) });
  const f = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET', auth = (init.headers as Record<string, string> | undefined)?.Authorization;
    log.push({ method, url, auth });
    if (down === 'net') throw new TypeError('Failed to fetch');
    if (typeof down === 'number') return res(down, { message: 'error' });
    const raw = url.match(/^https:\/\/gist\.githubusercontent\.com\/me\/([^/]+)\/raw\/\d+\/(.+)$/);
    if (raw) return new Response(gists.get(raw[1])?.[raw[2]] ?? '', { status: gists.get(raw[1])?.[raw[2]] !== undefined ? 200 : 404 });
    if (auth !== `Bearer ${token}`) return res(401, { message: 'Bad credentials' });
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (method === 'GET' && url.startsWith('https://api.github.com/gists?')) return res(200, [...gists.keys()].map((id) => ({ ...view(id), files: Object.fromEntries(Object.keys(gists.get(id)!).map((n) => [n, { filename: n }])) })));
    if (method === 'POST' && url === 'https://api.github.com/gists') {
      expect(body.public).toBe(false);
      const id = `g${++seq}`; gists.set(id, Object.fromEntries(Object.entries(body.files as Record<string, { content: string }>).map(([n, x]) => [n, x.content]))); return res(201, view(id));
    }
    const m = url.match(/^https:\/\/api\.github\.com\/gists\/([^/?]+)$/);
    if (m && gists.has(m[1])) {
      if (method === 'GET') return res(200, view(m[1]));
      if (method === 'PATCH') { seq++; for (const [n, x] of Object.entries(body.files as Record<string, { content: string }>)) gists.get(m[1])![n] = x.content; return res(200, view(m[1])); }
    }
    return res(404, { message: 'Not Found' });
  };
  return { f, gists, log, set down(v: number | 'net' | null) { down = v; } };
}

const PAST: PastRun[] = [{ id: '7:지난 회사', company: '지난 회사', startYear: 1970, at: 1, cars: [{ name: '누리', body: 'sedanS', segment: 'worker', year: 1971, sold: 1234 }] }];
function saveOf(seed = 3, weeks = 30) { const g = Game.create({ seed, companyName: '한빛자동차', difficulty: 'normal' }); for (let i = 0; i < weeks; i++) g.tick(); return makeSave(g, { photos: { 1: 'data:image/jpeg;base64,AAAA' }, colors: {}, logo: { shape: 'round', bg: '#14171c', fg: '#ffffff', mark: 'slash', text: '', border: false } as never }); }
const INFO = { date: '1970년 8월', gameVersion: '1.6.0' };
const now = new Date('2026-11-23T05:00:00Z');

describe('1.6.0 기기 연동(가짜 Gist 서버)', () => {
  it('보관함: 없으면 비밀 Gist를 만들고, 다른 기기는 같은 보관함을 찾는다', async () => {
    const gh = fakeGitHub('tok');
    const a = await CL.findBox(gh.f, 'tok');
    expect(gh.gists.size).toBe(1);
    expect(JSON.parse(gh.gists.get(a)![CL.META_FILE]).rev).toBe(0);
    const b = await CL.findBox(gh.f, 'tok');
    expect(b).toBe(a);
    expect(gh.log.filter((x) => x.method === 'POST')).toHaveLength(1);
  });

  it('올리기 → 다른 기기에서 받기: 저장 내용이 같고 meta에 기기·회사·날짜·형식·버전', async () => {
    const gh = fakeGitHub('tok'), id = await CL.findBox(gh.f, 'tok');
    const A: CL.SyncCfg = { token: 'tok', device: 'PC', id }, B: CL.SyncCfg = { token: 'tok', device: '태블릿', id };
    const save = saveOf();
    const up = await CL.upload(gh.f, A, { save, past: PAST }, INFO, now);
    expect(up.conflict).toBe(false);
    expect(A.rev).toBe(1); expect(A.last).toBe(now.toISOString());
    expect(up.meta).toMatchObject({ rev: 1, device: 'PC', company: '한빛자동차', date: '1970년 8월', saveVersion: SAVE_VERSION, gameVersion: '1.6.0' });
    expect(gh.gists.get(id)![CL.BODY_FILE]).not.toContain('한빛자동차'); // gzip+base64
    expect(JSON.stringify(gh.gists.get(id))).not.toContain('tok');
    const m = await CL.peek(gh.f, B);
    expect(m.rev).toBe(1);
    const d = await CL.download(gh.f, B);
    expect(JSON.stringify(d.body.save)).toBe(JSON.stringify(save));
    expect(d.body.past).toEqual(PAST);
    expect(Game.fromJSON(d.body.save.game).state.week).toBe(30);
  });

  it('rev 충돌: 서버 rev가 이 기기가 아는 rev와 다르면 덮어쓰지 않고, force일 때만 덮어쓴다', async () => {
    const gh = fakeGitHub('tok'), id = await CL.findBox(gh.f, 'tok');
    const A: CL.SyncCfg = { token: 'tok', device: 'PC', id }, B: CL.SyncCfg = { token: 'tok', device: '태블릿', id };
    await CL.upload(gh.f, A, { save: saveOf(3), past: [] }, INFO, now);
    const before = { ...gh.gists.get(id)! };
    const r = await CL.upload(gh.f, B, { save: saveOf(4), past: [] }, INFO, now);
    expect(r.conflict).toBe(true);
    expect(r.meta.device).toBe('PC');
    expect(gh.gists.get(id)).toEqual(before);
    expect(B.rev).toBeUndefined();
    const f = await CL.upload(gh.f, B, { save: saveOf(4), past: [] }, INFO, now, true);
    expect(f.conflict).toBe(false); expect(f.meta.rev).toBe(2); expect(B.rev).toBe(2);
    expect((await CL.upload(gh.f, A, { save: saveOf(3), past: [] }, INFO, now)).conflict).toBe(true); // 이제 A가 낡았다
  });

  it('실패: 401(토큰)·403(한도)·네트워크 끊김은 정해 둔 문구로, 토큰은 문구에 없다', async () => {
    const gh = fakeGitHub('right-token'), id = await CL.findBox(gh.f, 'right-token');
    const bad = await CL.findBox(gh.f, 'wrong-token').catch((e) => e);
    expect(bad).toBeInstanceOf(CL.CloudError);
    expect(CL.failText(bad)).toContain('토큰이 틀렸거나 만료');
    expect(CL.failText(bad)).not.toContain('wrong-token');
    const c: CL.SyncCfg = { token: 'right-token', device: 'PC', id };
    gh.down = 403;
    expect(CL.failText(await CL.upload(gh.f, c, { save: saveOf(), past: [] }, INFO, now).catch((e) => e))).toContain('요청 한도');
    gh.down = 'net';
    const off = await CL.peek(gh.f, c).catch((e) => e);
    expect(CL.failText(off)).toContain('인터넷에 연결되지 않았');
    expect(c.rev).toBeUndefined(); expect(c.last).toBeUndefined();
    gh.down = null;
    expect(CL.failText(new Error('x'))).not.toContain('x');
  });

  it('서버 저장 형식이 이 기기보다 새 것이면 받지 않고 새로 고침 안내', async () => {
    const gh = fakeGitHub('tok'), id = await CL.findBox(gh.f, 'tok'), c: CL.SyncCfg = { token: 'tok', device: 'PC', id };
    const save = saveOf(); save.game = { ...save.game, saveVersion: (SAVE_VERSION + 1) as typeof SAVE_VERSION };
    await CL.upload(gh.f, c, { save, past: [] }, INFO, now);
    expect((await CL.peek(gh.f, c)).saveVersion).toBe(SAVE_VERSION + 1);
    const e = await CL.download(gh.f, { ...c, rev: 0 }).catch((x) => x);
    expect(CL.failText(e)).toBe(CL.NEWER_TEXT);
  });

  it('1MB를 넘어 잘린 파일(truncated)은 raw_url로 토큰 없이 받는다', async () => {
    const gh = fakeGitHub('tok', 2000), id = await CL.findBox(gh.f, 'tok'), c: CL.SyncCfg = { token: 'tok', device: 'PC', id };
    const save = saveOf(5, 200);
    await CL.upload(gh.f, c, { save, past: PAST }, INFO, now);
    expect(gh.gists.get(id)![CL.BODY_FILE].length).toBeGreaterThan(2000);
    const d = await CL.download(gh.f, c);
    expect(JSON.stringify(d.body.save)).toBe(JSON.stringify(save));
    const raw = gh.log.filter((x) => x.url.startsWith('https://gist.githubusercontent.com/'));
    expect(raw).toHaveLength(1); expect(raw[0].auth).toBeUndefined();
  });

  it('60초 제한: 처음은 바로, 60초 안의 요청은 하나로 묶어 남은 시간 뒤에 한 번', () => {
    let t = 0, runs = 0; const timers: { at: number; f: () => void }[] = [];
    const go = CL.throttle(() => { runs++; }, 60_000, () => t, (f, ms) => { timers.push({ at: t + ms, f }); });
    go(); expect(runs).toBe(1);
    t = 10_000; go(); t = 20_000; go(); go();
    expect(runs).toBe(1); expect(timers).toHaveLength(1); expect(timers[0].at).toBe(60_000);
    t = 60_000; timers.shift()!.f(); expect(runs).toBe(2);
    t = 130_000; go(); expect(runs).toBe(3); expect(timers).toHaveLength(0);
  });
});
