// 합성 사운드: 음원 파일 없이 Web Audio로 효과음과 시대별 배경 음악을 만든다. 오디오가 없으면 모든 함수가 조용히 아무것도 하지 않는다.
export type Sfx =
  | 'tap' | 'tabSwitch' | 'toggle' | 'sliderTick' | 'open' | 'close' | 'error'
  | 'weekTick'
  | 'monthClose'
  | 'cashIn' | 'cashOut'
  | 'devStart' | 'designDone' | 'defectFixed' | 'readyToLaunch'
  | 'launch'
  | 'reviewGood' | 'reviewMid' | 'reviewBad'
  | 'hire' | 'fire' | 'train'
  | 'researchDone' | 'factoryBuilt' | 'hqUpgrade'
  | 'event' | 'regulation' | 'recall'
  | 'warning' | 'bankrupt' | 'award';
export interface SoundSettings { master: number; sfx: number; music: number; muted: boolean; weekTick: boolean }
export type Sound = ReturnType<typeof createSound>;

const KEY = 'car-company-sound';
export const SOUND_DEFAULTS: SoundSettings = { master: 0.8, sfx: 0.8, music: 0.35, muted: false, weekTick: false };
const MAX_VOICES = 8;
const DEDUPE_MS = 40;
const SFX_LEVEL = 2; // 음악 위로 효과음이 들리도록 합성 단계 음량을 한 번에 올린다
const TEMPO = [0.94, 1, 1.04, 1.08];

interface NoteOpts { type?: OscillatorType; gain?: number; a?: number; hold?: number; d?: number; cut?: number; glide?: number; detune?: number; fm?: [ratio: number, index: number, decay: number] }
interface Synth {
  n(t: number, f: number, o?: NoteOpts): void;
  z(t: number, d: number, g: number, cut: number, type?: BiquadFilterType, end?: number): void;
}
const m = (x: number): number => 440 * 2 ** ((x - 69) / 12);
const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const bell = (s: Synth, t: number, f: number, d: number, g: number, idx = 1.2): void => s.n(t, f, { fm: [3.5, idx, d * 0.5], d, gain: g });
const seq = (s: Synth, t: number, p: number, notes: number[], gap: number, o: NoteOpts): void => notes.forEach((x, i) => s.n(t + i * gap, m(x) * p, o));
const brass = (s: Synth, t: number, p: number, notes: number[], hold: number, d: number): void =>
  notes.forEach((x) => { s.n(t, m(x) * p, { type: 'sawtooth', cut: 1700, a: 0.025, hold, d, gain: 0.03 }); s.n(t, m(x - 12) * p, { a: 0.02, hold, d, gain: 0.03 }); });

// 이름이 Record 키라서 Sfx에 빠진 소리가 있으면 타입 검사에서 걸린다.
const SFX: Record<Sfx, (s: Synth, t: number, p: number) => void> = {
  tap: (s, t, p) => { s.n(t, 1050 * p, { d: 0.06, gain: 0.16, glide: 0.8 }); s.z(t, 0.012, 0.04, 2500, 'bandpass'); },
  tabSwitch: (s, t, p) => seq(s, t, p, [79, 84], 0.045, { type: 'triangle', cut: 3000, d: 0.08, gain: 0.11 }),
  toggle: (s, t, p) => s.n(t, 620 * p, { type: 'triangle', cut: 2400, d: 0.07, gain: 0.14, glide: 1.15 }),
  sliderTick: (s, t, p) => s.n(t, 1500 * p, { d: 0.025, gain: 0.05 }),
  open: (s, t, p) => { s.n(t, m(69) * p, { a: 0.02, d: 0.16, gain: 0.11, glide: 1.5 }); s.z(t, 0.14, 0.025, 1200, 'bandpass', 3500); },
  close: (s, t, p) => { s.n(t, m(76) * p, { a: 0.01, d: 0.14, gain: 0.1, glide: 0.67 }); s.z(t, 0.12, 0.02, 3000, 'bandpass', 1000); },
  error: (s, t, p) => { s.n(t, m(57) * p, { type: 'triangle', cut: 1200, d: 0.12, gain: 0.15 }); s.n(t + 0.13, m(56) * p, { type: 'triangle', cut: 1000, d: 0.18, gain: 0.15 }); },
  weekTick: (s, t, p) => s.n(t, 1760 * p, { d: 0.03, gain: 0.03 }),
  monthClose: (s, t, p) => { bell(s, t, m(84) * p, 0.6, 0.08); bell(s, t + 0.08, m(88) * p, 0.7, 0.07); },
  cashIn: (s, t, p) => seq(s, t, p, [79, 84, 88], 0.055, { type: 'triangle', cut: 4000, d: 0.22, gain: 0.1 }),
  cashOut: (s, t, p) => seq(s, t, p, [76, 72], 0.08, { type: 'triangle', cut: 1800, d: 0.2, gain: 0.1 }),
  devStart: (s, t, p) => [60, 67, 72].forEach((x) => s.n(t, m(x) * p, { type: 'triangle', cut: 1500, a: 0.12, d: 0.3, gain: 0.06 })),
  designDone: (s, t, p) => seq(s, t, p, [79, 86], 0.09, { type: 'triangle', cut: 3500, d: 0.3, gain: 0.1 }),
  defectFixed: (s, t, p) => { s.n(t, 700 * p, { d: 0.08, gain: 0.12, glide: 1.5 }); s.n(t + 0.07, m(84) * p, { type: 'triangle', cut: 3000, d: 0.15, gain: 0.07 }); },
  readyToLaunch: (s, t, p) => seq(s, t, p, [72, 76, 79, 84], 0.07, { type: 'triangle', cut: 3000, d: 0.3, gain: 0.08 }),
  launch: (s, t, p) => { brass(s, t, p, [67, 71, 74], 0.05, 0.12); brass(s, t + 0.16, p, [67, 71, 74], 0.04, 0.1); brass(s, t + 0.32, p, [72, 76, 79], 0.35, 0.6); bell(s, t + 0.32, m(84) * p, 1.0, 0.05); },
  reviewGood: (s, t, p) => seq(s, t, p, [72, 76, 79, 84], 0.09, { type: 'triangle', cut: 3500, d: 0.3, gain: 0.09 }),
  reviewMid: (s, t, p) => seq(s, t, p, [74, 74], 0.14, { type: 'triangle', cut: 2200, d: 0.22, gain: 0.1 }),
  reviewBad: (s, t, p) => seq(s, t, p, [76, 72, 69], 0.13, { type: 'triangle', cut: 1200, d: 0.3, gain: 0.1 }),
  hire: (s, t, p) => seq(s, t, p, [74, 81], 0.08, { type: 'triangle', cut: 3000, d: 0.25, gain: 0.1 }),
  fire: (s, t, p) => s.n(t, m(55) * p, { type: 'triangle', cut: 700, d: 0.3, gain: 0.15, glide: 0.85 }),
  train: (s, t, p) => seq(s, t, p, [84, 86, 88], 0.06, { d: 0.07, gain: 0.07 }),
  researchDone: (s, t, p) => { bell(s, t, m(88) * p, 0.8, 0.07); bell(s, t + 0.1, m(95) * p, 0.8, 0.04); s.n(t, m(76) * p, { a: 0.08, d: 0.5, gain: 0.04 }); },
  factoryBuilt: (s, t, p) => { s.n(t, 110 * p, { d: 0.25, gain: 0.22, glide: 0.5 }); s.z(t, 0.15, 0.06, 400); [55, 62, 67].forEach((x) => s.n(t + 0.05, m(x) * p, { type: 'triangle', cut: 1400, a: 0.02, d: 0.5, gain: 0.06 })); },
  hqUpgrade: (s, t, p) => [60, 67, 72, 76].forEach((x, i) => bell(s, t + i * 0.07, m(x) * p, 0.6, 0.06, 0.8)),
  event: (s, t, p) => { bell(s, t, m(81) * p, 0.4, 0.08, 0.8); bell(s, t + 0.12, m(76) * p, 0.5, 0.08, 0.8); },
  regulation: (s, t, p) => seq(s, t, p, [62, 69], 0.15, { type: 'triangle', cut: 1400, d: 0.3, gain: 0.11 }),
  recall: (s, t, p) => [0, 0.22].forEach((dt) => [65, 71].forEach((x) => s.n(t + dt, m(x) * p, { type: 'triangle', cut: 1500, d: 0.18, gain: 0.08 }))),
  warning: (s, t, p) => seq(s, t, p, [81, 81], 0.16, { type: 'triangle', cut: 2500, d: 0.09, gain: 0.11 }),
  bankrupt: (s, t, p) => { [60, 63, 67].forEach((x) => s.n(t, m(x) * p, { type: 'triangle', cut: 900, a: 0.05, hold: 0.3, d: 1.0, gain: 0.06, glide: 0.75 })); s.n(t, m(48) * p, { a: 0.05, hold: 0.3, d: 1.0, gain: 0.1, glide: 0.7 }); },
  award: (s, t, p) => { seq(s, t, p, [72, 76, 79], 0.08, { type: 'triangle', cut: 3500, d: 0.25, gain: 0.08 }); [72, 76, 79, 84].forEach((x) => bell(s, t + 0.26, m(x) * p, 0.9, 0.035, 0.8)); brass(s, t + 0.26, p, [72, 76, 79], 0.25, 0.5); },
};
export const SFX_NAMES = Object.keys(SFX) as Sfx[];

// ---- 배경 음악: 시대별 음색과 코드 진행, 마디 단위로 즉석에서 짠다 ----
type Chord = [pc: number, q: keyof typeof Q];
const Q = { M: [0, 4, 7], m: [0, 3, 7], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], d7: [0, 4, 7, 10], add9: [0, 4, 7, 14], sus2: [0, 2, 7], sus4: [0, 5, 7] };
const voicing = ([pc, q]: Chord): number[] => [...new Set(Q[q].map((i) => { let x = 48 + pc + i; while (x < 55) x += 12; while (x > 71) x -= 12; return x; }))].sort((a, b) => a - b);
const MAJOR = [0, 2, 4, 5, 7, 9, 11], PENTA = [0, 2, 4, 7, 9];
interface Bar { s: Synth; t: number; beat: number; len: number; v: number[]; root: number; dens: number; i: number; mel(pent?: boolean): number }
interface Era { bpm: number; send: number; progs: Chord[][]; bar(b: Bar): void }
const steps = (dens: number, max: number): number[] => [0, 1, 2, 3, 4, 5, 6, 7].filter(() => Math.random() < dens * max / 8);
const ep = (s: Synth, t: number, f: number, d: number, g: number): void => s.n(t, f, { fm: [1, 1.4, 0.25], d, gain: g });

const ERAS: Era[] = [
  { // 1970s: 일렉트릭 피아노 반주 + 부드러운 베이스
    bpm: 92, send: 0.15,
    progs: [[[5, 'maj7'], [4, 'm7'], [2, 'm7'], [0, 'maj7']], [[2, 'm7'], [7, 'd7'], [0, 'maj7'], [9, 'm7']], [[5, 'maj7'], [7, 'd7'], [4, 'm7'], [9, 'm7']], [[10, 'maj7'], [9, 'm7'], [2, 'm7'], [7, 'sus4']]],
    bar: ({ s, t, beat, v, root, dens, mel }) => {
      for (const st of pick([[0, 3], [0, 5], [2, 6], [0, 3, 6], [1, 4]])) for (const x of v) ep(s, t + st * beat / 2, m(x), beat * 1.4, 0.028);
      pick([[0, 4], [0, 3, 4, 7], [0, 6]]).forEach((st, k) => s.n(t + st * beat / 2, m(root + (k % 2 && Math.random() < 0.5 ? 7 : 0)), { type: 'triangle', cut: 500, a: 0.01, d: beat * 0.9, gain: 0.13 }));
      for (const st of steps(dens, 3)) ep(s, t + st * beat / 2, m(mel() + 12), beat, 0.03);
    },
  },
  { // 1980s: 신스 패드 + 아르페지오 + 8분 베이스
    bpm: 96, send: 0.25,
    progs: [[[9, 'm'], [5, 'M'], [0, 'M'], [7, 'M']], [[2, 'm'], [10, 'M'], [5, 'M'], [0, 'M']], [[9, 'm'], [7, 'M'], [5, 'maj7'], [7, 'sus4']], [[5, 'M'], [7, 'M'], [4, 'm'], [9, 'm']]],
    bar: ({ s, t, beat, len, v, root, dens }) => {
      for (const x of v) for (const dt of [-7, 7]) s.n(t, m(x), { type: 'sawtooth', detune: dt, cut: 900, a: 0.5, hold: len - 0.6, d: 0.8, gain: 0.011 });
      const tones = [...v, v[0] + 12], order = pick([[0, 1, 2, 3, 0, 1, 2, 3], [0, 1, 2, 3, 2, 1, 0, 1], [0, 2, 1, 3, 0, 2, 1, 3]]);
      order.forEach((k, st) => { if (Math.random() < 0.4 + dens * 0.6) s.n(t + st * beat / 2, m(tones[k % tones.length] + 12), { type: 'triangle', cut: 2200, d: 0.22, gain: 0.032 }); });
      const bassSteps = dens > 0.4 ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 4];
      bassSteps.forEach((st) => s.n(t + st * beat / 2, m(root + (st === 7 && Math.random() < 0.5 ? 12 : 0)), { type: 'sawtooth', cut: 320, d: 0.18, gain: 0.08 }));
    },
  },
  { // 1990s: 맑은 벨 + 패드
    bpm: 88, send: 0.3,
    progs: [[[0, 'add9'], [7, 'add9'], [9, 'm7'], [5, 'maj7']], [[5, 'maj7'], [0, 'add9'], [7, 'sus4'], [9, 'm7']], [[2, 'm7'], [5, 'maj7'], [0, 'add9'], [7, 'add9']]],
    bar: ({ s, t, beat, len, v, root, dens, mel }) => {
      for (const x of v) s.n(t, m(x), { a: 0.8, hold: len - 0.8, d: 1.2, gain: 0.022 });
      for (const st of steps(dens, 4)) bell(s, t + st * beat / 2, m(mel() + 12), 1.6, 0.035, 0.8);
      [0, 2].forEach((b) => s.n(t + b * beat, m(root), { a: 0.02, d: beat * 1.8, gain: 0.11 }));
    },
  },
  { // 2000s: 앰비언트 패드 + 플럭
    bpm: 84, send: 0.35,
    progs: [[[9, 'm7'], [5, 'maj7'], [0, 'add9'], [7, 'sus2']], [[0, 'maj7'], [9, 'm7'], [5, 'add9'], [7, 'sus4']], [[4, 'm7'], [5, 'maj7'], [9, 'm7'], [7, 'sus2']]],
    bar: ({ s, t, beat, len, v, root, dens, mel }) => {
      for (const x of v) s.n(t, m(x), { a: 1.2, hold: len - 1, d: 1.5, gain: 0.017 });
      for (const st of steps(dens, 5)) s.n(t + st * beat / 2, m(mel(true) + 12), { type: 'triangle', cut: 1600, d: 0.3, gain: 0.045 });
      s.n(t, m(root), { a: 0.05, hold: len * 0.6, d: len * 0.3, gain: 0.07 });
    },
  },
  { // 2010s 이후: 미니멀 플럭 + 서브 베이스, 넓은 울림
    bpm: 80, send: 0.45,
    progs: [[[2, 'sus2'], [10, 'maj7'], [5, 'add9'], [0, 'sus2']], [[9, 'm7'], [9, 'm7'], [5, 'maj7'], [5, 'maj7']], [[0, 'add9'], [4, 'm7'], [5, 'add9'], [5, 'm']]],
    bar: ({ s, t, beat, len, v, root, dens, i, mel }) => {
      for (const st of steps(dens, 3)) s.n(t + st * beat / 2, m(mel(true) + 12), { fm: [2, 0.6, 0.1], d: 0.5, gain: 0.05 });
      s.n(t, m(root), { a: 0.3, hold: len - 1, d: 1, gain: 0.065 });
      if (i % 2 === 0) for (const x of v.slice(-2)) s.n(t, m(x), { a: 1.5, hold: len, d: 2, gain: 0.015 });
    },
  },
];
export const eraOf = (year: number): number => year < 1980 ? 0 : year < 1990 ? 1 : year < 2000 ? 2 : year < 2010 ? 3 : 4;

function clean(p: Partial<Record<keyof SoundSettings, unknown>>, base: SoundSettings): SoundSettings {
  const num = (v: unknown, d: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d;
  const bool = (v: unknown, d: boolean) => typeof v === 'boolean' ? v : d;
  return { master: num(p.master, base.master), sfx: num(p.sfx, base.sfx), music: num(p.music, base.music), muted: bool(p.muted, base.muted), weekTick: bool(p.weekTick, base.weekTick) };
}
function load(): SoundSettings {
  try { const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (raw && typeof raw === 'object') return clean(raw, SOUND_DEFAULTS); } catch { /* 저장소 없음·깨진 값 */ }
  return { ...SOUND_DEFAULTS };
}
// resume/suspend/close가 거부(reject)돼도 콘솔 오류를 남기지 않게
const quiet = (p: unknown): void => { if (p instanceof Promise) p.catch(() => {}); };

/** makeCtx는 테스트·측정용(OfflineAudioContext 등)이다. 게임에서는 인자 없이 부른다. */
export function createSound(makeCtx?: () => BaseAudioContext | null) {
  let cur = load();
  let ctx: BaseAudioContext | null = null;
  let master: GainNode, sfxBus: GainNode, musicBus: GainNode, delayIn: GainNode, delay: DelayNode, noiseBuf: AudioBuffer;
  let layer: { dry: GainNode; send: GainNode } | null = null;
  let disposed = false, unlocked = false, paused = false, hidden = false;
  let era = 0, speed: 0 | 1 | 2 | 3 = 1, timer: ReturnType<typeof setInterval> | null = null, nextBar = 0, barN = 0, dens = 0.6, prog: Chord[] = ERAS[0].progs[0], melIdx = 7;
  const last = new Map<Sfx, number>();
  let voices: number[] = [];
  let out: AudioNode, outGain = 1, lastEnd = 0;

  const safe = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A): void => { if (disposed) return; try { fn(...a); } catch { /* 오디오 실패가 게임을 멈추면 안 된다 */ } };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);

  const synth: Synth = {
    n(t, f, o = {}) {
      const c = ctx!, a = o.a ?? 0.004, d = o.d ?? 0.2, hold = o.hold ?? 0, peak = (o.gain ?? 0.1) * outGain, end = t + a + hold + d;
      const osc = c.createOscillator(), env = c.createGain();
      osc.type = o.type ?? 'sine';
      osc.frequency.setValueAtTime(f, t);
      if (o.glide) osc.frequency.exponentialRampToValueAtTime(f * o.glide, end);
      if (o.detune) osc.detune.value = o.detune;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + a);
      if (hold) env.gain.linearRampToValueAtTime(peak * 0.75, t + a + hold);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      let head: AudioNode = osc;
      if (o.cut) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.cut; fl.Q.value = 0.5; osc.connect(fl); head = fl; }
      head.connect(env); env.connect(out);
      if (o.fm) {
        const [ratio, idx, dec] = o.fm, mod = c.createOscillator(), mg = c.createGain();
        mod.frequency.value = f * ratio;
        mg.gain.setValueAtTime(f * idx, t); mg.gain.exponentialRampToValueAtTime(f * idx * 0.05 + 0.01, t + dec);
        mod.connect(mg); mg.connect(osc.frequency); mod.start(t); mod.stop(end + 0.02);
      }
      osc.start(t); osc.stop(end + 0.02);
      osc.onended = () => env.disconnect();
      lastEnd = Math.max(lastEnd, end);
    },
    z(t, d, g, cut, type = 'lowpass', end) {
      const c = ctx!, src = c.createBufferSource(), fl = c.createBiquadFilter(), env = c.createGain();
      src.buffer = noiseBuf; fl.type = type; fl.frequency.setValueAtTime(cut, t); fl.Q.value = type === 'bandpass' ? 1.2 : 0.5;
      if (end) fl.frequency.exponentialRampToValueAtTime(end, t + d);
      env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(g * outGain, t + 0.003); env.gain.exponentialRampToValueAtTime(0.0001, t + d);
      src.connect(fl); fl.connect(env); env.connect(out);
      src.start(t, Math.random() * 0.5); src.stop(t + d + 0.02);
      src.onended = () => env.disconnect();
      lastEnd = Math.max(lastEnd, t + d);
    },
  };

  function applyGains(): void {
    if (!ctx) return;
    const t = ctx.currentTime, musicOn = !paused && !hidden;
    master.gain.setTargetAtTime(cur.muted ? 0 : cur.master, t, 0.03);
    sfxBus.gain.setTargetAtTime(cur.sfx, t, 0.03);
    musicBus.gain.setTargetAtTime(musicOn ? cur.music : 0, t, musicOn ? 0.5 : 0.15);
  }

  function newLayer(): void {
    if (!ctx) return;
    const c = ctx, t = c.currentTime;
    if (layer) { const old = layer; old.dry.gain.setTargetAtTime(0, t, 0.6); setTimeout(() => { try { old.dry.disconnect(); old.send.disconnect(); } catch { /* 이미 닫힘 */ } }, 5000); }
    const dry = c.createGain(), send = c.createGain();
    dry.gain.setValueAtTime(0, t); dry.gain.setTargetAtTime(1, t, 0.6);
    send.gain.value = ERAS[era].send;
    dry.connect(musicBus); dry.connect(send); send.connect(delayIn);
    layer = { dry, send };
  }

  function init(): void {
    if (ctx || disposed) return;
    const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = g.AudioContext ?? g.webkitAudioContext;
    try { ctx = makeCtx ? makeCtx() : AC ? new AC() : null; } catch { ctx = null; }
    if (!ctx) return;
    try {
      const c = ctx;
      master = c.createGain(); sfxBus = c.createGain(); musicBus = c.createGain();
      const comp = c.createDynamicsCompressor(), shaper = c.createWaveShaper();
      comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.2;
      // 압축기가 못 잡은 순간 피크를 부드럽게 눌러 절대 1을 넘지 않게
      const curve = new Float32Array(1025);
      for (let i = 0; i < curve.length; i++) { const x = i / 512 - 1, ax = Math.abs(x); curve[i] = ax < 0.6 ? x : Math.sign(x) * (0.6 + 0.38 * Math.tanh((ax - 0.6) / 0.38)); }
      shaper.curve = curve;
      sfxBus.connect(master); musicBus.connect(master); master.connect(comp); comp.connect(shaper); shaper.connect(c.destination);
      delay = c.createDelay(2); const fb = c.createGain(), lp = c.createBiquadFilter();
      delayIn = c.createGain(); delayIn.connect(delay);
      delay.delayTime.value = 0.75 * 60 / ERAS[era].bpm; fb.gain.value = 0.35; lp.type = 'lowpass'; lp.frequency.value = 2000;
      delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(musicBus);
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      master.gain.value = cur.muted ? 0 : cur.master; sfxBus.gain.value = cur.sfx; musicBus.gain.value = 0;
      newLayer(); applyGains();
    } catch { ctx = null; }
  }

  function scheduleBar(t: number): void {
    const e = ERAS[era], len = 240 / (e.bpm * TEMPO[speed]);
    if (barN % 8 === 0) { dens = Math.random() < 0.2 ? 0.15 : pick([0.35, 0.6, 0.85]); prog = pick(e.progs); }
    else if (barN % 4 === 0 && Math.random() < 0.4) prog = pick(e.progs);
    const chord = prog[barN % prog.length], v = voicing(chord);
    const mel = (pent = false): number => {
      const sc = pent ? PENTA : MAJOR, n = sc.length * 2;
      melIdx = Math.min(n - 1, Math.max(0, melIdx + pick([-2, -1, -1, 0, 1, 1, 2])));
      let x = 55 + 12 * Math.floor(melIdx / sc.length) + sc[melIdx % sc.length];
      // 박자 강세가 코드 밖 음에 몰리지 않게 절반은 가까운 코드 음으로 붙인다
      if (Math.random() < 0.5) { const pcs = Q[chord[1]].map((i) => (chord[0] + i) % 12); while (!pcs.includes(x % 12)) x--; }
      return x;
    };
    out = layer!.dry; outGain = 1;
    e.bar({ s: synth, t, beat: len / 4, len, v, root: 36 + chord[0], dens, i: barN, mel });
    barN++;
  }

  function tick(): void {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (nextBar < t) nextBar = t + 0.05;
    while (nextBar < t + 0.6) { scheduleBar(nextBar); nextBar += 240 / (ERAS[era].bpm * TEMPO[speed]); }
  }

  function updateMusic(): void {
    const want = !!ctx && unlocked && !paused && !hidden && !cur.muted && cur.music > 0 && !disposed;
    if (want && !timer) { nextBar = ctx!.currentTime + 0.1; barN = 0; tick(); timer = setInterval(safe(tick), 200); }
    if (!want && timer) { clearInterval(timer); timer = null; }
  }

  const onVis = safe(() => {
    hidden = document.hidden;
    if (ctx && unlocked) quiet(hidden ? (ctx as AudioContext).suspend?.() : (ctx as AudioContext).resume?.());
    applyGains(); updateMusic();
  });
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);

  return {
    unlock: safe(() => {
      init();
      if (!ctx) return;
      const c = ctx as AudioContext;
      if (c.state !== 'running') quiet(c.resume?.());
      if (!unlocked) { const src = c.createBufferSource(); src.buffer = c.createBuffer(1, 1, 22050); src.connect(c.destination); src.start(0); }
      unlocked = true; updateMusic();
    }),
    play: safe((name: Sfx, opts?: { pitch?: number; gain?: number }) => {
      if (!ctx || cur.muted || cur.sfx === 0 || (name === 'weekTick' && !cur.weekTick) || !SFX[name]) return;
      const ms = now();
      if (ms - (last.get(name) ?? -1e9) < DEDUPE_MS) return;
      const t = ctx.currentTime + 0.01;
      voices = voices.filter((e) => e > t);
      if (voices.length >= MAX_VOICES) return;
      last.set(name, ms);
      // 같은 소리가 반복돼도 기계적으로 들리지 않게 ±25센트 흔든다
      const p = (opts?.pitch ?? 1) * 2 ** ((Math.random() - 0.5) * 0.5 / 12);
      out = sfxBus; outGain = SFX_LEVEL * Math.min(2, Math.max(0, opts?.gain ?? 1)); lastEnd = t;
      SFX[name](synth, t, p);
      voices.push(lastEnd);
    }),
    setEra: safe((year: number) => {
      const e = eraOf(year);
      if (e === era) return;
      era = e;
      if (!ctx) return;
      newLayer();
      delay.delayTime.setTargetAtTime(0.75 * 60 / ERAS[era].bpm, ctx.currentTime, 0.5);
      barN = 0; nextBar = ctx.currentTime + 0.05;
    }),
    setPaused: safe((p: boolean) => { paused = p; applyGains(); updateMusic(); }),
    setTempo: safe((s: 0 | 1 | 2 | 3) => { if (TEMPO[s] !== undefined) speed = s; }),
    settings: (): SoundSettings => ({ ...cur }),
    set: safe((patch: Partial<SoundSettings>) => {
      cur = clean(patch, cur);
      try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* 저장 불가(사생활 보호 모드 등) */ }
      applyGains(); updateMusic();
    }),
    dispose: safe(() => {
      if (timer) clearInterval(timer);
      timer = null;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      if (ctx) quiet((ctx as AudioContext).close?.());
      ctx = null; disposed = true;
    }),
  };
}
