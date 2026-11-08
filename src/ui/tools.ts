import { config } from '../config';
import type { Editor } from '../sim/editor';
import type { BuildingError, BuildingKind, BuildingSize, PlanError, Pt, RoadKind, SignKind } from '../sim/network';
import type { RoadPos } from '../sim/route';
import type { RoadLayer } from '../render/roads';
import type { BuildingLayer } from '../render/buildings';
import { downloadText, loadSlot, saveSlot } from '../io/storage';

type Tool = null | RoadKind | SignKind | BuildingKind | 'demolish' | 'trip';
type RoadHit = RoadPos & Pt;

const ERR: Record<PlanError, string> = {
  samePoint: '시작점과 같은 위치입니다',
  tooShort: `너무 짧습니다 (최소 ${config.geometry.minSegmentLength}m)`,
  nodeTooClose: `다른 교차점·끝점과 너무 가깝습니다 (최소 ${config.geometry.mergeRadius}m)`,
  angle: `다른 도로와 각도가 너무 작습니다 (최소 ${config.geometry.minAngleDeg}°)`,
  tooManyRoads: `한 교차로에 연결할 수 있는 도로는 최대 ${config.geometry.maxRoadsPerNode}개입니다`,
};

const BERR: Record<BuildingError | 'noSuchBuilding', string> = {
  onRoad: '도로와 너무 가깝습니다',
  overlap: '다른 건물과 겹칩니다',
  outOfBounds: '지도 밖입니다',
  locked: '맵이 제공한 건물은 지울 수 없습니다',
  noSuchBuilding: '그 건물이 없습니다',
};
const SIZE_NAME: Record<BuildingSize, string> = { small: '소', medium: '중', large: '대' };

interface Deps {
  editor: Editor;
  roads: RoadLayer;
  buildings: BuildingLayer;
  /** 도로망 + 건물 + 시뮬레이션 전체 상태를 글자로 / 글자에서 복원(문제가 있으면 Error) */
  save: () => string;
  load: (text: string) => void;
  loadSample: () => void;
  pick: (clientX: number, clientY: number) => Pt | null;
  canvas: HTMLElement;
  setDrawMode: (on: boolean) => void;
  toolbar: HTMLElement;
  filebar: HTMLElement;
  tip: HTMLElement;
  togglePause: () => void;
  /** 점 근처의 도로 위 지점(없으면 null) */
  pickRoad: (p: Pt) => RoadHit | null;
  /** 차량 투입 요청. 실패하면 이유(한국어), 성공하면 null */
  requestTrip: (from: RoadPos, to: RoadPos, count: number) => string | null;
  clearVehicles: () => void;
  setDebug: (on: boolean) => void;
}

export function createTools(d: Deps) {
  const net = d.editor.network;
  let tool: Tool = null;
  let start: Pt | null = null;
  let last: Pt | null = null; // 마지막 커서(지면 좌표)
  let lastClient = { x: 0, y: 0 };
  let gridSnap = true;
  let angleSnap = false;
  let tripFrom: RoadHit | null = null;
  let dragging = false; // 도로 그리기 드래그 중

  // ---- 화면 요소 ----
  d.toolbar.innerHTML = `
    <button data-tool="road2" title="단축키 R">${config.roads.road2.name}</button>
    <button data-tool="road4" title="단축키 T">${config.roads.road4.name}</button>
    <button data-tool="stop" title="단축키 S">정지 표지</button>
    <button data-tool="yield" title="단축키 Y">양보 표지</button>
    <div class="row"><button data-tool="home" title="단축키 H">주거 건물</button><button data-tool="office" title="단축키 O">직장 건물</button></div>
    <div class="row"><select id="bsize"><option value="small">소 (10)</option><option value="medium" selected>중 (30)</option><option value="large">대 (100)</option></select></div>
    <button data-tool="demolish" title="단축키 X">철거</button>
    <button data-tool="trip" title="단축키 V">차량 투입 (테스트)</button>
    <div class="row"><select id="count"><option>1</option><option>10</option><option>50</option><option>200</option></select><button id="clearveh">차량 제거</button></div>
    <div class="row"><button id="undo" title="Ctrl+Z">↶ 취소</button><button id="redo" title="Ctrl+Y">↷ 다시</button></div>
    <label><input type="checkbox" id="grid" checked /> 격자 스냅 (${config.editor.gridSnap}m)</label>
    <label><input type="checkbox" id="angle" /> 각도 스냅 (${config.editor.angleSnapDeg}°)</label>
    <label><input type="checkbox" id="debugToggle" /> 디버그 표시 (D)</label>
    <div class="help">도로 도구: 왼쪽 드래그로 그리기 (Esc·우클릭: 취소)<br />가운데 드래그: 이동 · 오른쪽 드래그: 회전<br />건물: 빈 땅 클릭 (도로 50m 안에 놓으면 연결)<br />표지: 교차로 가까운 도로를 클릭 (다시 클릭하면 치움)<br />차량 투입: 출발 도로 클릭 → 도착 도로 클릭</div>`;
  d.filebar.innerHTML = `
    <select id="slot"><option value="1">슬롯 1</option><option value="2">슬롯 2</option><option value="3">슬롯 3</option><option value="0">자동 저장</option></select>
    <button id="save">저장</button><button id="load">불러오기</button>
    <button id="export">파일로 저장</button><button id="import">파일 열기</button><button id="sample" title="큰길 하나와 작은 길, 주거·직장 건물이 있는 예제 도시">샘플 맵</button>
    <input type="file" id="file" accept="application/json,.json" hidden />
    <div id="msg"></div>`;
  const $ = <T extends HTMLElement>(root: HTMLElement, sel: string) => root.querySelector<T>(sel)!;
  const toolButtons = [...d.toolbar.querySelectorAll<HTMLButtonElement>('button[data-tool]')];
  const undoBtn = $<HTMLButtonElement>(d.toolbar, '#undo');
  const redoBtn = $<HTMLButtonElement>(d.toolbar, '#redo');
  const msg = $(d.filebar, '#msg');
  let msgTimer: ReturnType<typeof setTimeout> | undefined;

  function say(text: string) {
    msg.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => (msg.textContent = ''), 4000);
  }

  // ---- 스냅 ----
  function cursorPoint(raw: Pt): Pt {
    const s = net.snapPoint(raw); // 기존 노드·도로가 가까우면 그쪽으로
    if (s.nodeId !== undefined || s.segId !== undefined) return { x: s.x, y: s.y };
    if (angleSnap && start) {
      const step = (config.editor.angleSnapDeg * Math.PI) / 180;
      const ang = Math.round(Math.atan2(raw.y - start.y, raw.x - start.x) / step) * step;
      const len = Math.max(config.editor.lengthSnap, Math.round(Math.hypot(raw.x - start.x, raw.y - start.y) / config.editor.lengthSnap) * config.editor.lengthSnap);
      return { x: start.x + len * Math.cos(ang), y: start.y + len * Math.sin(ang) };
    }
    if (gridSnap) {
      const g = config.editor.gridSnap;
      return { x: Math.round(raw.x / g) * g, y: Math.round(raw.y / g) * g };
    }
    return raw;
  }

  // 클릭한 도로에서 가장 가까운 끝(교차로 쪽)과, 그쪽으로 들어오는 방향의 표지 위치
  function signTarget(p: Pt): { segId: number; nodeId: number; x: number; y: number } | null {
    const h = net.projectOnRoad(p, 20);
    if (!h) return null;
    const seg = net.segments.get(h.segId)!;
    const len = net.segmentLength(seg);
    const nodeId = h.t < len / 2 ? seg.a : seg.b;
    const node = net.nodes.get(nodeId)!, other = net.nodes.get(nodeId === seg.a ? seg.b : seg.a)!;
    return { segId: seg.id, nodeId, x: node.x + ((other.x - node.x) / len) * 8, y: node.y + ((other.y - node.y) / len) * 8 };
  }

  // ---- 갱신 ----
  function refresh() {
    d.roads.clearGhost();
    d.roads.setHover(null);
    d.buildings.clearGhost();
    d.buildings.setHover(null);
    d.roads.setCursor(null, true);
    d.tip.hidden = true;
    undoBtn.disabled = !d.editor.canUndo;
    redoBtn.disabled = !d.editor.canRedo;
    toolButtons.forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
    d.roads.setMark(tool === 'trip' ? tripFrom : null);
    if (!last || tool === null) return;
    if (tool === 'trip') {
      const h = d.pickRoad(last);
      d.roads.setCursor(h ? { x: h.x, y: h.y } : null, true);
      return;
    }
    if (tool === 'stop' || tool === 'yield') {
      const t = signTarget(last);
      const ok = !!t && net.segmentsAt(t.nodeId).length >= 3;
      d.roads.setCursor(t ? { x: t.x, y: t.y } : null, ok);
      return;
    }
    if (tool === 'home' || tool === 'office') {
      const size = $<HTMLSelectElement>(d.toolbar, '#bsize').value as BuildingSize;
      const g = config.editor.gridSnap;
      const p = gridSnap ? { x: Math.round(last.x / g) * g, y: Math.round(last.y / g) * g } : last;
      const plan = net.planBuilding(tool, size, p.x, p.y);
      d.buildings.setGhost(tool, size, p.x, p.y, plan.ok);
      const cap = config.buildings.capacity[size];
      const info = tool === 'home' ? `주거 ${SIZE_NAME[size]} · 직장인 ${Math.round(cap * config.demand.workerShare)}명` : `직장 ${SIZE_NAME[size]} · 일자리 ${cap}개`;
      const linked = net.projectOnRoad(p, config.buildings.connectRadius) !== null;
      d.tip.textContent = plan.ok ? `${info}${linked ? '' : ' — 도로에 연결 안 됨(50m 안에 도로 없음)'}` : `${info} — ${BERR[plan.error]}`;
      d.tip.classList.toggle('bad', !plan.ok || !linked);
      d.tip.style.left = `${lastClient.x + 16}px`;
      d.tip.style.top = `${lastClient.y + 16}px`;
      d.tip.hidden = false;
      return;
    }
    if (tool === 'demolish') {
      const b = net.nearestBuilding(last);
      if (b) { d.buildings.setHover(b.id); return; }
      d.roads.setHover(net.nearestSegment(last.x, last.y, config.geometry.mergeRadius)?.id ?? null);
      return;
    }
    const p = cursorPoint(last);
    if (!start) { d.roads.setCursor(p, true); return; }
    const plan = net.planRoad(start, p, tool);
    d.roads.setGhost(start, p, tool, plan.ok);
    const len = plan.ok ? plan.length : Math.hypot(p.x - start.x, p.y - start.y);
    d.tip.textContent = `${Math.round(len)} m${plan.ok ? '' : ' — ' + ERR[plan.error]}`;
    d.tip.classList.toggle('bad', !plan.ok);
    d.tip.style.left = `${lastClient.x + 16}px`;
    d.tip.style.top = `${lastClient.y + 16}px`;
    d.tip.hidden = false;
  }

  function setTool(t: Tool) {
    tool = tool === t ? null : t;
    start = null;
    tripFrom = null;
    dragging = false;
    d.setDrawMode(!!tool && tool in config.roads);
    refresh();
  }

  function click() {
    if (!last || tool === null) return;
    if (tool === 'trip') {
      const h = d.pickRoad(last);
      if (!h) { say('도로 위를 클릭하세요'); return; }
      if (!tripFrom) { tripFrom = h; refresh(); return; }
      const count = Number($<HTMLSelectElement>(d.toolbar, '#count').value);
      const err = d.requestTrip(tripFrom, h, count);
      say(err ?? `차량 ${count}대를 투입합니다`);
      tripFrom = null;
      refresh();
      return;
    }
    if (tool === 'stop' || tool === 'yield') {
      const t = signTarget(last);
      if (!t) { say('도로 위를 클릭하세요'); return; }
      const cur = net.signAt(t.segId, t.nodeId);
      const r = d.editor.setSign(t.segId, t.nodeId, cur === tool ? null : tool);
      say(!r.ok ? '표지는 도로 3개 이상이 만나는 교차로 쪽에서만 놓을 수 있습니다' : cur === tool ? '표지를 치웠습니다' : `${tool === 'stop' ? '정지' : '양보'} 표지를 놓았습니다`);
      refresh();
      return;
    }
    if (tool === 'home' || tool === 'office') {
      const size = $<HTMLSelectElement>(d.toolbar, '#bsize').value as BuildingSize;
      const g = config.editor.gridSnap;
      const p = gridSnap ? { x: Math.round(last.x / g) * g, y: Math.round(last.y / g) * g } : last;
      const r = d.editor.addBuilding(tool, size, p.x, p.y);
      if (!r.ok) say(BERR[r.error]);
      else if (net.accessOf(r.id) === null) say('놓았습니다. 하지만 도로에서 50m 넘게 떨어져 연결되지 않았습니다 (빨간 표시)');
      refresh();
      return;
    }
    if (tool === 'demolish') {
      const b = net.nearestBuilding(last);
      if (b) { const r = d.editor.removeBuilding(b.id); if (!r.ok) say(BERR[r.error]); refresh(); return; }
      const h = net.nearestSegment(last.x, last.y, config.geometry.mergeRadius);
      if (h) d.editor.demolish(h.id);
      refresh();
      return;
    }
    // 도로 도구는 클릭이 아니라 드래그로 그린다
  }

  function cancel() {
    if (start || tripFrom) { start = null; tripFrom = null; dragging = false; }
    else { tool = null; d.setDrawMode(false); }
    refresh();
  }

  // ---- 마우스·키보드 ----
  let down: { x: number; y: number; button: number } | null = null;
  d.canvas.addEventListener('pointermove', (e) => {
    lastClient = { x: e.clientX, y: e.clientY };
    last = d.pick(e.clientX, e.clientY);
    refresh();
  });
  const drawing = () => tool !== null && tool in config.roads;
  // 그리기 시작은 카메라 컨트롤보다 먼저(캡처 단계) 받아서, 카메라가 같은 입력으로 같이 움직이지 않게 막는다.
  d.canvas.parentElement!.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, button: e.button };
    if (dragging && !e.isPrimary) { start = null; dragging = false; refresh(); return; } // 두 번째 손가락: 그리기를 취소하고 확대·이동에 양보
    if (drawing() && e.button === 0 && e.isPrimary) {
      const p = d.pick(e.clientX, e.clientY);
      e.stopPropagation(); // 카메라 컨트롤이 이 입력을 받지 못하게 한다
      if (!p) return;
      last = p;
      start = cursorPoint(p);
      dragging = true;
      d.canvas.setPointerCapture(e.pointerId);
      refresh();
    } else if (dragging && e.button === 2) { start = null; dragging = false; refresh(); } // 그리는 중 우클릭 = 취소
  }, true);
  d.canvas.addEventListener('pointercancel', () => { if (dragging) { start = null; dragging = false; refresh(); } });
  d.canvas.addEventListener('pointerup', (e) => {
    if (dragging && e.button === 0) {
      dragging = false;
      const from = start;
      start = null;
      last = d.pick(e.clientX, e.clientY) ?? last;
      if (from && last && drawing()) {
        const to = cursorPoint({ ...last });
        if (Math.hypot(to.x - from.x, to.y - from.y) > 1e-6) d.editor.build(from, to, tool as RoadKind);
      }
      down = null;
      refresh();
      return;
    }
    // 거의 움직이지 않았을 때만 "클릭". 끌었으면 카메라 이동·회전이므로 무시
    const isClick = down && down.button === e.button && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5;
    down = null;
    if (!isClick) return;
    last = d.pick(e.clientX, e.clientY);
    if (e.button === 0) click();
    else if (e.button === 2) cancel();
  });
  d.canvas.addEventListener('pointerleave', () => { last = null; refresh(); });

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) d.editor.redo(); else d.editor.undo(); start = null; refresh(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); d.editor.redo(); start = null; refresh(); }
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (k === 'escape') cancel();
    else if (k === 'r') setTool('road2');
    else if (k === 't') setTool('road4');
    else if (k === 'x') setTool('demolish');
    else if (k === 'h') setTool('home');
    else if (k === 'o') setTool('office');
    else if (k === 's') setTool('stop');
    else if (k === 'y') setTool('yield');
    else if (k === 'v') setTool('trip');
    else if (k === 'd') { const c = $<HTMLInputElement>(d.toolbar, '#debugToggle'); c.checked = !c.checked; d.setDebug(c.checked); }
    else if (k === ' ') { e.preventDefault(); d.togglePause(); }
  });

  // ---- 버튼 ----
  toolButtons.forEach((b) => (b.onclick = () => setTool(b.dataset.tool as Tool)));
  undoBtn.onclick = () => { d.editor.undo(); start = null; refresh(); };
  redoBtn.onclick = () => { d.editor.redo(); start = null; refresh(); };
  $<HTMLInputElement>(d.toolbar, '#grid').onchange = (e) => (gridSnap = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>(d.toolbar, '#debugToggle').onchange = (e) => d.setDebug((e.target as HTMLInputElement).checked);
  $(d.toolbar, '#clearveh').onclick = () => { d.clearVehicles(); say('차량을 모두 제거했습니다'); };
  $<HTMLInputElement>(d.toolbar, '#angle').onchange = (e) => (angleSnap = (e.target as HTMLInputElement).checked);
  $<HTMLSelectElement>(d.toolbar, '#bsize').onchange = () => refresh();

  const slot = () => Number($<HTMLSelectElement>(d.filebar, '#slot').value);
  const guard = async (fn: () => Promise<void> | void) => {
    try { await fn(); } catch (e) { say((e as Error).message || '실패했습니다'); }
    start = null;
    refresh();
  };
  const slotName = () => (slot() === 0 ? '자동 저장' : `슬롯 ${slot()}`);
  $(d.filebar, '#save').onclick = () => guard(async () => { await saveSlot(slot(), d.save()); say(`${slotName()}에 저장했습니다`); });
  $(d.filebar, '#load').onclick = () => guard(async () => {
    const text = await loadSlot(slot());
    if (text === undefined) throw new Error(`${slotName()}은 비어 있습니다`);
    d.load(text);
    say(`${slotName()}을 불러왔습니다`);
  });
  $(d.filebar, '#export').onclick = () => { downloadText('도시.json', d.save()); say('파일로 저장했습니다'); };
  const file = $<HTMLInputElement>(d.filebar, '#file');
  $(d.filebar, '#import').onclick = () => file.click();
  file.onchange = () => guard(async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    d.load(await f.text());
    say('파일을 불러왔습니다');
  });
  $(d.filebar, '#sample').onclick = () => guard(() => { d.loadSample(); say('샘플 맵을 열었습니다. 평일 아침 6시부터 출근이 시작됩니다'); });

  refresh();
  return { refresh, say };
}
