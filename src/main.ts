import { config } from './config';
import { Sim } from './sim/sim';
import { TickLoop } from './sim/loop';
import { createScene } from './render/scene';
import { createHud } from './ui/hud';
import { Editor } from './sim/editor';
import { createRoadLayer } from './render/roads';
import { createVehicleLayer } from './render/vehicles';
import { createLaneDebug } from './render/lanesDebug';
import { createTools } from './ui/tools';
import { createDebug } from './ui/debug';

const editor = new Editor(config);
const sim = new Sim(config, editor.network);
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
const roads = createRoadLayer(view.scene, editor.network);
const vehicles = createVehicleLayer(view.scene, sim.traffic);
const laneDebug = createLaneDebug(view.scene, sim.traffic);
const debug = createDebug({ panel: document.getElementById('debug')!, labels: document.getElementById('labels')!, sim, project: view.project });
debug.set(false);
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
  pickRoad: (p) => editor.network.projectOnRoad(p, 15),
  requestTrip: (from, to, count) => {
    const r = sim.traffic.requestTrip(from, to, count);
    return r.ok ? null : '경로가 없습니다 (도로가 이어져 있는지 확인하세요)';
  },
  clearVehicles: () => sim.traffic.clear(),
  setDebug: (on) => debug.set(on),
});

// 탭이 가려지면 자동 일시정지 (돌아와도 정지 상태 유지)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && speed > 0) {
    speed = 0;
    autoPaused = true;
  }
});

let last = performance.now();
let fps = 0, frames = 0, fpsStart = last;
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 1);
  last = now;
  loop.advance(dt, speed);
  sim.traffic.sync(); // 정지 중에도 도로가 바뀌면 그래프를 새로 만든다
  roads.sync();
  vehicles.update(loop.alpha);
  laneDebug.update(debug.on);
  view.render();
  hud.update(sim.clock(), speed, loop.actualSpeed, autoPaused);
  frames++;
  if (now - fpsStart >= 500) { fps = (frames * 1000) / (now - fpsStart); frames = 0; fpsStart = now; }
  debug.update(fps);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 스모크 테스트와 디버깅용
(window as unknown as { __game: unknown }).__game = { sim, editor, scene: view.scene, getSpeed: () => speed, project: view.project };
