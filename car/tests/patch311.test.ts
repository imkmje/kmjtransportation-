// 3.1.1 패치 재현 테스트: 전동화 전환의 점진 전환(2010년대 바닥), 조 단위 금액 표기. (틈새·전동화 이익 비교는 sub300, 히트작 표시는 rival200)
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { config } from '../src/config';
import { Game } from '../src/sim/game';
import { chargingInfra } from '../src/sim/events';
import { money } from '../src/ui/fmt';
import { grant, ok } from './util';

vi.setConfig({ testTimeout: 120_000 });
const fixture = () => JSON.parse(readFileSync('car/tests/fixtures/save-v8.json', 'utf8'));

describe('3.1.1', () => {
  it('전동화 전환: 충전 인프라가 모자란 2010년대 초에는 라인업 일부만 전기차(모델 수 × 인프라 × evPace, 올림), 나머지는 가솔린', () => {
    const g = Game.fromJSON(fixture()), s = g.state;
    s.week = (2012 - 1970) * 48; grant(g); s.cash = 1e10;
    ok(g.command({ type: 'foundSubsidiary', kind: 'value' }));
    const id = s.subs![0].id;
    ok(g.command({ type: 'investSub', subId: id, amount: 6e7 })); // 모델 여러 개를 둘 자본
    ok(g.command({ type: 'setSubStrategy', subId: id, strategy: 'ev' }));
    for (let i = 0; i < 48 * 2; i++) g.tick();
    const sub = s.subs![0], n = sub.models.length, ev = sub.models.filter((m) => m.ev).length, m = Math.floor(s.week / 4);
    const want = Math.ceil(n * Math.min(1, chargingInfra(s.seed, m) * config.subs.evPace) - 1e-9);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(ev).toBeGreaterThan(0); expect(ev).toBeLessThan(n); // 3.1.0은 전부 전기차였다
    expect(ev).toBeLessThanOrEqual(want);
  });
  it('금액 표기: 억을 먼저 반올림하고(1조 10,000억 없음), 자회사 뉴스도 조 단위로', () => {
    expect(money(199996000)).toBe('2조'); expect(money(1.5e8)).toBe('1조 5,000억'); expect(money(-123456789)).toBe('−1조 2,346억');
    const g = Game.fromJSON(fixture());
    ok(g.command({ type: 'foundSubsidiary', kind: 'premium' }));
    g.state.subs![0].capital = 5e8;
    ok(g.command({ type: 'sellSubsidiary', subId: g.state.subs![0].id }));
    expect(g.state.events.news.at(-1)!.text).toContain('3조 5,000억원에 매각');
  });
});
