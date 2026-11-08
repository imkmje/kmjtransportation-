import { config } from './config';
import { Sim } from './sim/sim';
import { TickLoop } from './sim/loop';
import { createScene } from './render/scene';
import { createHud } from './ui/hud';
import { Editor } from './sim/editor';
import { createRoadLayer } from './render/roads';
import { createTools } from './ui/tools';

const sim = new Sim(config);
const loop = new TickLoop(config.tickRate, config.maxTicksPerFrame, () => sim.step());
let speed = 1;
let resumeSpeed = 1;
let autoPaused = false;
function setSpeed(s: number) {
  if (s > 0) resumeSpeed = s;
  speed = s;
  autoPaused = false;
}

const view = createScene(document.getElementById('view')!);
const editor = new Editor(config);
const roads = createRoadLayer(view.scene, editor.network);
const hud = createHud(document.getElementById('hud')!, config.speedSteps, setSpeed);
createTools({
  editor,
  roads,
  pick: view.pickGround,
  canvas: view.domElement,
  toolbar: document.getElementById('toolbar')!,
  filebar: document.getElementById('filebar')!,
  tip: document.getElementById('tip')!,
  togglePause: () => setSpeed(speed > 0 ? 0 : resumeSpeed),
});

// 탭이 가려지면 자동 일시정지 (돌아와도 정지 상태 유지)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && speed > 0) {
    speed = 0;
    autoPaused = true;
  }
});

let last = performance.now();
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 1);
  last = now;
  loop.advance(dt, speed);
  roads.sync();
  view.render();
  hud.update(sim.clock(), speed, loop.actualSpeed, autoPaused);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 스모크 테스트와 디버깅용
(window as unknown as { __game: unknown }).__game = { sim, editor, getSpeed: () => speed, project: view.project };
