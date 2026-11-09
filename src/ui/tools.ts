import { config } from '../config';
import type { Editor } from '../sim/editor';
import type { BuildingError, PlanError, Pt, RoadKind, SignKind, ZoneType } from '../sim/network';
import type { RoadPos } from '../sim/route';
import type { RoadLayer } from '../render/roads';
import type { BuildingLayer } from '../render/buildings';
import type { ZoneLayer } from '../render/zones';
import { downloadText, loadSlot, saveSlot } from '../io/storage';

type Tool = null | RoadKind | SignKind | 'signal' | 'zoneHome' | 'zoneOffice' | 'zoneShop' | 'zoneErase' | 'demolish' | 'trip' | 'limit' | 'upgrade';
const ZONE_TOOLS: Partial<Record<NonNullable<Tool>, ZoneType | null>> = { zoneHome: 'home', zoneOffice: 'office', zoneShop: 'shop', zoneErase: null };
const ZONE_NAME = { zoneHome: '주거 구역', zoneOffice: '직장 구역', zoneShop: '상업 구역', zoneErase: '구역 지우기' } as const;
type RoadHit = RoadPos & Pt;

const ERR: Record<PlanError, string> = {
  samePoint: '시작점과 같은 위치입니다',
  tooShort: `너무 짧습니다 (최소 ${config.geometry.minSegmentLength}m)`,
  nodeTooClose: `다른 교차점·끝점과 너무 가깝습니다 (최소 ${config.geometry.mergeRadius}m)`,
  angle: `다른 도로와 각도가 너무 작습니다 (최소 ${config.geometry.minAngleDeg}°)`,
  tooManyRoads: `한 교차로에 연결할 수 있는 도로는 최대 ${config.geometry.maxRoadsPerNode}개입니다`,
  onBuilding: '건물 위로는 도로를 놓을 수 없습니다',
};

const BERR: Record<BuildingError | 'noSuchBuilding', string> = {
  onRoad: '도로와 너무 가깝습니다',
  overlap: '다른 건물과 겹칩니다',
  outOfBounds: '지도 밖입니다',
  locked: '이 건물은 지울 수 없습니다',
  noSuchBuilding: '그 건물이 없습니다',
};

interface Deps {
  editor: Editor;
  roads: RoadLayer;
  buildings: BuildingLayer;
  zones: ZoneLayer;
  /** 도로망 + 건물 + 시뮬레이션 전체 상태를 글자로 / 글자에서 복원(문제가 있으면 Error) */
  save: () => string;
  load: (text: string) => void;
  loadSample: () => void;
  loadNew: () => void;
  setHeat: (on: boolean) => void;
  setColorblind: (on: boolean) => void;
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
  let ortho = true; // 직각 맞추기: 도로에서 출발하거나 도로에 닿을 때 거의 직각이면 정확히 90°로
  let tripFrom: RoadHit | null = null;
  let dragging = false; // 도로 그리기·구역 칠하기 드래그 중
  let zoneFrom: { i: number; j: number } | null = null; // 구역 드래그를 시작한 칸
  const cellOf = (p: Pt) => ({ i: Math.round(p.x / config.zones.cell), j: Math.round(p.y / config.zones.cell) });

  // ---- 화면 요소 ----
  // 아래 도구 모음 아이콘(선 그림 SVG). 색은 글자색을 따른다
  const svg = (inner: string) => `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICON = {
    road: svg('<path d="M9 25 12 3M19 25 16 3"/><path d="M14 6v3M14 12v3M14 18v3" stroke-width="2.2"/>'),
    zone: svg('<rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="#4fb866" stroke="none"/><rect x="15.5" y="3.5" width="9" height="9" rx="1.5" fill="#4f86d6" stroke="none"/><rect x="3.5" y="15.5" width="9" height="9" rx="1.5" fill="#e8b93c" stroke="none"/><rect x="15.5" y="15.5" width="9" height="9" rx="1.5" stroke-dasharray="2.5 2.5"/>'),
    traffic: svg('<rect x="9" y="2.5" width="10" height="23" rx="4"/><circle cx="14" cy="8.5" r="2.4" fill="#e0443c" stroke="none"/><circle cx="14" cy="14" r="2.4" fill="#f5c518" stroke="none"/><circle cx="14" cy="19.5" r="2.4" fill="#2fcf5a" stroke="none"/>'),
    demolish: svg('<path d="M4 22h13M7 22V13l6-4 5 3v10"/><path d="M18 12l7-7M22 4l3 3"/>'),
    view: svg('<path d="M4 24h20"/><rect x="5.5" y="14" width="4" height="10" rx="1" fill="currentColor"/><rect x="12" y="8" width="4" height="16" rx="1" fill="currentColor"/><rect x="18.5" y="11" width="4" height="13" rx="1" fill="currentColor"/>'),
    tools: svg('<path d="M18 4a6 6 0 0 0-5.6 8L4.5 20a2.2 2.2 0 0 0 3.2 3.2L15.6 15.5A6 6 0 0 0 24 10l-3.6 3.2-3.4-.8-.8-3.4L19.6 5.6A6 6 0 0 0 18 4z"/>'),
    undo: svg('<path d="M10 6 4.5 11.5 10 17"/><path d="M5 11.5h11a6 6 0 0 1 0 12h-4"/>'),
    redo: svg('<path d="M18 6l5.5 5.5L18 17"/><path d="M23 11.5H12a6 6 0 0 0 0 12h4"/>'),
  };
  d.toolbar.innerHTML = `
    <div class="subs">
      <div class="sub" id="sub-road" data-cat="road" hidden>
        <button data-tool="road2" title="단축키 R">${config.roads.road2.name}</button>
        <button data-tool="road4" title="단축키 T">${config.roads.road4.name}</button>
        <button data-tool="upgrade" title="단축키 U: 왕복 2차로를 4차로로 넓힙니다. 교차로 사이 한 구간씩">도로 넓히기</button>
        <span class="opts">
          <label><input type="checkbox" id="grid" checked /> 격자 스냅 (${config.editor.gridSnap}m)</label>
          <label><input type="checkbox" id="ortho" checked /> 직각 맞추기</label>
          <label><input type="checkbox" id="angle" /> 각도 스냅 (${config.editor.angleSnapDeg}°)</label>
        </span>
      </div>
      <div class="sub" id="sub-zone" data-cat="zone" hidden>
        <button data-tool="zoneHome" class="z-home" title="단축키 H: 드래그해서 주거 구역을 칠합니다">주거 구역</button>
        <button data-tool="zoneShop" class="z-shop" title="단축키 C: 드래그해서 상업 구역(상점)을 칠합니다. 점심·쇼핑·여가 이동이 생깁니다">상업 구역</button>
        <button data-tool="zoneOffice" class="z-office" title="단축키 O: 드래그해서 직장 구역(산업 구역)을 칠합니다">직장(산업) 구역</button>
        <button data-tool="zoneErase" title="단축키 E: 드래그해서 구역을 지웁니다">구역 지우기</button>
      </div>
      <div class="sub" id="sub-traffic" data-cat="traffic" hidden>
        <button data-tool="stop" title="단축키 S">정지 표지</button>
        <button data-tool="yield" title="단축키 Y">양보 표지</button>
        <button data-tool="signal" title="단축키 G: 교차로를 클릭할 때마다 꺼짐 → 고정식 → 감응식 → 꺼짐">신호등</button>
        <select id="sgreen" title="고정식 신호의 기본 녹색 시간(큰 도로가 낀 방향은 2배)">${config.signals.greenChoices.map((g) => `<option value="${g}"${g === config.signals.greenSec ? ' selected' : ''}>녹색 ${g}초</option>`).join('')}</select>
        <button data-tool="limit" title="단축키 L: 도로를 클릭할 때마다 제한속도가 바뀝니다">속도 제한</button>
      </div>
      <div class="sub" id="sub-view" data-cat="view" hidden>
        <label><input type="checkbox" id="heat" /> 정체 히트맵 (M)</label>
        <label><input type="checkbox" id="cb" /> 색약 친화 색상</label>
        <label><input type="checkbox" id="debugToggle" /> 디버그 표시 (D)</label>
      </div>
      <div class="sub" id="sub-tools" data-cat="tools" hidden>
        <button data-tool="trip" title="단축키 V">차량 투입 (테스트)</button>
        <select id="count"><option>1</option><option>10</option><option>50</option><option>200</option></select>
        <button id="clearveh">차량 제거</button>
      </div>
    </div>
    <div class="cats">
      <button id="undo" class="small" title="Ctrl+Z">${ICON.undo}<small>취소</small></button>
      <button id="redo" class="small" title="Ctrl+Y">${ICON.redo}<small>다시</small></button>
      <i></i>
      <button data-catbtn="road">${ICON.road}도로</button>
      <button data-catbtn="zone">${ICON.zone}구역</button>
      <button data-catbtn="traffic">${ICON.traffic}교통</button>
      <button data-tool="demolish" title="단축키 X">${ICON.demolish}철거</button>
      <button data-catbtn="view">${ICON.view}보기</button>
      <button data-catbtn="tools">${ICON.tools}도구</button>
    </div>`;
  d.filebar.innerHTML = `
    <h4>메뉴</h4>
    <div class="mrow"><select id="slot"><option value="1">슬롯 1</option><option value="2">슬롯 2</option><option value="3">슬롯 3</option><option value="0">자동 저장</option></select>
    <button id="save">저장</button><button id="load">불러오기</button></div>
    <div class="mrow"><button id="export">파일로 저장</button><button id="import">파일 열기</button></div>
    <div class="mrow"><button id="sample" title="큰길 하나와 작은 길, 주거·직장·상점이 있는 예제 도시">샘플 맵</button><button id="newcity" title="외부에서 들어오는 도로 하나만 있는 새 도시">새 도시</button></div>
    <input type="file" id="file" accept="application/json,.json" hidden />
    <div class="help">도로 도구: 왼쪽 드래그로 그리기 (Esc·우클릭: 취소)<br />마우스: 가운데 드래그 = 이동, 오른쪽 드래그 = 회전·기울기, 휠 = 확대<br />터치: 한 손가락 = 이동, 두 손가락 벌리기 = 확대, 비틀기 = 회전, 같이 위아래 = 기울기, 좌우 = 이동<br />구역: 도로 옆 땅을 드래그해서 칠하면 수요에 따라 건물이 자랍니다(주거·상업·직장)<br />표지: 교차로 가까운 도로를 클릭 (다시 클릭하면 치움)<br />신호등: 교차로를 클릭할 때마다 고정식 → 감응식(차가 없으면 넘김) → 끔. 켜면 그 교차로의 표지는 무시<br />속도 제한: 도로를 클릭할 때마다 값이 바뀜<br />차량 투입: 출발 도로 클릭 → 도착 도로 클릭</div>`;
  const $ = <T extends HTMLElement>(root: HTMLElement, sel: string) => root.querySelector<T>(sel)!;
  const toolButtons = [...d.toolbar.querySelectorAll<HTMLButtonElement>('button[data-tool]')];
  // 분류 버튼(도로·구역·교통·보기·도구)을 누르면 그 도구 상자가 위로 열린다(시티즈 스카이라인처럼). 한 번에 하나만
  const catBtns = [...d.toolbar.querySelectorAll<HTMLButtonElement>('button[data-catbtn]')];
  const openCat = (cat: string | null) => {
    d.toolbar.querySelectorAll<HTMLElement>('.sub').forEach((el) => (el.hidden = el.dataset.cat !== cat));
    catBtns.forEach((b) => b.classList.toggle('on', b.dataset.catbtn === cat));
  };
  catBtns.forEach((b) => (b.onclick = () => openCat(b.classList.contains('on') ? null : b.dataset.catbtn!)));
  const catOf = (t: string) => d.toolbar.querySelector<HTMLElement>(`button[data-tool="${t}"]`)?.closest<HTMLElement>('[data-cat]')?.dataset.cat ?? null;
  const undoBtn = $<HTMLButtonElement>(d.toolbar, '#undo');
  const redoBtn = $<HTMLButtonElement>(d.toolbar, '#redo');
  const msg = document.getElementById('msg')!;
  let msgTimer: ReturnType<typeof setTimeout> | undefined;

  function say(text: string) {
    msg.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => (msg.textContent = ''), 4000);
  }

  // ---- 스냅 ----
  const angDiff = (a: number, b: number) => { let d = Math.abs(a - b) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d; };
  // 직각 맞추기: (1) 커서가 도로 가까이면 시작점에서 그 도로에 수직으로 내린 발에 닿게, (2) 도로에서 출발하면 그 도로에 수직 방향으로
  function orthoPoint(raw: Pt, from: Pt): Pt | null {
    const L = Math.hypot(raw.x - from.x, raw.y - from.y);
    if (L < 20 || net.snapPoint(raw).nodeId !== undefined) return null; // 교차점에 닿으려는 때는 그대로
    const ang = Math.atan2(raw.y - from.y, raw.x - from.x);
    const near = net.nearestSegment(raw.x, raw.y, 25);
    if (near) {
      const sg = net.segments.get(near.id)!, a = net.nodes.get(sg.a)!, b = net.nodes.get(sg.b)!;
      const dx = b.x - a.x, dy = b.y - a.y, u = ((from.x - a.x) * dx + (from.y - a.y) * dy) / (dx * dx + dy * dy);
      const foot = { x: a.x + u * dx, y: a.y + u * dy };
      if (u > 0.02 && u < 0.98 && Math.hypot(foot.x - from.x, foot.y - from.y) >= 20 && angDiff(Math.atan2(foot.y - from.y, foot.x - from.x), ang) < (25 * Math.PI) / 180) return foot;
    }
    const hs = net.snapPoint(from), dirs: number[] = [];
    const dirOf = (sg: { a: number; b: number }) => { const a = net.nodes.get(sg.a)!, b = net.nodes.get(sg.b)!; return Math.atan2(b.y - a.y, b.x - a.x); };
    if (hs.segId !== undefined) dirs.push(dirOf(net.segments.get(hs.segId)!));
    else if (hs.nodeId !== undefined) for (const sg of net.segmentsAt(hs.nodeId)) dirs.push(dirOf(sg));
    for (const d of dirs) for (const t of [d + Math.PI / 2, d - Math.PI / 2]) {
      const diff = angDiff(ang, t);
      if (diff < (15 * Math.PI) / 180) { const len = L * Math.cos(diff); return { x: from.x + len * Math.cos(t), y: from.y + len * Math.sin(t) }; }
    }
    return null;
  }

  function cursorPoint(raw: Pt): Pt {
    if (ortho && start) { const o = orthoPoint(raw, start); if (o) return o; }
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

  // 클릭 지점에서 20m 안의 가장 가까운 교차로(도로 3개 이상)
  function signalNode(p: Pt) {
    let best: { id: number; x: number; y: number } | null = null, bd = 20;
    for (const n of net.nodes.values()) {
      const dd = Math.hypot(n.x - p.x, n.y - p.y);
      if (dd < bd && net.segmentsAt(n.id).length >= 3) { bd = dd; best = n; }
    }
    return best;
  }

  // ---- 갱신 ----
  function refresh() {
    d.roads.clearGhost();
    d.roads.setHover(null);
    d.buildings.clearGhost();
    d.buildings.setHover(null);
    d.zones.clearGhost();
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
    if (tool === 'upgrade') {
      const h = d.pickRoad(last);
      d.roads.setCursor(h ? { x: h.x, y: h.y } : null, !!h && net.upgradeChain(h.segId).length > 0);
      if (h) {
        const n = net.upgradeChain(h.segId).length;
        d.tip.textContent = n ? `왕복 4차로로 넓히기 (교차로 사이 ${n}구간)` : '이미 왕복 4차로입니다';
        d.tip.classList.toggle('bad', !n);
        d.tip.style.left = `${lastClient.x + 16}px`;
        d.tip.style.top = `${lastClient.y + 16}px`;
        d.tip.hidden = false;
      }
      return;
    }
    if (tool === 'limit') {
      const h = d.pickRoad(last);
      d.roads.setCursor(h ? { x: h.x, y: h.y } : null, true);
      if (h) {
        const seg = net.segments.get(h.segId)!, r = config.roads[seg.kind];
        d.tip.textContent = `제한속도 ${seg.playerSpeedKmh ?? r.defaultSpeedKmh}km/h${seg.playerSpeedKmh === null ? ' (기본)' : ''} · 클릭하면 바뀜 (최대 ${r.maxSpeedKmh})`;
        d.tip.classList.remove('bad');
        d.tip.style.left = `${lastClient.x + 16}px`;
        d.tip.style.top = `${lastClient.y + 16}px`;
        d.tip.hidden = false;
      }
      return;
    }
    if (tool === 'signal') {
      const n = signalNode(last);
      d.roads.setCursor(n ? { x: n.x, y: n.y } : null, !!n);
      return;
    }
    if (tool === 'stop' || tool === 'yield') {
      const t = signTarget(last);
      const ok = !!t && net.segmentsAt(t.nodeId).length >= 3;
      d.roads.setCursor(t ? { x: t.x, y: t.y } : null, ok);
      return;
    }
    if (tool in ZONE_TOOLS) {
      const cell = cellOf(last), from = zoneFrom ?? cell;
      d.zones.setGhost(from.i, from.j, cell.i, cell.j, ZONE_TOOLS[tool]!);
      const w = Math.abs(cell.i - from.i) + 1, h = Math.abs(cell.j - from.j) + 1;
      d.tip.textContent = zoneFrom ? `${ZONE_NAME[tool as keyof typeof ZONE_NAME]} ${w}×${h}칸 (도로 옆 ${config.zones.maxDist}m 안의 칸만 칠해집니다)` : `${ZONE_NAME[tool as keyof typeof ZONE_NAME]}: 드래그해서 칠하세요`;
      d.tip.classList.remove('bad');
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
    const plan = net.planRoad(start, p, tool as RoadKind);
    d.roads.setGhost(start, p, tool as RoadKind, plan.ok);
    const len = plan.ok ? plan.length : Math.hypot(p.x - start.x, p.y - start.y);
    d.tip.textContent = `${Math.round(len)} m${plan.ok ? '' : ' — ' + ERR[plan.error]}`;
    d.tip.classList.toggle('bad', !plan.ok);
    d.tip.style.left = `${lastClient.x + 16}px`;
    d.tip.style.top = `${lastClient.y + 16}px`;
    d.tip.hidden = false;
  }

  function setTool(t: Tool) {
    tool = tool === t ? null : t;
    if (tool) openCat(catOf(tool)); // 단축키로 골라도 그 분류가 열린다
    start = null;
    tripFrom = null;
    dragging = false;
    zoneFrom = null;
    d.setDrawMode(!!tool && (tool in config.roads || tool in ZONE_TOOLS));
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
    if (tool === 'upgrade') {
      const h = d.pickRoad(last);
      if (!h) { say('도로 위를 클릭하세요'); return; }
      const r = d.editor.upgrade(h.segId);
      say(r.ok ? `왕복 4차로로 넓혔습니다 (${r.ids.length}구간)` : r.error === 'onBuilding' ? '옆에 건물이 있어 넓힐 수 없습니다' : '이미 왕복 4차로입니다');
      refresh();
      return;
    }
    if (tool === 'limit') {
      const h = d.pickRoad(last);
      if (!h) { say('도로 위를 클릭하세요'); return; }
      const seg = net.segments.get(h.segId)!, r = config.roads[seg.kind];
      const choices = config.speedChoicesKmh.filter((v) => v <= r.maxSpeedKmh);
      const cur = seg.playerSpeedKmh ?? r.defaultSpeedKmh;
      const next = choices[(choices.indexOf(cur) + 1) % choices.length]; // 한 칸씩 올라가고, 끝에서 가장 낮은 값으로
      d.editor.setSpeedLimit(seg.id, next);
      say(`제한속도 ${next}km/h${next === r.defaultSpeedKmh ? ' (기본)' : ''}`);
      refresh();
      return;
    }
    if (tool === 'signal') {
      const n = signalNode(last);
      if (!n) { say('교차로(도로 3개 이상이 만나는 곳) 가까이를 클릭하세요'); return; }
      const cur = !net.hasSignal(n.id) ? 'off' : net.isActuated(n.id) ? 'actuated' : 'fixed';
      const green = Number($<HTMLSelectElement>(d.toolbar, '#sgreen').value);
      if (cur === 'off') { d.editor.setSignal(n.id, true, 'fixed', green); say(`고정식 신호등을 켰습니다 (녹색 ${green}초, 황색 ${config.signals.yellowSec}초, 전적색 ${config.signals.allRedSec}초 · 큰 도로가 낀 방향은 녹색 2배)`); }
      else if (cur === 'fixed') { d.editor.setSignal(n.id, true, 'actuated'); say(`감응식으로 바꿨습니다 (차가 오는 방향에 녹색 ${config.signals.minGreenSec}~${config.signals.maxGreenSec}초, 차가 없으면 넘깁니다)`); }
      else { d.editor.setSignal(n.id, false); say('신호등을 껐습니다'); }
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
    if (tool === 'demolish') {
      const b = net.nearestBuilding(last);
      if (b) { const r = d.editor.removeBuilding(b.id); if (!r.ok) say(BERR[r.error]); refresh(); return; }
      const h = net.nearestSegment(last.x, last.y, config.geometry.mergeRadius);
      if (h) { if (!d.editor.demolish(h.id)) say('외부로 연결되는 도로는 철거할 수 없습니다'); }
      refresh();
      return;
    }
    // 도로 도구는 클릭이 아니라 드래그로 그린다
  }

  function cancel() {
    if (start || tripFrom || zoneFrom) { start = null; tripFrom = null; zoneFrom = null; dragging = false; }
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
  const zoning = () => tool !== null && tool in ZONE_TOOLS;
  // 그리기 시작은 카메라 컨트롤보다 먼저(캡처 단계) 받아서, 카메라가 같은 입력으로 같이 움직이지 않게 막는다.
  d.canvas.parentElement!.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, button: e.button };
    if (dragging && !e.isPrimary) { start = null; zoneFrom = null; dragging = false; refresh(); return; } // 두 번째 손가락: 그리기를 취소하고 확대·이동에 양보
    if (drawing() && e.button === 0 && e.isPrimary) {
      const p = d.pick(e.clientX, e.clientY);
      e.stopPropagation(); // 카메라 컨트롤이 이 입력을 받지 못하게 한다
      if (!p) return;
      last = p;
      start = cursorPoint(p);
      dragging = true;
      d.canvas.setPointerCapture(e.pointerId);
      refresh();
    } else if (zoning() && e.button === 0 && e.isPrimary) {
      const p = d.pick(e.clientX, e.clientY);
      e.stopPropagation();
      if (!p) return;
      last = p;
      zoneFrom = cellOf(p);
      dragging = true;
      d.canvas.setPointerCapture(e.pointerId);
      refresh();
    } else if (dragging && e.button === 2) { start = null; zoneFrom = null; dragging = false; refresh(); } // 그리는 중 우클릭 = 취소
  }, true);
  d.canvas.addEventListener('pointercancel', () => { if (dragging) { start = null; zoneFrom = null; dragging = false; refresh(); } });
  d.canvas.addEventListener('pointerup', (e) => {
    if (dragging && e.button === 0) {
      dragging = false;
      const from = start, zf = zoneFrom;
      start = null;
      zoneFrom = null;
      last = d.pick(e.clientX, e.clientY) ?? last;
      if (zf && last && zoning()) {
        const c = cellOf(last), n = net.paintZone(zf.i, zf.j, c.i, c.j, ZONE_TOOLS[tool!]!);
        say(n > 0 ? `${ZONE_NAME[tool as keyof typeof ZONE_NAME]} ${n}칸` : '칠할 수 있는 칸이 없습니다 (도로 옆 45m 안의 빈 땅만 가능)');
      }
      if (from && last && drawing()) {
        start = from; // 각도·직각 맞추기는 시작점을 알아야 한다(미리보기와 같은 결과가 되도록)
        const to = cursorPoint({ ...last });
        start = null;
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
    else if (k === 'h') setTool('zoneHome');
    else if (k === 'o') setTool('zoneOffice');
    else if (k === 'e') setTool('zoneErase');
    else if (k === 'c') setTool('zoneShop');
    else if (k === 's') setTool('stop');
    else if (k === 'y') setTool('yield');
    else if (k === 'l') setTool('limit');
    else if (k === 'u') setTool('upgrade');
    else if (k === 'g') setTool('signal');
    else if (k === 'm') { const c = $<HTMLInputElement>(d.toolbar, '#heat'); c.checked = !c.checked; d.setHeat(c.checked); }
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
  $<HTMLInputElement>(d.toolbar, '#ortho').onchange = (e) => (ortho = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>(d.toolbar, '#angle').onchange = (e) => (angleSnap = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>(d.toolbar, '#heat').onchange = (e) => d.setHeat((e.target as HTMLInputElement).checked);
  $<HTMLInputElement>(d.toolbar, '#cb').onchange = (e) => d.setColorblind((e.target as HTMLInputElement).checked);

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
  $(d.filebar, '#newcity').onclick = () => guard(() => { d.loadNew(); say('새 도시를 시작합니다. 외부에서 들어오는 도로 옆에 구역을 칠해 보세요'); });
  $(d.filebar, '#sample').onclick = () => guard(() => { d.loadSample(); say('샘플 맵을 열었습니다. 평일 아침 6시부터 출근이 시작됩니다'); });

  refresh();
  return { refresh, say };
}
