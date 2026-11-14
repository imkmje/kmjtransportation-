import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/sim/game';
import { advise } from '../src/sim/advice';
import { achieved } from '../src/sim/achievements';

// 2.11.0이 실제로 만든 자유 모드 저장(30개월차, 운수권, 마일리지·51% 자회사 있음). 2.12.0 이후에 생긴 저장 항목은 하나도 없다
const OLD = JSON.parse(readFileSync(new URL('./fixtures-save-2.11.0.json', import.meta.url), 'utf8'));

describe('옛 저장(2.11.0) 불러오기', () => {
  it('새 항목이 없는 저장을 불러와 새 기능을 모두 써도 오류 없이 3년을 진행하고, 다시 저장·불러오기 된다', () => {
    expect(OLD.alli).toBeUndefined(); expect(OLD.ipo).toBeUndefined(); expect(OLD.rules).toBeUndefined();
    const g = Game.fromJSON(JSON.parse(JSON.stringify(OLD))); g.state.cash += 5000;
    expect(g.state.status).toBe('playing');
    // 화면이 매번 부르는 계산들
    advise(g); achieved(g); g.recommendRoutes(3); g.transferFlows(g.state.base); g.runway(); void g.megaMult; void g.companyValue; void g.eliteBiz;
    for (const c of g.state.competitors) g.forecastOf(c);
    // 새 기능
    const ok = (r: { ok: boolean }) => r.ok;
    expect(ok(g.setCard(true))).toBe(true); expect(ok(g.startPromo())).toBe(true);
    expect(ok(g.foundSubsidiary({ name: '옛판항공', hub: g.state.base, kind: 'low', size: 0 }))).toBe(true);
    expect(ok(g.startCampaign('national'))).toBe(true); expect(ok(g.investGreen())).toBe(true);
    expect(ok(g.refitCabin(g.state.planes.find((p) => !p.leased)!.id))).toBe(true);
    expect(ok(g.setDynasty('fleet'))).toBe(true); expect(ok(g.goPublic())).toBe(false); // 30개월차라 아직 상장 불가
    const free = g.state.competitors.find((c) => !c.major && !c.stake && !g.state.rivalAlliance?.includes(c.id));
    if (free) { expect(ok(g.joinAlliance(free.id))).toBe(true); expect(ok(g.setAllianceName('옛판 연합'))).toBe(true); }
    g.setRule('contracts', true); g.setAutoFreq(true);
    for (let i = 0; i < 36 && g.state.status === 'playing'; i++) { if (i === 6) expect(ok(g.goPublic())).toBe(true); g.applyRules(); if (g.state.story) g.chooseStory(g.storyDef()!.choices.length - 1); g.advanceDays(30); }
    expect(['playing', 'bankrupt']).toContain(g.state.status);
    const back = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(back.state.cash).toBe(g.state.cash); expect(back.state.ipo?.price).toBe(g.state.ipo?.price); expect(back.state.alli?.name).toBe(g.state.alli?.name);
  });
});
