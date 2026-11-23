import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSound, SFX_NAMES, SOUND_DEFAULTS, eraOf, type Sfx } from '../src/ui/sound';

const memStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

// 최소 가짜 AudioContext: 만든 노드 수만 센다
function fakeCtx() {
  const made = { osc: 0, src: 0 };
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() });
  const node = (extra: object = {}) => ({ connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null, gain: param(), frequency: param(), detune: param(), Q: param(), delayTime: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), type: '', curve: null, buffer: null, ...extra });
  const ctx = {
    currentTime: 0, sampleRate: 8000, state: 'suspended', destination: node(),
    createGain: () => node(), createBiquadFilter: () => node(), createDynamicsCompressor: () => node(), createWaveShaper: () => node(), createDelay: () => node(),
    createOscillator: () => { made.osc++; return node(); },
    createBufferSource: () => { made.src++; return node(); },
    createBuffer: (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) }),
    resume: vi.fn(() => Promise.resolve()), suspend: vi.fn(() => Promise.resolve()), close: vi.fn(() => Promise.reject(new Error('x'))),
  };
  return { ctx, made };
}

afterEach(() => vi.unstubAllGlobals());

describe('사운드 모듈', () => {
  it('AudioContext가 없으면 모든 메서드가 예외 없이 아무것도 안 한다', () => {
    expect((globalThis as { AudioContext?: unknown }).AudioContext).toBeUndefined();
    const s = createSound();
    s.unlock(); s.unlock();
    for (const n of SFX_NAMES) s.play(n, { pitch: 1.2, gain: 0.5 });
    s.play('없는소리' as Sfx);
    s.setEra(1985); s.setPaused(true); s.setPaused(false); s.setTempo(3);
    s.set({ music: 0.5 });
    expect(s.settings()).toEqual({ ...SOUND_DEFAULTS, music: 0.5 });
    s.dispose(); s.play('tap'); s.unlock();
  });

  it('설정: 기본값, 저장·불러오기, 범위 자르기, 깨진 값 무시', () => {
    const ls = memStore();
    vi.stubGlobal('localStorage', ls);
    expect(createSound().settings()).toEqual(SOUND_DEFAULTS);
    const a = createSound();
    a.set({ master: 2, sfx: -1, music: NaN, muted: true, weekTick: 'yes' as unknown as boolean });
    expect(a.settings()).toEqual({ master: 1, sfx: 0, music: 0.35, muted: true, weekTick: false });
    expect(createSound().settings()).toEqual(a.settings());
    ls.m.set('car-company-sound', '{깨짐');
    expect(createSound().settings()).toEqual(SOUND_DEFAULTS);
    ls.m.set('car-company-sound', JSON.stringify({ music: 0.1, master: 'x' }));
    expect(createSound().settings()).toEqual({ ...SOUND_DEFAULTS, music: 0.1 });
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('막힘'); }, setItem: () => { throw new Error('막힘'); } });
    const b = createSound(); b.set({ sfx: 0.3 });
    expect(b.settings().sfx).toBe(0.3);
  });

  it('모든 효과음이 정의돼 있고, 가짜 오디오에서 노드를 만들며 예외가 없다', () => {
    vi.stubGlobal('localStorage', memStore());
    expect(SFX_NAMES.length).toBe(31);
    for (const n of SFX_NAMES) {
      const { ctx, made } = fakeCtx();
      const s = createSound(() => ctx as unknown as BaseAudioContext);
      s.set({ music: 0, weekTick: true });
      s.unlock();
      const before = made.osc + made.src;
      s.play(n);
      expect(made.osc + made.src, n).toBeGreaterThan(before);
      s.dispose();
    }
  });

  it('같은 소리 40ms 안 중복 무시, 꺼진 weekTick·음소거는 소리를 안 만든다', () => {
    vi.stubGlobal('localStorage', memStore());
    vi.useFakeTimers(); // 느린 CI에서 두 번의 play 사이가 실제로 40ms를 넘은 적이 있다(1.5.0 PR)
    try {
      const { ctx, made } = fakeCtx();
      const s = createSound(() => ctx as unknown as BaseAudioContext);
      s.set({ music: 0 }); s.unlock();
      const n0 = made.osc; s.play('tap'); const n1 = made.osc; s.play('tap');
      expect(n1).toBeGreaterThan(n0); expect(made.osc).toBe(n1);
      s.play('weekTick'); expect(made.osc).toBe(n1);
      s.set({ muted: true }); s.play('launch'); expect(made.osc).toBe(n1);
    } finally { vi.useRealTimers(); }
  });

  it('음악: 잠금 해제 후 마디를 예약하고 시대 전환·일시정지·정리에서 예외가 없다', () => {
    vi.stubGlobal('localStorage', memStore());
    vi.useFakeTimers();
    try {
      for (const year of [1970, 1985, 1995, 2005, 2020]) {
        const { ctx, made } = fakeCtx();
        const s = createSound(() => ctx as unknown as BaseAudioContext);
        s.setEra(year); s.unlock();
        expect(made.osc, String(year)).toBeGreaterThan(0);
        for (let i = 0; i < 40; i++) { ctx.currentTime += 0.2; vi.advanceTimersByTime(200); }
        s.setEra(year + 10); s.setTempo(2); s.setPaused(true); s.setPaused(false);
        vi.advanceTimersByTime(6000);
        s.dispose();
      }
    } finally { vi.useRealTimers(); }
    expect([1979, 1980, 1999, 2000, 2010, 2035].map(eraOf)).toEqual([0, 1, 2, 3, 4, 4]);
  });
});
