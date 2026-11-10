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
