import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { logKind } from '../src/sim/report';
import { SLOTS, deleteSlot, exportText, loadSlot, parseImport, saveSlot, slotInfos, summarize } from '../src/ui/saves';

const fake = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m }; };
const played = () => { const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 500; const o = g.openRoute('ICN', 'NRT'); if (!o.ok) throw new Error(o.error); g.buyForRoute(o.routeId, 'B737', 'new'); g.advanceDays(30 * 14 + 5); return g; };

describe('저장 칸·내보내기·가져오기', () => {
  it('저장 칸 3개: 저장 → 목록 요약 → 불러오기 → 삭제', () => {
    const st = fake(), g = played();
    expect(slotInfos(st).length).toBe(SLOTS); expect(slotInfos(st).every((i) => i.empty)).toBe(true);
    expect(saveSlot(2, g, st)).toBe(true);
    const info = slotInfos(st)[1]; expect(info.empty).toBe(false); expect(info.summary).toBe(summarize(g.state)); expect(info.summary).toContain('2년차 3개월'); expect(info.when).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d$/);
    const back = loadSlot(2, st)!; expect(back.state.day).toBe(g.state.day); expect(back.state.cash).toBeCloseTo(g.state.cash, 9); expect(back.state.planes.length).toBe(g.state.planes.length);
    expect(loadSlot(1, st)).toBeNull(); deleteSlot(2, st); expect(slotInfos(st)[1].empty).toBe(true); expect(loadSlot(2, st)).toBeNull();
  });
  it('저장 칸 번호가 범위를 벗어나거나 저장 공간이 없으면 안전하게 실패한다', () => {
    const g = played(); expect(saveSlot(0, g, fake())).toBe(false); expect(saveSlot(SLOTS + 1, g, fake())).toBe(false);
    const full = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => { /* 없음 */ } }; expect(saveSlot(1, g, full)).toBe(false);
    const st = fake(); st.setItem('the-air-slot-1', '{깨진 파일'); expect(slotInfos(st)[0].empty).toBe(true); expect(loadSlot(1, st)).toBeNull();
  });
  it('내보내기 → 가져오기: 게임이 그대로 돌아오고 평생 업적이 함께 온다', () => {
    const g = played(), text = exportText(g, ['first', 'routes5']), r = parseImport(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.ach).toEqual(['first', 'routes5']); expect(JSON.stringify(r.game.toJSON())).toBe(JSON.stringify(g.toJSON()));
    r.game.advanceDays(30); expect(r.game.state.day).toBe(g.state.day + 30); // 이어서 진행도 된다
  });
  it('게임 저장 JSON만 있어도 가져온다(옛 형식 파일 포함)', () => {
    const g = played(), r = parseImport(JSON.stringify(g.toJSON())); expect(r.ok).toBe(true); if (r.ok) { expect(r.ach).toEqual([]); expect(r.game.state.seed).toBe(g.state.seed); }
    const old = g.toJSON() as unknown as Record<string, unknown>; old.formatVersion = 10; delete old.chronicle; delete old.hubs; delete old.era; delete old.nextEra; delete old.eraFree; delete old.contracts; delete old.contractsDone; delete old.nextOffer;
    const r2 = parseImport(JSON.stringify(old)); expect(r2.ok).toBe(true); if (r2.ok) expect(r2.game.state.formatVersion).toBe(13);
  });
  it('잘못된 파일은 이유와 함께 거절하고 게임을 망가뜨리지 않는다', () => {
    for (const bad of ['', '그냥 글자', '{"a":1}', '[]', 'null', '{"formatVersion":1}', JSON.stringify({ 'the-air-export': 1, game: { formatVersion: 99 } })]) {
      const r = parseImport(bad); expect(r.ok).toBe(false); if (!r.ok) expect(r.error.length).toBeGreaterThan(3);
    }
    const future = parseImport(JSON.stringify({ ...new Game(1).toJSON(), formatVersion: 99 })); expect(future.ok).toBe(false); if (!future.ok) expect(future.error).toContain('더 새로운');
  });
});

describe('알림 분류와 손익 분해', () => {
  it('알림 한 줄을 경쟁·시대·계약업적·경영으로 가른다', () => {
    const k = logKind;
    expect(k('5개월차: 신생 항공사 유로윙즈이(가) 런던을(를) 거점으로 취항을 시작했습니다')).toBe('rival');
    expect(k('9개월차: 한바다항공이(가) 파산했습니다. 노선 2개가 사라졌고')).toBe('rival');
    expect(k('12개월차: 운임 전쟁 — 그랜드 에어이(가) 서울 ⇄ 도쿄')).toBe('rival');
    expect(k('10개월차: 대형 항공사 글로벌 스카이이(가) 두바이를(를) 거점으로 시장에 진출했습니다')).toBe('rival');
    expect(k('30개월차: 탄소세 시대 시작 — 낡은 기체')).toBe('era'); expect(k('7개월차: 신기종 발표 — 보임 B7-57')).toBe('era'); expect(k('13개월차: 올림픽 예고 — 런던에서 6개월 뒤')).toBe('era');
    expect(k('8개월차: 계약 성사! — 승객 수송')).toBe('goal'); expect(k('3개월차: 새 계약 제안 — 새 도시 취항')).toBe('goal');
    expect(k('4개월차: 연료비 급등 — 국제 유가가 급등해')).toBe('biz'); expect(k('6개월차: 보임 B7-37 고장 — 정비 상태가 나빠')).toBe('biz'); expect(k('2개월차: 폭설 (런던) — 폭설로')).toBe('biz');
  });
  it('노선 손익 분해: 여객 수익 + 화물 수익 − 비용 요소들의 합이 하루 이익과 같다', () => {
    const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 999; const o = g.openRoute('ICN', 'LAX'); if (!o.ok) throw new Error(o.error);
    const b = g.buyForRoute(o.routeId, 'A350', 'new'); if (!b.ok) throw new Error(b.error); g.setCabin(b.planeId, 0.2);
    const d = g.routeDay(g.route(o.routeId)!);
    expect(d.revenuePax + d.cargoRevenue).toBeCloseTo(d.revenue, 9);
    expect(d.costOps + d.costLanding + d.costPax + d.compensation).toBeCloseTo(d.cost, 9);
    expect(d.revenuePax).toBeGreaterThan(0); expect(d.costOps).toBeGreaterThan(d.costLanding); expect(d.costOps).toBeGreaterThan(0);
  });
});
