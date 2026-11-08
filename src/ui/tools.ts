import { config } from '../config';
import type { Editor } from '../sim/editor';
import type { PlanError, Pt, RoadKind } from '../sim/network';
import type { RoadLayer } from '../render/roads';
import { downloadText, loadSlot, saveSlot } from '../io/storage';

type Tool = null | RoadKind | 'demolish';

const ERR: Record<PlanError, string> = {
  samePoint: '시작점과 같은 위치입니다',
  tooShort: `너무 짧습니다 (최소 ${config.geometry.minSegmentLength}m)`,
  nodeTooClose: `다른 교차점·끝점과 너무 가깝습니다 (최소 ${config.geometry.mergeRadius}m)`,
  angle: `다른 도로와 각도가 너무 작습니다 (최소 ${config.geometry.minAngleDeg}°)`,
  tooManyRoads: `한 교차로에 연결할 수 있는 도로는 최대 ${config.geometry.maxRoadsPerNode}개입니다`,
};

interface Deps {
  editor: Editor;
  roads: RoadLayer;
  pick: (clientX: number, clientY: number) => Pt | null;
  canvas: HTMLElement;
  toolbar: HTMLElement;
  filebar: HTMLElement;
  tip: HTMLElement;
  togglePause: () => void;
}

export function createTools(d: Deps) {
  const net = d.editor.network;
  let tool: Tool = null;
  let start: Pt | null = null;
  let last: Pt | null = null; // 마지막 커서(지면 좌표)
  let lastClient = { x: 0, y: 0 };
  let gridSnap = true;
  let angleSnap = false;

  // ---- 화면 요소 ----
  d.toolbar.innerHTML = `
    <button data-tool="road2" title="단축키 R">${config.roads.road2.name}</button>
    <button data-tool="road4" title="단축키 T">${config.roads.road4.name}</button>
    <button data-tool="demolish" title="단축키 X">철거</button>
    <div class="row"><button id="undo" title="Ctrl+Z">↶ 취소</button><button id="redo" title="Ctrl+Y">↷ 다시</button></div>
    <label><input type="checkbox" id="grid" checked /> 격자 스냅 (${config.editor.gridSnap}m)</label>
    <label><input type="checkbox" id="angle" /> 각도 스냅 (${config.editor.angleSnapDeg}°)</label>
    <div class="help">왼쪽 드래그: 이동 · 오른쪽 드래그: 회전<br />클릭: 시작·끝 지정 · 우클릭/Esc: 취소</div>`;
  d.filebar.innerHTML = `
    <select id="slot"><option value="1">슬롯 1</option><option value="2">슬롯 2</option><option value="3">슬롯 3</option></select>
    <button id="save">저장</button><button id="load">불러오기</button>
    <button id="export">파일로 저장</button><button id="import">파일 열기</button>
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

  // ---- 갱신 ----
  function refresh() {
    d.roads.clearGhost();
    d.roads.setHover(null);
    d.roads.setCursor(null, true);
    d.tip.hidden = true;
    undoBtn.disabled = !d.editor.canUndo;
    redoBtn.disabled = !d.editor.canRedo;
    toolButtons.forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
    if (!last || tool === null) return;
    if (tool === 'demolish') {
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
    refresh();
  }

  function click() {
    if (!last || tool === null) return;
    if (tool === 'demolish') {
      const h = net.nearestSegment(last.x, last.y, config.geometry.mergeRadius);
      if (h) d.editor.demolish(h.id);
      refresh();
      return;
    }
    const p = cursorPoint(last);
    if (!start) { start = p; refresh(); return; }
    if (d.editor.build(start, p, tool).ok) start = { x: p.x, y: p.y }; // 이어서 계속 건설
    refresh(); // 실패하면 시작점을 유지하고 이유가 표시된 채로 둔다
  }

  function cancel() {
    if (start) start = null;
    else tool = null;
    refresh();
  }

  // ---- 마우스·키보드 ----
  let down: { x: number; y: number; button: number } | null = null;
  d.canvas.addEventListener('pointermove', (e) => {
    lastClient = { x: e.clientX, y: e.clientY };
    last = d.pick(e.clientX, e.clientY);
    refresh();
  });
  d.canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, button: e.button }; });
  d.canvas.addEventListener('pointerup', (e) => {
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
    else if (k === ' ') { e.preventDefault(); d.togglePause(); }
  });

  // ---- 버튼 ----
  toolButtons.forEach((b) => (b.onclick = () => setTool(b.dataset.tool as Tool)));
  undoBtn.onclick = () => { d.editor.undo(); start = null; refresh(); };
  redoBtn.onclick = () => { d.editor.redo(); start = null; refresh(); };
  $<HTMLInputElement>(d.toolbar, '#grid').onchange = (e) => (gridSnap = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>(d.toolbar, '#angle').onchange = (e) => (angleSnap = (e.target as HTMLInputElement).checked);

  const slot = () => Number($<HTMLSelectElement>(d.filebar, '#slot').value);
  const guard = async (fn: () => Promise<void> | void) => {
    try { await fn(); } catch (e) { say((e as Error).message || '실패했습니다'); }
    start = null;
    refresh();
  };
  $(d.filebar, '#save').onclick = () => guard(async () => { await saveSlot(slot(), d.editor.exportText()); say(`슬롯 ${slot()}에 저장했습니다`); });
  $(d.filebar, '#load').onclick = () => guard(async () => {
    const text = await loadSlot(slot());
    if (text === undefined) throw new Error(`슬롯 ${slot()}은 비어 있습니다`);
    d.editor.loadText(text);
    say(`슬롯 ${slot()}을 불러왔습니다`);
  });
  $(d.filebar, '#export').onclick = () => { downloadText('도로망.json', d.editor.exportText()); say('파일로 저장했습니다'); };
  const file = $<HTMLInputElement>(d.filebar, '#file');
  $(d.filebar, '#import').onclick = () => file.click();
  file.onchange = () => guard(async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    d.editor.loadText(await f.text());
    say('파일을 불러왔습니다');
  });

  refresh();
  return { refresh };
}
