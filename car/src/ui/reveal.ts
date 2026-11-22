// G4 출시 공개 장면: 평론 창 전에 어두운 무대 → 실루엣 → 스포트라이트와 'launch' 효과음 → 천천히 회전 → 이름·세대·차급 → 끝.
// 기존 Stage(렌더러 그대로)의 캔버스를 결과 창(#sheet) 안으로 잠시 옮겨 그린다. 결과 창이 열려 있으므로 게임 시간은 멈춘다.
// 단계는 .rvl의 data-phase(dark → light → title → done)로 드러낸다. 1.3.0: 글자 단계에서 저절로 넘어가지 않고 누를 때까지 기다린다(사용자 지시). 넘기기: 버튼·화면 누르기·Esc. 기기 저장소 'car-company-reveal'이 '0'이면 끈다(기본 켬, 설정 화면에서 바꾼다).
import './reveal.css';
import type { Stage } from '../render/stage';

export const REVEAL_KEY = 'car-company-reveal';
/** 공개 장면을 보여 줄지(설정 켬 + 3D 무대가 있음) */
export function revealWanted(stage: Stage | null): boolean {
  if (!stage) return false;
  try { return localStorage.getItem(REVEAL_KEY) !== '0'; } catch { return true; }
}

export interface RevealOpts {
  stage: Stage; sheet: HTMLElement; body: HTMLElement;
  kind: 'new' | 'facelift'; // 페이스리프트는 짧게(앞모습 위주)
  name: string; sub: string; // 차 이름, "2세대 · 중형 세단 · 가족용" 같은 한 줄
  sound: () => void; // 'launch' 효과음(스포트라이트가 켜지는 순간에 맞춰 부른다)
  done: () => void; // 끝나거나 건너뛰면 한 번(평론 창·신문을 띄운다)
}
// 장면 시간표(초). launch 효과음은 시작 0.32초 뒤 큰 화음이라 그 순간에 불이 켜지게 한다
const T = { new: { sound: 1.1, text: 2.1, yaw: -1.4 }, facelift: { sound: .45, text: 1.0, yaw: -Math.PI / 2 + .28 } } as const;
const CHORD = .32;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** 연출 중 프레임 기록(점검용): 프레임 수, 걸린 시간, 가장 긴 프레임(ms) */
export const revealStats = { frames: 0, ms: 0, worst: 0, skipped: false };

export function playReveal(o: RevealOpts): void {
  const t = T[o.kind], { stage, sheet, body } = o, timers: number[] = [];
  body.innerHTML = `<div class="rvl ${o.kind}" role="dialog" aria-label="${esc(o.name)} 공개"><div class="rvl-cv"></div><div class="rvl-glow" aria-hidden="true"></div>
    <div class="rvl-txt"><small>${o.kind === 'new' ? '신차 공개' : '새 얼굴 공개'}</small><b>${esc(o.name)}</b><span>${esc(o.sub)}</span></div>
    <button type="button" class="rvl-skip">건너뛰기 <span aria-hidden="true">▸</span></button></div>`;
  body.classList.add('rvl-body'); sheet.classList.add('rvl-on'); sheet.hidden = false;
  const root = body.querySelector<HTMLElement>('.rvl')!, phase = (p: 'dark' | 'light' | 'title' | 'done') => { root.dataset.phase = p; }, restore = stage.borrow(body.querySelector<HTMLElement>('.rvl-cv')!);
  stage.setYaw(t.yaw); stage.setAutoRotate(true); stage.setRevealLight('dark'); phase('dark');
  Object.assign(revealStats, { frames: 0, ms: 0, worst: 0, skipped: false });
  (window as unknown as { __reveal?: typeof revealStats }).__reveal = revealStats; // 점검(스모크)용
  let raf = 0, last = performance.now(), ended = false;
  const t0 = last, meter = (now: number) => { revealStats.frames++; revealStats.worst = Math.max(revealStats.worst, now - last); revealStats.ms = now - t0; last = now; raf = requestAnimationFrame(meter); };
  raf = requestAnimationFrame(meter);
  const at = (s: number, fn: () => void) => timers.push(window.setTimeout(fn, s * 1000));
  at(t.sound, o.sound);
  at(t.sound + CHORD, () => { stage.setRevealLight('lit'); root.classList.add('lit'); phase('light'); });
  at(t.text, () => { root.classList.add('txt'); phase('title'); const b = root.querySelector<HTMLElement>('.rvl-skip')!; b.innerHTML = '평론 보기 <span aria-hidden="true">▸</span>'; b.focus(); });
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(true); } };
  const onTap = () => finish(true);
  root.addEventListener('click', onTap); document.addEventListener('keydown', onKey, true);
  root.querySelector<HTMLElement>('.rvl-skip')!.focus();
  function finish(skip: boolean) {
    if (ended) return;
    ended = true; revealStats.skipped = skip; phase('done');
    timers.forEach(clearTimeout); cancelAnimationFrame(raf);
    root.removeEventListener('click', onTap); document.removeEventListener('keydown', onKey, true);
    if (skip && revealStats.frames && !root.classList.contains('lit')) o.sound(); // 불이 켜지기 전에 건너뛰어도 효과음은 한 번
    restore(); stage.setRevealLight('off'); stage.setYaw(-.65);
    sheet.classList.remove('rvl-on'); body.classList.remove('rvl-body');
    o.done();
  }
}
