import { config } from '../config';
import type { Editor } from '../sim/editor';
import type { BuildingError, BuildingSize, PlanError, Pt, RoadKind, SignKind, ZoneType } from '../sim/network';
import type { RoadPos } from '../sim/route';
import { curvePoints, CURVE_PIECE } from '../sim/curve';
import { TERRAIN_PRESETS, type TerrainKind } from '../sim/terrain';
import type { RoadLayer } from '../render/roads';
import type { BuildingLayer } from '../render/buildings';
import type { ZoneLayer } from '../render/zones';
import { downloadText, loadSlot, saveSlot } from '../io/storage';

type Tool = null | RoadKind | SignKind | 'noleft' | 'noentry' | 'oneway' | 'signal' | 'roundabout' | 'downgrade' | 'school' | 'oneway1' | 'oneway2' | 'oneway3' | 'zoneHome' | 'zoneHomeMid' | 'zoneHomeHigh' | 'zoneShop' | 'zoneOffice' | 'zoneIndustrial' | 'zoneMixed' | 'zoneErase' | 'demolish' | 'trip' | 'limit' | 'upgrade';
const ZONE_TOOLS: Partial<Record<NonNullable<Tool>, ZoneType | null>> = { zoneHome: 'home', zoneHomeMid: 'homeMid', zoneHomeHigh: 'homeHigh', zoneShop: 'shop', zoneOffice: 'office', zoneIndustrial: 'industrial', zoneMixed: 'mixed', zoneErase: null };
const ZONE_NAME = { zoneHome: '주거(저밀) 구역', zoneHomeMid: '주거(중밀) 구역', zoneHomeHigh: '주거(고밀) 구역', zoneShop: '상업 구역', zoneOffice: '사무 구역', zoneIndustrial: '산업 구역', zoneMixed: '혼합 용도 구역', zoneErase: '구역 지우기' } as const;
type RoadHit = RoadPos & Pt;

const ERR: Record<PlanError, string> = {
  samePoint: '시작점과 같은 위치입니다',
  tooShort: `너무 짧습니다 (최소 ${config.geometry.minSegmentLength}m)`,
  nodeTooClose: `다른 교차점·끝점과 너무 가깝습니다 (최소 ${config.geometry.mergeRadius}m)`,
  angle: `다른 도로와 각도가 너무 작습니다 (최소 ${config.geometry.minAngleDeg}°)`,
  tooManyRoads: `한 교차로에 연결할 수 있는 도로는 최대 ${config.geometry.maxRoadsPerNode}개입니다`,
  onBuilding: '건물 위로는 도로를 놓을 수 없습니다',
  inWater: '물 위나 다리·터널·고가 위에는 끝점이나 교차로를 둘 수 없습니다',
  overpass: `입체교차 조건: 다른 도로와 교차해야 하고, 길이 ${2 * config.terrain.overRamp}m 이상, 양 끝은 빈 땅이나 기존 끝점이어야 하며, 교차 지점이 양 끝에서 충분히 떨어져(약 ${Math.round(config.terrain.overRamp * 0.75)}m 이상) 아래 도로와 높이 차 ${config.terrain.overClear}m를 확보해야 합니다`,
  tooSteep: `경사가 너무 급합니다 (최대 ${Math.round(config.terrain.maxGrade * 100)}%)`,
  bridgeTooLong: `다리가 너무 깁니다 (물 위 최대 ${config.terrain.maxBridge}m)`,
};

const BERR: Record<BuildingError | 'noSuchBuilding', string> = {
  onWater: '물 위에는 건물을 지을 수 없습니다',
  tooSteep: '경사가 너무 급해 건물을 지을 수 없습니다',
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
  /** 도구가 없을 때 도로를 클릭하면 그 도로의 정보 창을 연다(도로 밖을 누르면 닫는다) */
  selectRoad: (segId: number | null) => void;
  /** 점 가까이(7m 안)의 차량 ID(없으면 null) */
  pickVehicle: (p: Pt) => number | null;
  /** 차량 정보 창을 연다 */
  selectVehicle: (id: number) => void;
  /** 도구가 없을 때 교차로를 클릭하면 신호 편집 창을 연다 */
  selectNode: (nodeId: number) => void;
  /** 도로망 + 건물 + 시뮬레이션 전체 상태를 글자로 / 글자에서 복원(문제가 있으면 Error) */
  save: () => string;
  load: (text: string) => void;
  loadSample: () => void;
  loadNew: () => void;
  loadGrid: () => void;
  loadHills: () => void;
  loadTerrain: (kind: TerrainKind) => void;
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
  /** 사고·날씨 이벤트 켜기/끄기 */
  setEvents: (on: boolean) => void;
  /** 적색 우회전 켜기/끄기 */
  setRtor: (on: boolean) => void;
  /** 배속을 한 단계 올리거나(1) 내린다(-1) */
  stepSpeed: (dir: 1 | -1) => void;
  /** 단축키 도움말 창 열기/닫기 */
  toggleHelp: () => void;
}

export function createTools(d: Deps) {
  const net = d.editor.network;
  let tool: Tool = null;
  let start: Pt | null = null;
  let last: Pt | null = null; // 마지막 커서(지면 좌표)
  let lastClient = { x: 0, y: 0 };
  let gridSnap = true;
  let angleSnap = false;
  let overMode = false; // 입체 모드: 도로를 다른 도로 위로 지나가는 고가로 만든다(교차로를 만들지 않는다)
  let curveMode = false; // 곡선 모드: 도로 도구가 세 번 클릭(시작 → 휘는 점 → 끝)으로 곡선을 만든다
  let curvePts: Pt[] = [];
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
    demolish: svg('<path d="M3 6v14"/><path d="M3 13h6"/><rect x="9" y="9" width="10" height="7" rx="1.5"/><path d="M12 9V5h4l3 4"/><rect x="7" y="17" width="18" height="6" rx="3"/><circle cx="11" cy="20" r="0.8" fill="currentColor"/><circle cx="21" cy="20" r="0.8" fill="currentColor"/>'),
    view: svg('<path d="M4 24h20"/><rect x="5.5" y="14" width="4" height="10" rx="1" fill="currentColor"/><rect x="12" y="8" width="4" height="16" rx="1" fill="currentColor"/><rect x="18.5" y="11" width="4" height="13" rx="1" fill="currentColor"/>'),
    tools: svg('<path d="M18 4a6 6 0 0 0-5.6 8L4.5 20a2.2 2.2 0 0 0 3.2 3.2L15.6 15.5A6 6 0 0 0 24 10l-3.6 3.2-3.4-.8-.8-3.4L19.6 5.6A6 6 0 0 0 18 4z"/>'),
    school: svg('<path d="M3 12 14 5l11 7"/><path d="M6 12v10h16V12"/><rect x="11" y="16" width="6" height="6"/><path d="M14 5V2"/>'),
    undo: svg('<path d="M10 5 5 10l5 5"/><path d="M5 10h11.5a5.5 5.5 0 0 1 0 11H9"/>'),
    redo: svg('<path d="M18 5l5 5-5 5"/><path d="M23 10H11.5a5.5 5.5 0 0 0 0 11H19"/>'),
  };
  d.toolbar.innerHTML = `
    <div class="subs">
      <div class="sub" id="sub-road" data-cat="road" hidden>
        <button data-tool="road2" title="단축키 2: 드래그로 왕복 2차로를 그립니다">${config.roads.road2.name} [2]</button>
        <button data-tool="road4" title="단축키 4: 왕복 4차로">${config.roads.road4.name} [4]</button>
        <button data-tool="road3" title="단축키 3: 비대칭 3차로. 그리는 방향 2차로 + 반대 방향 1차로(출퇴근 방향이 한쪽으로 몰리는 길에)">${config.roads.road3.name} [3]</button>
        <button data-tool="road5" title="단축키 5: 비대칭 5차로. 그리는 방향 3차로 + 반대 방향 2차로">${config.roads.road5.name} [5]</button>
        <button data-tool="road6" title="단축키 6: 왕복 6차로">${config.roads.road6.name} [6]</button>
        <button data-tool="oneway1" title="단축키 Shift+2: 일방통행 1차로 도로. 그리는 방향으로만 갑니다">일방통행 1차로 [⇧2]</button>
        <button data-tool="oneway2" title="단축키 Shift+4: 일방통행 2차로 도로">일방통행 2차로 [⇧4]</button>
        <button data-tool="oneway3" title="단축키 Shift+6: 일방통행 3차로 도로">일방통행 3차로 [⇧6]</button>
        <label class="chip" title="단축키 Q: 켜면 세 번 클릭해(시작 → 휘는 점 → 끝) 곡선 도로를 만듭니다"><input type="checkbox" id="curve" /> 곡선 [Q]</label>
        <label class="chip" title="단축키 T: 켜면 그리는 도로가 다른 도로 위로 지나가는 고가(입체교차)가 됩니다. 도로와 교차하고 길이 140m 이상이어야 합니다"><input type="checkbox" id="over" /> 입체 [T]</label>
        <button data-tool="roundabout" title="단축키 R: 교차로를 클릭하면 회전교차로로 바꿉니다(도로가 환형 반지름 + 20m보다 길어야 함)">회전교차로 [R]</button>
        <button data-tool="oneway" title="단축키 W: 도로를 클릭할 때마다 양방향 → 한쪽 방향 → 반대 방향 → 양방향. 도로 위 화살표가 가는 방향입니다">일방통행 [W]</button>
        <button data-tool="upgrade" title="단축키 U: 도로를 한 단계 넓힙니다(2→4→6차로). 교차로 사이 한 구간씩">넓히기 [U]</button>
        <button data-tool="downgrade" title="단축키 Shift+U: 도로를 한 단계 좁힙니다(6→4→2차로)">좁히기 [⇧U]</button>
        <span class="opts">
          <label><input type="checkbox" id="grid" checked /> 격자 스냅 (${config.editor.gridSnap}m)</label>
          <label><input type="checkbox" id="ortho" checked /> 직각 맞추기</label>
          <label><input type="checkbox" id="angle" /> 각도 스냅 (${config.editor.angleSnapDeg}°)</label>
        </span>
      </div>
      <div class="sub" id="sub-zone" data-cat="zone" hidden>
        <button data-tool="zoneHome" class="z-home" title="단축키 H: 드래그해서 주거 저밀 구역(작은 집)을 칠합니다">주거 저밀 [H]</button>
        <button data-tool="zoneHomeMid" class="z-homeMid" title="단축키 J: 주거 중밀 구역(중간 크기 건물)">주거 중밀 [J]</button>
        <button data-tool="zoneHomeHigh" class="z-homeHigh" title="단축키 K: 주거 고밀 구역(큰 아파트, 2×2칸)">주거 고밀 [K]</button>
        <button data-tool="zoneShop" class="z-shop" title="단축키 C: 드래그해서 상업 구역(상점)을 칠합니다. 점심·쇼핑·여가 이동이 생깁니다">상업 [C]</button>
        <button data-tool="zoneOffice" class="z-office" title="단축키 O: 사무 구역(사무 건물)">사무 [O]</button>
        <button data-tool="zoneIndustrial" class="z-industrial" title="단축키 I: 산업 구역(공장). 화물 트럭이 다닙니다">산업 [I]</button>
        <button data-tool="zoneMixed" class="z-mixed" title="단축키 Z: 혼합 용도 구역(1층 상가 + 위층 주거인 상가주택). 주거이면서 상점입니다">혼합 [Z]</button>
        <button data-tool="zoneErase" title="단축키 E: 드래그해서 구역을 지웁니다">구역 지우기 [E]</button>
      </div>
      <div class="sub" id="sub-traffic" data-cat="traffic" hidden>
        <button data-tool="stop" title="단축키 S">정지 표지 [S]</button>
        <button data-tool="yield" title="단축키 Y">양보 표지 [Y]</button>
 <button data-tool="noleft" title="단축키 N: 교차로로 들어오는 도로 끝을 클릭하면 그 방향의 좌회전이 금지됩니다(다시 클릭하면 해제)">좌회전 금지 [N]</button>
        <button data-tool="noentry" title="단축키 B: 교차로 쪽 도로 끝을 클릭하면 교차로에서 그 도로로 들어가는 것이 금지됩니다(다시 클릭하면 해제)">진입 금지 [B]</button>
        <button data-tool="signal" title="단축키 G: 교차로를 클릭할 때마다 꺼짐 → 고정식 → 감응식 → 꺼짐">신호등 [G]</button>
        <select id="sgreen" title="고정식 신호의 기본 녹색 시간(큰 도로가 낀 방향은 2배)">${config.signals.greenChoices.map((g) => `<option value="${g}"${g === config.signals.greenSec ? ' selected' : ''}>녹색 ${g}초</option>`).join('')}</select>
        <button data-tool="limit" title="단축키 L: 도로를 클릭할 때마다 제한속도가 바뀝니다">속도 제한 [L]</button>
      </div>
      <div class="sub" id="sub-facility" data-cat="facility" hidden>
        <button data-tool="school" title="단축키 P: 학교를 직접 놓습니다. 학생이 아침에 등교하고 오후에 돌아옵니다(거주자의 15%)">학교 [P]</button>
        <select id="bsize" title="학교 크기(대형은 2×2칸)"><option value="small">소 (수용 10)</option><option value="medium" selected>중 (30)</option><option value="large">대 (100)</option></select>
      </div>
      <div class="sub" id="sub-view" data-cat="view" hidden>
        <label><input type="checkbox" id="heat" /> 정체 히트맵 (M)</label>
        <label><input type="checkbox" id="cb" /> 색약 친화 색상</label>
        <label><input type="checkbox" id="debugToggle" /> 디버그 표시 (D)</label>
        <label title="적색일 때 우회전은 완전히 선 뒤 교차 차량이 없으면 갑니다"><input type="checkbox" id="rtor" checked /> 적색 우회전</label>
        <label title="단축키 F: 사고(차량이 갑자기 서서 차선을 막음)와 비(속도 저하, 사고 증가)"><input type="checkbox" id="events" /> 사고·날씨 (F)</label>
        <button id="helpbtn" title="단축키 ?">단축키 도움말 [?]</button>
      </div>
      <div class="sub" id="sub-tools" data-cat="tools" hidden>
        <button data-tool="trip" title="단축키 V">차량 투입 (테스트) [V]</button>
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
      <button data-catbtn="facility">${ICON.school}시설</button>
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
    <div class="mrow"><button id="gridcity" title="큰길·세로 길·신호등·회전교차로·구역이 갖춰진 격자 도시. 신호와 병목 찾기를 시험해 보기 좋습니다">격자 도시</button><button id="hillcity" title="언덕과 강이 있는 지형. 도로가 지형을 따라 오르내리고 강 위는 다리가 됩니다. 입체교차(T)도 시험해 보세요">구릉 도시</button></div>
    <div class="mrow"><select id="terrainType" title="지형 유형(CS2 맵 구성을 단순화)">${(Object.entries(TERRAIN_PRESETS) as [string, { name: string }][]).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select><button id="terraincity" title="고른 지형에서 외부 연결 도로만 있는 새 도시를 시작합니다. 경사·물·다리 규칙이 적용됩니다">지형 도시</button></div>
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
  // 분류 버튼을 다시 눌러 닫을 때, 그 분류에서 고른 도구도 함께 해제한다(예: 직장 구역을 고른 채 "구역"을 누르면 직장 구역 선택도 풀린다)
  catBtns.forEach((b) => (b.onclick = () => {
    const cat = b.dataset.catbtn!;
    if (b.classList.contains('on')) {
      if (tool && catOf(tool) === cat) setTool(tool); // 같은 도구를 다시 고르면 해제된다
      openCat(null);
    } else openCat(cat);
  }));
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
    if (L < 20) return null;
    const hit = net.snapPoint(raw);
    if (hit.nodeId !== undefined && net.segmentsAt(hit.nodeId).length >= 3) return null; // 교차점에 닿으려는 때는 그대로(이음 노드는 도로의 한 점이므로 직각을 맞춘다)
    const ang = Math.atan2(raw.y - from.y, raw.x - from.x), rad = (d: number) => (d * Math.PI) / 180;
    // (1) 커서 가까이(35m)의 모든 도로 조각 중, 시작점에서 수직으로 내린 발이 조각 안에 있고 커서 방향과 가장 가까운 것
    let best: { p: Pt; score: number } | null = null;
    for (const sg of net.segments.values()) {
      const a = net.nodes.get(sg.a)!, b = net.nodes.get(sg.b)!;
      const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy, u = ((from.x - a.x) * dx + (from.y - a.y) * dy) / len2;
      if (u <= 0.02 || u >= 0.98) continue;
      const foot = { x: a.x + u * dx, y: a.y + u * dy };
      if (Math.hypot(foot.x - from.x, foot.y - from.y) < 20) continue;
      const near = Math.hypot(foot.x - raw.x, foot.y - raw.y);
      const diff = angDiff(Math.atan2(foot.y - from.y, foot.x - from.x), ang);
      if (near > 35 || diff > rad(45)) continue;
      const score = diff + near * 0.01;
      if (!best || score < best.score) best = { p: foot, score };
    }
    if (best) return best.p;
    // (2) 도로(또는 교차점)에서 출발하면 그 도로에 수직인 방향으로
    const hs = net.snapPoint(from), dirs: number[] = [];
    const dirOf = (sg: { a: number; b: number }) => { const a = net.nodes.get(sg.a)!, b = net.nodes.get(sg.b)!; return Math.atan2(b.y - a.y, b.x - a.x); };
    if (hs.segId !== undefined) dirs.push(dirOf(net.segments.get(hs.segId)!));
    else if (hs.nodeId !== undefined) for (const sg of net.segmentsAt(hs.nodeId)) dirs.push(dirOf(sg));
    for (const d of dirs) for (const t of [d + Math.PI / 2, d - Math.PI / 2]) {
      const diff = angDiff(ang, t);
      if (diff < rad(30)) { const len = L * Math.cos(diff); return { x: from.x + len * Math.cos(t), y: from.y + len * Math.sin(t) }; }
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

  // 커서 옆 안내 글자(tip)
  function tipAt(text: string, bad: boolean) {
    d.tip.textContent = text;
    d.tip.classList.toggle('bad', bad);
    d.tip.style.left = `${lastClient.x + 16}px`;
    d.tip.style.top = `${lastClient.y + 16}px`;
    d.tip.hidden = false;
  }
  // 학교를 놓을 자리: 소·중은 칸 중심, 대(2×2칸)는 칸 모서리에 맞춘다
  function schoolSpot(p: Pt, size: BuildingSize): Pt {
    const c = config.zones.cell;
    return size === 'large' ? { x: (Math.round(p.x / c - 0.5) + 0.5) * c, y: (Math.round(p.y / c - 0.5) + 0.5) * c } : { x: Math.round(p.x / c) * c, y: Math.round(p.y / c) * c };
  }

  // ---- 갱신 ----
  function refresh() {
    d.roads.clearGhost();
    d.roads.setHover(null);
    d.buildings.clearGhost();
    d.buildings.setHover(null);
    d.zones.clearGhost();
    d.roads.setCurve(null, 'road2', true);
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
    if (tool === 'oneway') {
      const h = d.pickRoad(last);
      d.roads.setCursor(h ? { x: h.x, y: h.y } : null, !!h);
      if (h) {
        const s = net.segments.get(h.segId)!;
        d.tip.textContent = `일방통행: ${s.oneWay === null ? '지금 양방향 · 클릭하면 한쪽 방향' : s.oneWay === 'ab' ? '지금 한쪽 방향 · 클릭하면 반대 방향' : '지금 반대 방향 · 클릭하면 양방향'}`;
        d.tip.classList.remove('bad');
        d.tip.style.left = `${lastClient.x + 16}px`;
        d.tip.style.top = `${lastClient.y + 16}px`;
        d.tip.hidden = false;
      }
      return;
    }
    if (tool === 'roundabout') {
      const n = signalNode(last);
      d.roads.setCursor(n ? { x: n.x, y: n.y } : null, !!n);
      tipAt(n ? '회전교차로로 바꾸기 (반시계 방향 환형, 들어가는 도로는 양보)' : '교차로를 클릭하세요', !n);
      return;
    }
    if (tool === 'school') {
      const size = $<HTMLSelectElement>(d.toolbar, '#bsize').value as BuildingSize;
      const p = schoolSpot(last, size);
      const plan = net.planBuilding('school', size, p.x, p.y);
      d.buildings.setGhost('school', size, p.x, p.y, plan.ok);
      const linked = net.projectOnRoad(p, config.buildings.connectRadius) !== null;
      tipAt(plan.ok ? `학교 (${size === 'small' ? '소' : size === 'medium' ? '중' : '대'}) · 수용 ${config.buildings.capacity[size]}명${linked ? '' : ' — 도로에 연결 안 됨'}` : `학교 — ${BERR[plan.error]}`, !plan.ok || !linked);
      return;
    }
    if (tool === 'upgrade' || tool === 'downgrade') {
      const h = d.pickRoad(last);
      d.roads.setCursor(h ? { x: h.x, y: h.y } : null, !!h && net.upgradeChain(h.segId, tool === 'upgrade' ? 'up' : 'down').length > 0);
      if (h) {
        const n = net.upgradeChain(h.segId, tool === 'upgrade' ? 'up' : 'down').length;
        tipAt(n ? `${tool === 'upgrade' ? '넓히기' : '좁히기'} (교차로 사이 ${n}구간)` : tool === 'upgrade' ? '더 넓힐 수 없습니다 (최대 왕복 6차로)' : '더 좁힐 수 없습니다 (왕복 2차로)', !n);
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
    if (tool === 'stop' || tool === 'yield' || tool === 'noleft' || tool === 'noentry') {
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
    if (curveMode) { // 곡선 모드: 클릭한 점들과 커서로 곡선 미리보기
      d.roads.setCursor(p, true);
      const kind = roadKind();
      if (curvePts.length === 0) { tipAt('곡선: 시작점을 클릭하세요', false); return; }
      const pts = curvePts.length === 1 ? [curvePts[0], p] : curvePoints(curvePts[0], curvePts[1], p);
      const ok = pts.slice(1).every((q, i) => net.planRoad(pts[i], q, kind, CURVE_PIECE - 1).ok);
      d.roads.setCurve(pts, kind, ok);
      const len = pts.slice(1).reduce((n, q, i) => n + Math.hypot(q.x - pts[i].x, q.y - pts[i].y), 0);
      tipAt(`${Math.round(len)} m${ok ? '' : ' — 건설할 수 없는 구간이 있습니다'}`, !ok);
      return;
    }
    if (!start) { d.roads.setCursor(p, true); return; }
    const plan = net.planRoad(start, p, roadKind(), undefined, overMode);
    d.roads.setGhost(start, p, roadKind(), plan.ok);
    const len = plan.ok ? plan.length : Math.hypot(p.x - start.x, p.y - start.y);
    const slope = net.terrain ? ` · 경사 ${Math.round((Math.abs(net.heightAt(p.x, p.y) - net.heightAt(start.x, start.y)) / Math.max(1, len)) * 100)}%` : ''; // CS2처럼 놓는 동안 경사를 보여 준다
    d.tip.textContent = `${Math.round(len)} m${slope}${plan.ok ? '' : ' — ' + ERR[plan.error]}`;
    d.tip.classList.toggle('bad', !plan.ok);
    d.tip.style.left = `${lastClient.x + 16}px`;
    d.tip.style.top = `${lastClient.y + 16}px`;
    d.tip.hidden = false;
  }

  function setTool(t: Tool) {
    tool = tool === t ? null : t;
    if (tool) d.selectRoad(null);
    if (tool) openCat(catOf(tool)); // 단축키로 골라도 그 분류가 열린다
    start = null;
    tripFrom = null;
    dragging = false;
    zoneFrom = null;
    curvePts = [];
    syncDrawMode();
    refresh();
  }

  function click() {
    if (!last) return;
    if (tool === null) { // 차량(가장 가까운 것) → 차량 정보, 교차로(가까이 있을 때 우선) → 교차로 정보, 아니면 도로 정보
      const vid = d.pickVehicle(last);
      if (vid !== null) { d.selectVehicle(vid); return; }
      const n = signalNode(last);
      if (n) d.selectNode(n.id); else d.selectRoad(d.pickRoad(last)?.segId ?? null);
      return;
    }
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
    if (tool === 'oneway') {
      const h = d.pickRoad(last);
      if (!h) { say('도로 위를 클릭하세요'); return; }
      const s = net.segments.get(h.segId)!, a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!;
      const next = s.oneWay === null ? 'ab' : s.oneWay === 'ab' ? 'ba' : null;
      d.editor.setOneWay(s.id, next);
      say(next === null ? '양방향으로 되돌렸습니다' : next === 'ab' ? `일방통행: (${Math.round(a.x)}, ${Math.round(a.y)}) → (${Math.round(b.x)}, ${Math.round(b.y)}) 방향` : `일방통행: (${Math.round(b.x)}, ${Math.round(b.y)}) → (${Math.round(a.x)}, ${Math.round(a.y)}) 방향`);
      refresh();
      return;
    }
    if (tool === 'upgrade' || tool === 'downgrade') {
      const h = d.pickRoad(last);
      if (!h) { say('도로 위를 클릭하세요'); return; }
      const up = tool === 'upgrade', r = d.editor.upgrade(h.segId, up ? 'up' : 'down');
      say(r.ok ? `${config.roads[net.segments.get(h.segId)!.kind].name}로 ${up ? '넓혔' : '좁혔'}습니다 (${r.ids.length}구간)` : r.error === 'onBuilding' ? '옆에 건물이 있어 넓힐 수 없습니다' : up ? '더 넓힐 수 없습니다 (최대 왕복 6차로)' : '더 좁힐 수 없습니다 (왕복 2차로)');
      refresh();
      return;
    }
    if (tool === 'roundabout') {
      const n = signalNode(last);
      if (!n) { say('교차로(도로 3개 이상이 만나는 곳)를 클릭하세요'); return; }
      const r = d.editor.makeRoundabout(n.id);
      say(r.ok ? `회전교차로를 만들었습니다 (도로 ${r.ring.length}개 연결)` : r.error === 'tooShort' ? '연결된 도로가 짧습니다 (환형 반지름 + 20m보다 길어야 합니다)' : r.error === 'tooTight' ? '도로 사이 각도가 너무 좁아 환형을 만들 수 없습니다' : r.error === 'onBuilding' ? '교차로 가까이에 건물이 있어 만들 수 없습니다' : '교차로를 클릭하세요');
      refresh();
      return;
    }
    if (tool === 'school') {
      const size = $<HTMLSelectElement>(d.toolbar, '#bsize').value as BuildingSize;
      const p = schoolSpot(last, size);
      const r = d.editor.addBuilding('school', size, p.x, p.y, 'player', true);
      if (!r.ok) say(BERR[r.error]);
      else say(net.accessOf(r.id) === null ? '학교를 놓았지만 도로에 연결되지 않았습니다 (도로 가까이에 놓으세요)' : '학교를 놓았습니다');
      refresh();
      return;
    }
    if (roadTool() && curveMode) { // 곡선: 시작 → 휘는 점 → 끝 세 번 클릭
      if (tool! in ONEWAY_KIND) { say('일방통행 도로는 직선으로만 그립니다 (곡선 모드를 끄세요)'); return; }
      curvePts.push(cursorPoint(last));
      if (curvePts.length === 3) {
        const r = d.editor.buildCurve(curvePts[0], curvePts[1], curvePts[2], roadKind());
        say(r.ok ? `곡선 도로를 만들었습니다 (${Math.round(r.length)} m)` : r.error === 'tooSharp' ? '곡선이 너무 급하거나 다른 도로와 너무 가깝습니다' : ERR[r.error]);
        curvePts = [];
      } else say(curvePts.length === 1 ? '곡선: 휘어지는 점을 클릭하세요' : '곡선: 끝점을 클릭하세요');
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
    if (tool === 'noleft' || tool === 'noentry') {
      const t = signTarget(last);
      if (!t) { say('도로 위를 클릭하세요'); return; }
      const kind = tool === 'noleft' ? 'noLeft' : 'noEntry';
      const cur = net.restrictAt(t.segId, t.nodeId);
      const r = d.editor.setRestrict(t.segId, t.nodeId, cur === kind ? null : kind);
      say(!r.ok ? '통행 제한은 도로 3개 이상이 만나는 교차로 쪽에서만 놓을 수 있습니다' : cur === kind ? '제한을 풀었습니다' : tool === 'noleft' ? '좌회전을 금지했습니다 (이 도로 끝으로 들어오는 차량)' : '진입을 금지했습니다 (교차로에서 이 도로로 들어가는 것). 갈 수 없는 목적지는 미완료로 집계됩니다');
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
    if (start || tripFrom || zoneFrom || curvePts.length) { start = null; tripFrom = null; zoneFrom = null; curvePts = []; dragging = false; }
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
  const ONEWAY_KIND: Partial<Record<NonNullable<Tool>, RoadKind>> = { oneway1: 'road2', oneway2: 'road4', oneway3: 'road6' }; // 일방통행 도로 종류 = 같은 차선 수 도로 + 그리는 방향 일방통행
  const roadTool = () => tool !== null && (tool in config.roads || tool in ONEWAY_KIND);
  const roadKind = (): RoadKind => (ONEWAY_KIND[tool!] ?? tool) as RoadKind;
  const drawing = () => roadTool() && !curveMode; // 곡선 모드에서는 드래그로 그리지 않는다
  const syncDrawMode = () => d.setDrawMode((roadTool() && !curveMode) || tool !== null && tool in ZONE_TOOLS);
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
        say(n > 0 ? `${ZONE_NAME[tool as keyof typeof ZONE_NAME]} ${n}칸` : `칠할 수 있는 칸이 없습니다 (도로 옆 ${config.zones.maxDist}m 안의 빈 땅만 가능)`);
      }
      if (from && last && drawing()) {
        start = from; // 각도·직각 맞추기는 시작점을 알아야 한다(미리보기와 같은 결과가 되도록)
        const to = cursorPoint({ ...last });
        start = null;
        if (Math.hypot(to.x - from.x, to.y - from.y) > 1e-6) { if (overMode) { const r = d.editor.buildOver(from, to, roadKind()); if (!r.ok) say(ERR[r.error]); } else if (tool! in ONEWAY_KIND) d.editor.buildOneWay(from, to, roadKind()); else { const r = d.editor.build(from, to, roadKind()); if (!r.ok) say(ERR[r.error]); } }
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

  // 단축키(CS2처럼 도구 모음과 같은 분류로 묶고, 글자는 기억하기 쉬운 것으로): 도로 2·4·6·Q(곡선)·R(회전교차로)·W(일방통행)·U/Shift+U(넓히기/좁히기),
  // 구역 H·J·K(주거 저·중·고밀)·C(상업)·O(사무)·I(산업)·E(지우기), 시설 P(학교), 교통 S·Y·G·N·B·L, 철거 X, 보기 M·D·F, 도구 V
  const KEYS: Record<string, Tool> = { '2': 'road2', '3': 'road3', '4': 'road4', '5': 'road5', '6': 'road6', r: 'roundabout', w: 'oneway', h: 'zoneHome', j: 'zoneHomeMid', k: 'zoneHomeHigh', c: 'zoneShop', o: 'zoneOffice', i: 'zoneIndustrial', e: 'zoneErase', p: 'school', z: 'zoneMixed', s: 'stop', y: 'yield', g: 'signal', n: 'noleft', b: 'noentry', l: 'limit', x: 'demolish', v: 'trip' };
  const toggleBox = (id: string, fn: (on: boolean) => void) => { const c = $<HTMLInputElement>(d.toolbar, id); c.checked = !c.checked; fn(c.checked); };
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) d.editor.redo(); else d.editor.undo(); start = null; refresh(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); d.editor.redo(); start = null; refresh(); }
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (k === 'escape') cancel();
    else if (e.shiftKey && (e.code === 'Digit2' || e.code === 'Digit4' || e.code === 'Digit6')) setTool(e.code === 'Digit2' ? 'oneway1' : e.code === 'Digit4' ? 'oneway2' : 'oneway3');
    else if (k === 'u') setTool(e.shiftKey ? 'downgrade' : 'upgrade');
    else if (k === 'q') toggleBox('#curve', (on) => { curveMode = on; curvePts = []; start = null; dragging = false; syncDrawMode(); refresh(); say(on ? '곡선 모드: 도로 도구를 고르고 세 번 클릭하세요 (시작 → 휘는 점 → 끝)' : '직선 모드'); });
    else if (k === 't') toggleBox('#over', (on) => { overMode = on; refresh(); say(on ? '입체 모드: 다른 도로와 교차하는 길을 그리면 위로 지나가는 고가가 됩니다' : '입체 모드 끔'); });
    else if (k === 'm') toggleBox('#heat', (on) => d.setHeat(on));
    else if (k === 'd') toggleBox('#debugToggle', (on) => d.setDebug(on));
    else if (k === 'f') toggleBox('#events', (on) => { d.setEvents(on); say(on ? '사고·날씨 이벤트를 켰습니다' : '사고·날씨 이벤트를 껐습니다'); });
    else if (k === ' ') { e.preventDefault(); d.togglePause(); }
    else if (k === '+' || k === '=') d.stepSpeed(1);
    else if (k === '-' || k === '_') d.stepSpeed(-1);
    else if (k === '?' || k === '/') d.toggleHelp();
    else if (KEYS[k]) setTool(KEYS[k]);
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
  $<HTMLInputElement>(d.toolbar, '#over').onchange = (e) => { overMode = (e.target as HTMLInputElement).checked; refresh(); };
  $<HTMLInputElement>(d.toolbar, '#curve').onchange = (e) => { curveMode = (e.target as HTMLInputElement).checked; curvePts = []; start = null; dragging = false; syncDrawMode(); refresh(); };
  $<HTMLInputElement>(d.toolbar, '#rtor').onchange = (e) => d.setRtor((e.target as HTMLInputElement).checked);
  $<HTMLInputElement>(d.toolbar, '#events').onchange = (e) => d.setEvents((e.target as HTMLInputElement).checked);
  $<HTMLSelectElement>(d.toolbar, '#bsize').onchange = () => refresh();
  $(d.toolbar, '#helpbtn').onclick = () => d.toggleHelp();
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
  $(d.filebar, '#terraincity').onclick = () => guard(() => { const k = $<HTMLSelectElement>(d.filebar, '#terrainType').value as TerrainKind; d.loadTerrain(k); say(`${TERRAIN_PRESETS[k].name} 지형의 새 도시를 열었습니다. 도로는 지형을 따라 오르내리고, 물 위는 다리가 됩니다`); });
  $(d.filebar, '#hillcity').onclick = () => guard(() => { d.loadHills(); say('구릉 도시를 열었습니다. 강 위는 다리가 되고, 도로는 지형을 따라 오르내립니다'); });
  $(d.filebar, '#gridcity').onclick = () => guard(() => { d.loadGrid(); say('격자 도시를 열었습니다. 구역에 건물이 자라고 신호등이 켜져 있습니다'); });
  $(d.filebar, '#sample').onclick = () => guard(() => { d.loadSample(); say('샘플 맵을 열었습니다. 평일 아침 6시부터 출근이 시작됩니다'); });

  refresh();
  return { refresh, say };
}
