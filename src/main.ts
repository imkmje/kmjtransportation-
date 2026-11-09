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
import { createBuildingLayer } from './render/buildings';
import { createStats } from './ui/stats';
import { createHeatmap } from './render/heatmap';
import { exportGame, importGame } from './io/game';
import { loadSlot, saveSlot } from './io/storage';
import { buildSampleMap } from './maps/sample';
import { buildStartMap } from './maps/start';
import { createZoneLayer } from './render/zones';
import { createSignalLayer } from './render/signals';
import { createTitle } from './ui/title';
import { createInfo } from './ui/info';

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
const buildings = createBuildingLayer(view.scene, editor.network);
const zones = createZoneLayer(view.scene, editor.network);
const signalLayer = createSignalLayer(view.scene, editor.network, sim.traffic.signals, () => sim.tickCount);
const heat = createHeatmap(view.scene, editor.network, sim.metrics, document.getElementById('legend')!);
const vehicles = createVehicleLayer(view.scene, sim.traffic);
const laneDebug = createLaneDebug(view.scene, sim.traffic);
const debug = createDebug({ panel: document.getElementById('debug')!, labels: document.getElementById('labels')!, sim, project: view.project });
debug.set(false);
const hud = createHud(document.getElementById('hud')!, config.speedSteps, setSpeed);
// 미연결 건물 수는 계산이 조금 들어서 도로망이 바뀔 때만 다시 센다
let uncKey = -1, uncCount = 0;
const stats = createStats(document.getElementById('stats')!, sim, editor.network, () => {
  if (uncKey !== editor.network.revision) { uncKey = editor.network.revision; uncCount = sim.demand.unconnected().length; }
  return uncCount;
}, document.getElementById('rci')!, document.getElementById('topci')!, (id) => pickSegment(id, true));
// 도로 정보 창: 도로를 클릭하거나 병목 목록을 누르면 열린다
const info = createInfo(document.getElementById('info')!, config, editor, sim.metrics, sim.traffic.signals, (t) => tools.say(t), () => roads.setSelect(null), (segId) => { const r = editor.upgrade(segId); tools.say(r.ok ? `왕복 4차로로 넓혔습니다 (${r.ids.length}구간)` : '옆에 건물이 있어 넓힐 수 없습니다'); });
function pickSegment(id: number | null, focus = false) {
  roads.setSelect(id);
  info.showSegment(id);
  const s = id === null ? undefined : editor.network.segments.get(id);
  if (focus && s) { const a = editor.network.nodes.get(s.a)!, b = editor.network.nodes.get(s.b)!; view.focus({ x: (a.x + b.x) / 2, y: (b.y + a.y) / 2 }); }
}
const tools = createTools({
  editor,
  roads,
  buildings,
  zones,
  selectRoad: (id) => pickSegment(id),
  selectNode: (id) => { roads.setSelect(null); info.showNode(id); },
  save: () => exportGame(editor, sim),
  load: (text) => { importGame(text, editor, sim); },
  loadSample: () => { buildSampleMap(editor); sim.reset(); view.focus({ x: 0, y: 0 }); },
  loadNew: () => { buildStartMap(editor); sim.reset(); view.focus({ x: 0, y: config.external.roadEndY - 100 }); },
  setHeat: (on) => heat.setVisible(on),
  setColorblind: (on) => heat.setColorblind(on),
  pick: view.pickGround,
  canvas: view.domElement,
  setDrawMode: view.setDrawMode,
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

// 새 게임은 외부에서 들어오는 도로 하나로 시작한다(시티즈 스카이라인처럼)
buildStartMap(editor);
view.focus({ x: 0, y: config.external.roadEndY - 100 });

// 시작 화면: 열려 있는 동안 시간이 멈춘다. 닫으면 이어서 흐른다. 오른쪽 위 "업데이트 내역" 버튼으로 다시 열 수 있다
const title = createTitle(
  document.getElementById('title')!, __APP_VERSION__,
  async () => (await loadSlot(0)) !== undefined,
  () => { if (speed > 0) resumeSpeed = speed; speed = 0; },
  (loadAuto) => {
    if (loadAuto) void loadSlot(0).then((t) => { if (t) { importGame(t, editor, sim); tools.say('자동 저장을 불러왔습니다'); } }).catch(() => tools.say('자동 저장을 불러오지 못했습니다'));
    setSpeed(resumeSpeed);
  },
);
const aboutBtn = document.createElement('button');
aboutBtn.id = 'about'; aboutBtn.textContent = '업데이트 내역';
aboutBtn.onclick = () => void title.show();
const menu = document.getElementById('filebar')!;
menu.querySelector('.help')!.before(aboutBtn);
// 메뉴: 오른쪽 위 버튼으로 열고 닫는다. 안의 버튼(저장·불러오기 등)을 누르면 자동으로 닫힌다
menu.hidden = true;
document.getElementById('menubtn')!.onclick = () => { menu.hidden = !menu.hidden; };
menu.addEventListener('click', (e) => { if ((e.target as HTMLElement).tagName === 'BUTTON') menu.hidden = true; });
void title.show();

// 탭이 가려지면 자동 일시정지 (돌아와도 정지 상태 유지)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && speed > 0) {
    speed = 0;
    autoPaused = true;
  }
});

let last = performance.now();
let fps = 0, frames = 0, fpsStart = last, statFrame = 0;
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 1);
  last = now;
  loop.advance(dt, speed);
  sim.traffic.sync(); // 정지 중에도 도로가 바뀌면 그래프를 새로 만든다
  roads.sync();
  buildings.sync();
  zones.sync();
  signalLayer.update();
  vehicles.update(loop.alpha);
  laneDebug.update(debug.on);
  view.render();
  hud.update(sim.clock(), speed, loop.actualSpeed, autoPaused);
  frames++;
  if (now - fpsStart >= 500) { fps = (frames * 1000) / (now - fpsStart); frames = 0; fpsStart = now; }
  debug.update(fps);
  if (++statFrame % 10 === 0) { stats.update(); heat.update(); info.update(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 자동 저장: 1분마다, 그리고 탭을 떠날 때 '자동 저장' 슬롯(0)에 전체 상태를 저장한다(실패해도 게임은 계속)
const autosave = () => { try { void saveSlot(0, exportGame(editor, sim)).catch(() => {}); } catch { /* 저장소를 못 쓰는 환경 */ } };
setInterval(autosave, 60_000);
document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(); });
// 이전에 자동 저장한 게임이 있으면 알려 준다(자동으로 불러오지는 않는다)
loadSlot(0).then((t) => { if (t) tools.say('자동 저장된 게임이 있습니다. 위에서 "자동 저장"을 고르고 불러오기를 누르세요'); }).catch(() => {});

// 스모크 테스트와 디버깅용
(window as unknown as { __game: unknown }).__game = { sim, editor, heat, scene: view.scene, focus: view.focus, getTilt: view.getTilt, getSpeed: () => speed, project: view.project };
