import { ClockTime } from '../sim/time';

const pad = (n: number) => String(n).padStart(2, '0');

export function createHud(
  root: HTMLElement,
  steps: readonly number[],
  onSpeed: (s: number) => void,
) {
  root.innerHTML = `
    <div id="tb-left"><div id="rci"></div><div id="topci"></div></div>
    <div id="tb-center"><div id="clock"></div><div id="note"></div></div>
    <div id="tb-right"><div id="version">v${__APP_VERSION__}${__APP_VERSION__.startsWith('0.') ? ' (개발 중)' : ''}</div><div id="speeds"></div><button id="menubtn" title="저장·불러오기·새 도시·도움말">☰ 메뉴</button></div>`;
  const clockEl = root.querySelector<HTMLElement>('#clock')!;
  const noteEl = root.querySelector<HTMLElement>('#note')!;
  const speedsEl = root.querySelector<HTMLElement>('#speeds')!;
  const buttons = steps.map((s) => {
    const b = document.createElement('button');
    b.textContent = s === 0 ? '⏸' : `${s}×`;
    b.title = s === 0 ? '일시정지 (Space)' : `${s}배속`;
    b.dataset.speed = String(s);
    b.onclick = () => onSpeed(s);
    speedsEl.appendChild(b);
    return b;
  });
  return {
    update(c: ClockTime, speed: number, actualSpeed: number, autoPaused: boolean) {
      clockEl.textContent = `${c.day}일차 ${c.weekday}요일 ${pad(c.hour)}:${pad(c.minute)}`;
      buttons.forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === speed));
      if (autoPaused) noteEl.textContent = '탭이 가려져 자동 일시정지됨';
      else if (speed > 0 && actualSpeed < speed * 0.9) noteEl.textContent = `실제 배속 ${actualSpeed.toFixed(1)}×`;
      else noteEl.textContent = '';
    },
  };
}
