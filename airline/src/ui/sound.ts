/** 효과음: 파일 없이 WebAudio로 짧은 소리를 합성한다. 첫 터치 뒤에만 켜지고(브라우저 규칙), 메뉴에서 끌 수 있다 */
export type Sfx = 'tap' | 'ok' | 'coin' | 'alert' | 'win' | 'lose';
const KEY = 'the-air-sound';
const NOTES: Record<Sfx, [number, number][]> = { // [주파수Hz, 길이초]
  tap: [[520, 0.05]], ok: [[520, 0.06], [780, 0.09]], coin: [[880, 0.06], [1180, 0.12]],
  alert: [[330, 0.12], [247, 0.18]], win: [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.3]], lose: [[392, 0.2], [330, 0.2], [262, 0.4]],
};
let ctx: AudioContext | null = null;
let on = true;
try { on = localStorage.getItem(KEY) !== 'off'; } catch { /* 저장 불가 */ }

export const soundOn = () => on;
export function setSound(v: boolean) { on = v; try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch { /* 저장 불가 */ } }

export function play(name: Sfx) {
  if (!on) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    let t = ctx.currentTime;
    for (const [f, d] of NOTES[name]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = name === 'alert' || name === 'lose' ? 'triangle' : 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + d + 0.02); t += d * 0.9;
    }
  } catch { /* 소리를 못 내는 환경은 조용히 넘어간다 */ }
}

// ---- 배경 음악: 느린 화음 네 개를 돌려 가며 합성한다(파일 없음). 작게 깔리고, 메뉴에서 끌 수 있다 ----
const MKEY = 'the-air-music';
const CHORDS = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 207.7, 246.9]]; // Am · F · G · E
let musicWanted = true, timer = 0, bar = 0;
try { musicWanted = localStorage.getItem(MKEY) !== 'off'; } catch { /* 저장 불가 */ }
export const musicOn = () => musicWanted;
function chord() {
  if (!ctx || document.hidden) return;
  const t = ctx.currentTime, notes = CHORDS[bar++ % CHORDS.length];
  for (const f of [...notes, notes[0] / 2]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.022, t + 1.2); g.gain.linearRampToValueAtTime(0.0001, t + 4.4);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 4.5);
  }
}
/** 음악을 켜거나 끈다. 브라우저 규칙 때문에 첫 터치 뒤에 불러야 소리가 난다 */
export function setMusic(v: boolean) {
  musicWanted = v; try { localStorage.setItem(MKEY, v ? 'on' : 'off'); } catch { /* 저장 불가 */ }
  clearInterval(timer); timer = 0;
  if (!v) return;
  try { ctx ??= new AudioContext(); if (ctx.state === 'suspended') void ctx.resume(); chord(); timer = window.setInterval(chord, 4000); } catch { /* 소리를 못 내는 환경 */ }
}
