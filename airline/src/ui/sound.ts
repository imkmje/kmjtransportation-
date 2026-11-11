/**
 * 소리: 파일 없이 WebAudio로 합성한다. 모든 소리는 한 버스(잔향 + 압축기)를 지나 한 공간에서 나는 것처럼 들린다.
 * 첫 터치 뒤에만 켜지고(브라우저 규칙), 메뉴에서 효과음·배경 음악을 따로 끌 수 있다.
 */
export type Sfx = 'tap' | 'ok' | 'buy' | 'sell' | 'takeoff' | 'coin' | 'alert' | 'error' | 'achieve' | 'win' | 'lose';
export const SFX: Sfx[] = ['tap', 'ok', 'buy', 'sell', 'takeoff', 'coin', 'alert', 'error', 'achieve', 'win', 'lose'];
type Ctx = BaseAudioContext;
interface Bus { ctx: Ctx; dry: GainNode; wet: GainNode; music: GainNode }

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** 잔향용 충격 응답: 점점 작아지는 잡음(좌우가 달라 넓게 들린다) */
function impulse(ctx: Ctx, seconds: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6); }
  return buf;
}
function makeBus(ctx: Ctx): Bus {
  const comp = ctx.createDynamicsCompressor(); // 여러 소리가 겹쳐도 찢어지지 않게 누른다
  comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
  comp.connect(ctx.destination);
  const dry = ctx.createGain(); dry.gain.value = 0.9; dry.connect(comp);
  const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, 2.4);
  const wet = ctx.createGain(); wet.gain.value = 0.5; wet.connect(conv); conv.connect(comp);
  const music = ctx.createGain(); music.gain.value = vol.music; music.connect(dry); music.connect(wet);
  return { ctx, dry, wet, music };
}

// ---- 악기 ----
interface ToneOpt { type?: OscillatorType; gain?: number; attack?: number; to?: number; wet?: number; cutoff?: number; detune?: number; out?: AudioNode }
/** 한 음: 주파수 f에서 시작(to가 있으면 미끄러짐), dur 동안 사라진다 */
function tone(b: Bus, f: number, t: number, dur: number, o: ToneOpt = {}) {
  const { ctx } = b, osc = ctx.createOscillator(), g = ctx.createGain(), peak = (o.gain ?? 0.1) * (o.out ? 1 : vol.sfx), at = o.attack ?? 0.005; // 음악(out 지정)은 효과음 크기의 영향을 받지 않는다
  osc.type = o.type ?? 'sine'; osc.frequency.setValueAtTime(f, t); if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  if (o.detune) osc.detune.value = o.detune;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + at); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node: AudioNode = osc;
  if (o.cutoff) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.cutoff; lp.Q.value = 0.6; osc.connect(lp); node = lp; }
  node.connect(g);
  if (o.out) g.connect(o.out); else { g.connect(b.dry); if (o.wet) { const w = ctx.createGain(); w.gain.value = o.wet; g.connect(w); w.connect(b.wet); } }
  osc.start(t); osc.stop(t + dur + 0.05);
}
/** 종소리(기내 안내 차임 느낌): 기본음에 어긋난 배음 두 개를 얹어 금속성 울림을 만든다 */
function bell(b: Bus, f: number, t: number, dur: number, gain = 0.1, out?: AudioNode) {
  tone(b, f, t, dur, { gain, wet: 0.6, out });
  tone(b, f * 2.76, t, dur * 0.45, { gain: gain * 0.28, wet: 0.6, out });
  tone(b, f * 5.4, t, dur * 0.2, { gain: gain * 0.12, wet: 0.6, out });
  tone(b, f * 2, t, dur * 0.7, { gain: gain * 0.2, type: 'triangle', wet: 0.4, out });
}
/** 잡음 쓸기(바람·엔진): 대역 필터가 from → to로 움직인다 */
function whoosh(b: Bus, t: number, dur: number, from: number, to: number, gain = 0.1) {
  gain *= vol.sfx;
  const { ctx } = b, n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1; bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const w = ctx.createGain(); w.gain.value = 0.5;
  src.connect(bp); bp.connect(g); g.connect(b.dry); g.connect(w); w.connect(b.wet);
  src.start(t); src.stop(t + dur);
}

// ---- 효과음 ----
function trigger(b: Bus, name: Sfx, t: number) {
  const seq = (notes: number[], step: number, dur: number, gain: number) => notes.forEach((n, i) => bell(b, midi(n), t + i * step, dur, gain));
  switch (name) {
    case 'tap': tone(b, 1100, t, 0.05, { to: 620, gain: 0.07, type: 'triangle' }); break; // 가벼운 톡
    case 'ok': seq([76, 83], 0.07, 0.35, 0.07); break; // 확인: 밝은 두 음
    case 'buy': whoosh(b, t, 0.08, 3000, 6000, 0.05); seq([79, 86, 91], 0.06, 0.6, 0.075); break; // 구매: 계산대 느낌의 빠른 세 음
    case 'sell': seq([86, 79], 0.08, 0.45, 0.07); break; // 매각: 내려가는 두 음
    case 'takeoff': whoosh(b, t, 1.3, 260, 2600, 0.11); tone(b, 150, t, 1.2, { to: 420, gain: 0.05, type: 'sawtooth', cutoff: 700, wet: 0.4 }); bell(b, midi(88), t + 0.9, 0.7, 0.04); break; // 이륙: 엔진이 올라가는 바람 소리
    case 'coin': bell(b, midi(79), t, 1.4, 0.09); bell(b, midi(74), t + 0.32, 1.8, 0.09); break; // 월말: 기내 안내 "딩-동"
    case 'alert': bell(b, midi(81), t, 0.5, 0.08); bell(b, midi(77), t + 0.2, 0.5, 0.08); bell(b, midi(81), t + 0.4, 0.5, 0.08); bell(b, midi(77), t + 0.6, 0.9, 0.08); break; // 사건: 주의를 끄는 반복 두 음
    case 'error': tone(b, 170, t, 0.14, { type: 'square', gain: 0.05, cutoff: 600 }); tone(b, 130, t + 0.12, 0.2, { type: 'square', gain: 0.05, cutoff: 500 }); break; // 안 됨: 낮고 짧게
    case 'achieve': seq([84, 88, 91, 96, 100], 0.07, 1.1, 0.06); break; // 업적: 반짝이며 올라간다
    case 'win': seq([72, 76, 79, 84], 0.14, 1.6, 0.08); [60, 64, 67, 72].forEach((n) => tone(b, midi(n), t + 0.56, 2.6, { gain: 0.045, type: 'triangle', attack: 0.3, wet: 0.7 })); bell(b, midi(96), t + 0.9, 2, 0.05); break; // 승리: 장조로 올라가 화음으로 맺는다
    case 'lose': seq([69, 65, 62, 57], 0.3, 1.8, 0.07); tone(b, midi(45), t + 0.9, 2.4, { gain: 0.06, attack: 0.4, wet: 0.7, cutoff: 500, type: 'triangle' }); break; // 패배: 단조로 내려간다
  }
}

// ---- 배경 음악: 여덟 마디 화음 진행 위에, 화음 구성음으로 드문드문 종소리 선율을 얹는다 ----
const BAR = 6; // 한 마디(초)
const CHORDS = [[48, 55, 64, 71], [45, 52, 60, 67], [41, 48, 57, 64], [43, 50, 59, 64], [40, 47, 55, 62], [45, 52, 60, 67], [38, 45, 53, 60], [43, 50, 57, 62]]; // Cmaj7 · Am7 · Fmaj7 · G6 · Em7 · Am7 · Dm7 · Gsus
function musicBar(b: Bus, bar: number, t: number) {
  const ch = CHORDS[bar % CHORDS.length];
  for (const n of ch) for (const det of [-7, 7]) tone(b, midi(n), t, BAR + 2.5, { type: 'sawtooth', gain: 0.011, attack: 2.2, cutoff: 750, detune: det, out: b.music }); // 따뜻한 패드(살짝 어긋난 두 겹)
  tone(b, midi(ch[0] - 12), t, BAR + 1, { gain: 0.03, attack: 0.8, out: b.music }); // 베이스
  let seed = (bar * 2654435761) >>> 0; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 4; i++) { if (rnd() < 0.3) continue; const n = ch[1 + Math.floor(rnd() * 3)] + 12 + (rnd() < 0.3 ? 12 : 0); bell(b, midi(n), t + i * (BAR / 4) + rnd() * 0.3, 2.6, 0.022, b.music); } // 선율: 마디마다 다르지만 같은 마디는 늘 같다
}

// ---- 재생 ----
const KEY = 'the-air-sound', MKEY = 'the-air-music', VKEY = 'the-air-volume';
const vol = { sfx: 1, music: 1 }; // 0~1.5 (기본 1)
try { const v = JSON.parse(localStorage.getItem(VKEY) ?? '{}'); if (typeof v.sfx === 'number') vol.sfx = v.sfx; if (typeof v.music === 'number') vol.music = v.music; } catch { /* 저장 불가 */ }
let bus: Bus | null = null, on = true, musicWanted = true, timer = 0, bar = 0, nextBar = 0;
try { on = localStorage.getItem(KEY) !== 'off'; musicWanted = localStorage.getItem(MKEY) !== 'off'; } catch { /* 저장 불가 */ }
function live(): Bus | null {
  try { bus ??= makeBus(new AudioContext()); const c = bus.ctx as AudioContext; if (c.state === 'suspended') void c.resume(); return bus; } catch { return null; } // 소리를 못 내는 환경은 조용히 넘어간다
}
export const soundOn = () => on;
export function setSound(v: boolean) { on = v; try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch { /* 저장 불가 */ } }
export function play(name: Sfx) { if (!on) return; const b = live(); if (b) trigger(b, name, b.ctx.currentTime + 0.01); }

export const musicOn = () => musicWanted;
export const volumes = () => ({ ...vol });
/** 효과음·음악 크기(0~1.5). 음악은 바로 반영된다 */
export function setVolumes(v: { sfx?: number; music?: number }) {
  if (v.sfx !== undefined) vol.sfx = Math.min(1.5, Math.max(0, v.sfx));
  if (v.music !== undefined) vol.music = Math.min(1.5, Math.max(0, v.music));
  try { localStorage.setItem(VKEY, JSON.stringify(vol)); } catch { /* 저장 불가 */ }
  if (bus && musicWanted) bus.music.gain.linearRampToValueAtTime(vol.music, bus.ctx.currentTime + 0.1);
}
function tick() {
  if (!bus || document.hidden) return;
  if (bus.ctx.state !== 'running') void (bus.ctx as AudioContext).resume().catch(() => undefined); // 팝업·전화 등으로 멈춘 소리를 되살린다
  const now = bus.ctx.currentTime;
  if (nextBar < now) nextBar = now + 0.1; // 탭이 숨겨졌다 돌아오면 지금부터 다시
  while (nextBar < now + 1.5) { musicBar(bus, bar++, nextBar); nextBar += BAR; } // 조금 앞서 예약해 끊기지 않게
}
/** 음악을 켜거나 끈다. 브라우저 규칙 때문에 첫 터치 뒤에 불러야 소리가 난다 */
export function setMusic(v: boolean) {
  musicWanted = v; try { localStorage.setItem(MKEY, v ? 'on' : 'off'); } catch { /* 저장 불가 */ }
  clearInterval(timer); timer = 0;
  const b = live(); if (!b) return;
  b.music.gain.cancelScheduledValues(b.ctx.currentTime); b.music.gain.linearRampToValueAtTime(v ? vol.music : 0, b.ctx.currentTime + (v ? 0.3 : 0.8)); // 끌 때는 서서히
  if (v) { tick(); timer = window.setInterval(tick, 500); }
}

/** 자동 점검용: 각 소리를 소리 없이 렌더링해 최대 크기를 잰다(0이면 무음, 1 이상이면 깨짐) */
export async function renderPeaks(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const peakOf = async (secs: number, fill: (b: Bus) => void) => {
    const ctx = new OfflineAudioContext(2, Math.floor(44100 * secs), 44100); fill(makeBus(ctx));
    const buf = await ctx.startRendering(); let p = 0;
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; } }
    return p;
  };
  for (const s of SFX) out[s] = await peakOf(3, (b) => trigger(b, s, 0.01));
  out.music = await peakOf(BAR * 2 + 2, (b) => { musicBar(b, 0, 0.05); musicBar(b, 1, 0.05 + BAR); });
  out.all = await peakOf(3, (b) => { for (const s of SFX) trigger(b, s, 0.01); musicBar(b, 0, 0.01); }); // 최악: 전부 한꺼번에
  return out;
}
