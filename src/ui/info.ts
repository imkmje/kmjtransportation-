import type { Config } from '../config';
import type { Editor } from '../sim/editor';
import { ciGrade, type Metrics } from '../sim/metrics';
import type { Segment } from '../sim/network';
import type { Signals } from '../sim/signals';
import type { Traffic } from '../sim/traffic';
import { clockRatio } from '../sim/time';

/** 화면 쪽 동작(덧그림·카메라 따라가기). 정보 창은 sim만 읽고 이 함수들로 화면에 알린다 */
export interface InfoHooks {
  traffic: Traffic;
  onRoute: (pts: { x: number; y: number }[] | null, origin: { x: number; y: number } | null, dest: { x: number; y: number } | null) => void;
  onFlows: (lines: [{ x: number; y: number }, { x: number; y: number }][] | null) => void;
  onFollow: (id: number | null) => void;
}
const BNAME: Record<string, string> = { home: '주거', office: '사무', factory: '공장', shop: '상점', school: '학교', mixed: '상가주택', external: '외부 연결점' };
const TRIP: Record<string, string> = { commute: '출근·등교', return: '귀가·복귀', errand: '외출(점심·쇼핑·여가)', test: '테스트 차량' };

const SIGN = { stop: '정지 표지', yield: '양보 표지' } as const;
const RES = { noLeft: '좌회전 금지', noEntry: '진입 금지' } as const;

type Sel = { kind: 'seg'; id: number } | { kind: 'node'; id: number } | { kind: 'veh'; id: number } | null;

/**
 * 정보 창: 도로를 클릭하면 종류·제한속도·통과 차량·정체 지수·양 끝의 제어를, 교차로를 클릭하면 신호 방식과 단계별 녹색 시간을 보여 준다.
 * 신호 편집(방식 고르기, 녹색 시간 늘리고 줄이기, 녹색파 맞추기)도 여기서 한다
 */
export function createInfo(root: HTMLElement, cfg: Config, editor: Editor, metrics: Metrics, signals: Signals, say: (t: string) => void, onClose: () => void, onUpgrade: (segId: number, dir: 'up' | 'down') => void, hooks: InfoHooks) {
  const net = editor.network;
  let sel: Sel = null;
  let clip: ReturnType<Signals['copyProgram']> = null; // 복사해 둔 신호 프로그램
  let flowSeg: number | null = null; // 이동 흐름을 보고 있는 도로
  let following = false;
  const K = clockRatio(cfg.dayLengthMinutes);
  const clearOverlays = () => { flowSeg = null; following = false; hooks.onRoute(null, null, null); hooks.onFlows(null); hooks.onFollow(null); };
  let last = '';
  root.hidden = true;

  const endText = (s: Segment, nodeId: number): string => {
    const parts: string[] = [];
    if (net.hasSignal(nodeId)) parts.push(net.isActuated(nodeId) ? '감응식 신호' : '고정식 신호');
    const sign = net.signAt(s.id, nodeId);
    if (sign && !net.hasSignal(nodeId)) parts.push(SIGN[sign]);
    const res = net.restrictAt(s.id, nodeId);
    if (res) parts.push(RES[res]);
    return parts.join(', ') || '제어 없음';
  };
  const axis = (nodeId: number, segs: number[]) => { // 단계 이름: 도로가 달리는 방향(가로·세로·대각선)
    const n = net.nodes.get(nodeId)!;
    return segs.map((id) => { const s = net.segments.get(id)!, o = net.nodes.get(s.a === nodeId ? s.b : s.a)!; const dx = Math.abs(o.x - n.x), dy = Math.abs(o.y - n.y); return dx > 2 * dy ? '가로' : dy > 2 * dx ? '세로' : '대각선'; }).filter((v, i, a) => a.indexOf(v) === i).join('·');
  };

  const escapeHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  // 차선별 방향: 교차로로 들어오는 끝마다, 차선(오른쪽부터)에 좌회전(←)·직진(↑)·우회전(→) 허용 여부를 켜고 끈다
  function laneHtml(s: Segment): string {
    const ends = [s.a, s.b].filter((n) => net.segmentsAt(n).length >= 3 && !(s.oneWay === 'ab' && n === s.a) && !(s.oneWay === 'ba' && n === s.b));
    return ends.map((n) => {
      const lanes = net.lanesIncoming(s.id, n), cur = net.laneDirsAt(s.id, n), node = net.nodes.get(n)!;
      const rows = Array.from({ length: lanes }, (_, i) => { const m = cur[i] || 7; return `<div class="ln"><span>${i + 1}차선${i === 0 ? '(오른쪽)' : i === lanes - 1 && lanes > 1 ? '(왼쪽)' : ''}</span>${[[1, '←', '좌'], [2, '↑', '직'], [4, '→', '우']].map(([bit, ar, nm]) => `<button data-ld="${n}:${i}:${bit}" class="${m & (bit as number) ? 'on' : ''}" title="${nm}">${ar}</button>`).join('')}</div>`; }).join('');
      return `<div class="sub-h">차선 방향 · 끝 (${Math.round(node.x)}, ${Math.round(node.y)})</div>${rows}<div class="two"><button class="wide" data-ld-auto="${n}">자동 배정</button><button class="wide" data-ld-reset="${n}">모두 허용</button></div>`;
    }).join('');
  }

  function segHtml(s: Segment): string {
    const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!, r = cfg.roads[s.kind];
    const rep = metrics.segmentReport().get(s.id);
    const ci = rep?.ci ?? null;
    const wave = net.hasSignal(s.a) && net.hasSignal(s.b) && !net.isActuated(s.a) && !net.isActuated(s.b);
    return `
      <h4>도로 정보${s.name ? ` · ${escapeHtml(s.name)}` : ''} <button id="in-close" title="닫기">✕</button></h4>
      <div class="kv">
        <div>종류</div><div>${r.name}${s.locked ? ' (철거 불가)' : ''}</div>
        <div>길이</div><div>${Math.round(net.segmentLength(s))} m</div>
        <div>통행</div><div>${s.oneWay === null ? '양방향' : s.oneWay === 'ab' ? `일방통행 (${Math.round(a.x)}, ${Math.round(a.y)}) → (${Math.round(b.x)}, ${Math.round(b.y)})` : `일방통행 (${Math.round(b.x)}, ${Math.round(b.y)}) → (${Math.round(a.x)}, ${Math.round(a.y)})`}</div>
        <div>제한속도</div><div>${s.playerSpeedKmh ?? r.defaultSpeedKmh} km/h${s.playerSpeedKmh === null ? ' (기본)' : ''}</div>
        <div>최근 통과 차량</div><div>${rep?.passes ?? 0}대 <small>(시뮬 ${cfg.metrics.windowSec / 60}분)</small></div>
        <div>정체 지수</div><div>${ci === null ? '판정 없음 (통과 적음)' : `${ci.toFixed(0)} · ${ciGrade(ci)}`}</div>
        <div>한쪽 끝 (${Math.round(a.x)}, ${Math.round(a.y)})</div><div>${endText(s, s.a)}</div>
        <div>반대쪽 끝 (${Math.round(b.x)}, ${Math.round(b.y)})</div><div>${endText(s, s.b)}</div>
      </div>
      <div class="namebox"><input id="in-name" maxlength="30" placeholder="도로 이름" value="${escapeHtml(s.name)}" /><button id="in-name-ok">이름 저장</button></div>
      <div class="two">${net.upgradeChain(s.id, 'up').length ? '<button class="wide" id="in-up">넓히기</button>' : ''}${net.upgradeChain(s.id, 'down').length ? '<button class="wide" id="in-down">좁히기</button>' : ''}</div>
      ${laneHtml(s)}
      <button class="wide" id="in-flow">${flowSeg === s.id ? '이동 흐름 끄기' : '이동 흐름 보기 (지나는 차의 출발지 → 목적지)'}</button>
      ${wave ? `<div class="sub-h">녹색파 (고정식 신호끼리)</div><button class="wide" data-wave="${s.a}">(${Math.round(a.x)}, ${Math.round(a.y)}) → (${Math.round(b.x)}, ${Math.round(b.y)}) 방향으로 맞추기(이어지는 신호까지 연속)</button><button class="wide" data-wave="${s.b}">(${Math.round(b.x)}, ${Math.round(b.y)}) → (${Math.round(a.x)}, ${Math.round(a.y)}) 방향으로 맞추기</button>` : ''}`;
  }

  function nodeHtml(id: number): string {
    const n = net.nodes.get(id)!;
    const on = net.hasSignal(id), act = net.isActuated(id);
    const mode = !on ? 'off' : act ? 'act' : 'fix';
    const seg = (m: string, t: string) => `<button data-mode="${m}" class="${mode === m ? 'on' : ''}">${t}</button>`;
    let prog = '';
    if (on && !act) {
      const p = signals.program(id), cyc = p.reduce((t, x) => t + x.green + cfg.signals.yellowSec + cfg.signals.allRedSec, 0);
      prog = `<div class="sub-h">단계별 녹색 시간 (주기 ${Math.round(cyc)}초 · 시차 ${Math.round(n.sigOffset)}초)</div>` + p.map((x, i) => `<div class="ph"><button data-mv="${i}:-1" title="이 단계를 앞으로" ${i === 0 ? 'disabled' : ''}>▲</button><button data-mv="${i}:1" title="이 단계를 뒤로" ${i === p.length - 1 ? 'disabled' : ''}>▼</button><span>${i + 1}단계 ${axis(id, x.segs)}</span><button data-g="${i}" data-d="-5">−</button><b>${Math.round(x.green)}초</b><button data-g="${i}" data-d="5">＋</button></div>`).join('') + (n.sigOffset ? '<button class="wide" id="in-off">시차 없애기</button>' : '');
    } else if (act) {
      prog = `<div class="sub-h">감응식: 차가 오는 방향에 녹색 ${cfg.signals.minGreenSec}~${cfg.signals.maxGreenSec}초(큰 도로는 2배), 차가 없으면 넘깁니다</div>`;
    }
    return `
      <h4>교차로 정보 <button id="in-close" title="닫기">✕</button></h4>
      <div class="kv"><div>위치</div><div>(${Math.round(n.x)}, ${Math.round(n.y)})</div><div>연결 도로</div><div>${net.segmentsAt(id).length}개</div></div>
      <div class="sub-h">신호등</div><div class="seg3">${seg('off', '없음')}${seg('fix', '고정식')}${seg('act', '감응식')}</div>${prog}
      <div class="two">${on ? '<button class="wide" id="in-copy">신호 복사</button>' : ''}${clip ? '<button class="wide" id="in-paste">붙여넣기</button>' : ''}</div>
      ${clip ? `<div class="hint">복사됨: ${clip.mode === 'actuated' ? '감응식' : `고정식 ${clip.greens.join('·')}초`}</div>` : ''}
      <button class="wide" id="in-round">회전교차로로 바꾸기</button>`;
  }

  // 차량 정보 창: 뼈대는 한 번만 만들고 글자만 갱신한다(누르는 버튼이 사라지지 않게)
  function renderVeh(id: number) {
    const v = hooks.traffic.vehicles.get(id);
    if (!v) { say('그 차량은 도착했거나 사라졌습니다'); sel = null; root.hidden = true; last = ''; clearOverlays(); onClose(); return; }
    if (last !== 'veh') {
      last = 'veh';
      root.hidden = false;
      root.innerHTML = `<h4>차량 정보 <button id="in-close" title="닫기">✕</button></h4><div class="kv"><div>차종</div><div data-v="type"></div><div>이동</div><div data-v="trip"></div><div>출발</div><div data-v="from"></div><div>목적지</div><div data-v="to"></div><div>속도</div><div data-v="speed"></div><div>상태</div><div data-v="state"></div><div>경과</div><div data-v="age"></div></div><div class="two"><button class="wide" id="in-follow">따라가기</button></div><div class="hint">파란 선 = 남은 경로, 초록 기둥 = 출발지, 빨간 기둥 = 목적지</div>`;
      root.querySelector<HTMLElement>('#in-close')!.onclick = () => { sel = null; root.hidden = true; last = ''; clearOverlays(); onClose(); };
      root.querySelector<HTMLElement>('#in-follow')!.onclick = () => { following = !following; hooks.onFollow(following ? id : null); root.querySelector<HTMLElement>('#in-follow')!.textContent = following ? '따라가기 끄기' : '따라가기'; };
    }
    const m = v.meta, b = (bid?: number) => { const x = bid === undefined ? undefined : net.buildings.get(bid); return x ? `${BNAME[x.kind] ?? x.kind} (${Math.round(x.x)}, ${Math.round(x.y)})` : '(없어진 건물)'; };
    const set = (k: string, t: string) => { const e = root.querySelector<HTMLElement>(`[data-v="${k}"]`); if (e && e.textContent !== t) e.textContent = t; };
    set('type', m?.mode === 'truck' ? '화물 트럭' : '승용차');
    set('trip', m ? (m.mode === 'truck' ? '화물 배송' : TRIP[m.kind] ?? m.kind) : '-');
    set('from', m && m.kind !== 'test' ? b(m.from) : '-'); set('to', m && m.kind !== 'test' ? b(m.to) : '-');
    set('speed', `${(v.v * 3.6).toFixed(0)} km/h`);
    set('state', hooks.traffic.crashed.has(v.id) ? '사고로 멈춤' : v.reason || v.status || (v.v < 0.3 ? '정지' : '주행 중'));
    set('age', m ? `${Math.round(((hooks.traffic.tick - m.born) / cfg.tickRate) * K / 60)}분 (시계, 출발 대기 포함)` : '-');
    const pts = hooks.traffic.routePoints(v), o = m ? net.buildings.get(m.from) : undefined, d = m ? net.buildings.get(m.to) : undefined;
    hooks.onRoute(pts.length > 1 ? pts : null, o ?? null, d ?? null);
  }

  function render() {
    if (sel?.kind === 'veh') { renderVeh(sel.id); return; }
    let html = '';
    if (sel?.kind === 'seg') { const s = net.segments.get(sel.id); if (s) html = segHtml(s); }
    else if (sel?.kind === 'node') { if (net.nodes.has(sel.id) && net.segmentsAt(sel.id).length >= 3) html = nodeHtml(sel.id); }
    if (!html) { sel = null; root.hidden = true; last = ''; clearOverlays(); return; }
    root.hidden = false;
    if (html === last) return; // 바뀐 것이 없으면 다시 그리지 않는다(누르는 중인 버튼이 사라지지 않게)
    last = html;
    root.innerHTML = html;
    root.querySelector<HTMLElement>('#in-close')!.onclick = () => { sel = null; root.hidden = true; last = ''; clearOverlays(); onClose(); };
    const flowBtn = root.querySelector<HTMLElement>('#in-flow');
    if (flowBtn && sel?.kind === 'seg') { const id = sel.id; flowBtn.onclick = () => { flowSeg = flowSeg === id ? null : id; if (flowSeg === null) hooks.onFlows(null); last = ''; updateFlows(); render(); }; }
    const up = root.querySelector<HTMLElement>('#in-up');
    if (up && sel?.kind === 'seg') { const id = sel.id; up.onclick = () => onUpgrade(id, 'up'); }
    const down = root.querySelector<HTMLElement>('#in-down');
    if (down && sel?.kind === 'seg') { const id = sel.id; down.onclick = () => onUpgrade(id, 'down'); }
    if (sel?.kind === 'seg') {
      const id = sel.id;
      const nameOk = root.querySelector<HTMLElement>('#in-name-ok'), nameIn = root.querySelector<HTMLInputElement>('#in-name');
      if (nameOk && nameIn) nameOk.onclick = () => { const n = editor.setName(id, nameIn.value); say(nameIn.value.trim() ? `이름을 붙였습니다 (${n}구간)` : `이름을 지웠습니다 (${n}구간)`); };
      root.querySelectorAll<HTMLElement>('[data-ld]').forEach((b) => (b.onclick = () => {
        const [n, i, bit] = b.dataset.ld!.split(':').map(Number);
        const lanes = net.lanesIncoming(id, n), cur = net.laneDirsAt(id, n), m = Array.from({ length: lanes }, (_, k) => cur[k] || 7);
        m[i] ^= bit;
        if (m[i] === 0) { say('차선에는 방향이 하나 이상 있어야 합니다'); return; }
        editor.setLaneDirs(id, n, m.every((x) => x === 7) ? [] : m);
      }));
      root.querySelectorAll<HTMLElement>('[data-ld-reset]').forEach((b) => (b.onclick = () => { editor.setLaneDirs(id, Number(b.dataset.ldReset), []); }));
      root.querySelectorAll<HTMLElement>('[data-ld-auto]').forEach((b) => (b.onclick = () => {
        const lanes = net.lanesIncoming(id, Number(b.dataset.ldAuto));
        // 오른쪽 차선 = 직진+우회전, 가운데 = 직진, 왼쪽 차선 = 좌회전+직진
        const auto = lanes === 1 ? [] : lanes === 2 ? [6, 3] : [6, ...Array(lanes - 2).fill(2), 3];
        editor.setLaneDirs(id, Number(b.dataset.ldAuto), auto);
        say('차선 방향을 자동으로 배정했습니다');
      }));
    }
    root.querySelectorAll<HTMLElement>('[data-wave]').forEach((b) => (b.onclick = () => {
      if (sel?.kind !== 'seg') return;
      const r = editor.greenWave(sel.id, Number(b.dataset.wave), signals);
      say(r.ok ? `녹색파를 맞췄습니다 (교차로 ${r.linked ?? 2}곳 연속, 첫 구간 이동 ${r.travelSec.toFixed(0)}초)` : '두 교차로가 모두 고정식 신호여야 합니다');
    }));
    if (sel?.kind === 'node') {
      const id = sel.id;
      root.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => (b.onclick = () => {
        const m = b.dataset.mode!;
        if (m === 'off') editor.setSignal(id, false);
        else editor.setSignal(id, true, m === 'act' ? 'actuated' : 'fixed', 0);
      }));
      root.querySelectorAll<HTMLElement>('[data-g]').forEach((b) => (b.onclick = () => {
        const p = signals.program(id).map((x) => x.green);
        const i = Number(b.dataset.g);
        p[i] = Math.min(90, Math.max(5, p[i] + Number(b.dataset.d)));
        editor.setSignalProgram(id, { greens: p });
      }));
      const copy = root.querySelector<HTMLElement>('#in-copy'), paste = root.querySelector<HTMLElement>('#in-paste'), round = root.querySelector<HTMLElement>('#in-round');
      if (copy) copy.onclick = () => { clip = signals.copyProgram(id); last = ''; say('신호 프로그램을 복사했습니다. 다른 교차로를 눌러 붙여넣으세요'); render(); };
      if (paste) paste.onclick = () => { const r = clip ? editor.pasteSignal(id, clip, signals) : null; say(!r ? '' : !r.ok ? '교차로가 아닙니다' : r.applied ? '신호 프로그램을 붙여넣었습니다' : '방식만 붙여넣었습니다 (단계 수가 달라 녹색 시간은 복사하지 못했습니다)'); };
      if (round) round.onclick = () => { const r = editor.makeRoundabout(id); say(r.ok ? '회전교차로로 바꿨습니다' : r.error === 'tooShort' ? '연결된 도로가 짧아 만들 수 없습니다' : r.error === 'tooTight' ? '도로 사이 각도가 너무 좁습니다' : '가까이에 건물이 있어 만들 수 없습니다'); };
      root.querySelectorAll<HTMLElement>('[data-mv]').forEach((b) => (b.onclick = () => { // 단계 순서 바꾸기(녹색 시간도 같이 옮긴다)
        const [j, dir] = b.dataset.mv!.split(':').map(Number), p = signals.program(id), nn = net.nodes.get(id)!;
        const order = nn.sigOrder.length === p.length ? nn.sigOrder.slice() : p.map((_, k) => k), greens = p.map((x) => x.green), k = j + dir;
        if (k < 0 || k >= p.length) return;
        [order[j], order[k]] = [order[k], order[j]]; [greens[j], greens[k]] = [greens[k], greens[j]];
        editor.setSignalProgram(id, { order, greens });
      }));
      const off = root.querySelector<HTMLElement>('#in-off');
      if (off) off.onclick = () => { editor.setSignalProgram(id, { offset: 0 }); };
    }
  }

  // 이동 흐름: 선택한 도로를 지나는 차량들의 출발지 → 목적지(건물이 지워졌으면 건너뜀)
  function updateFlows() {
    if (flowSeg === null || sel?.kind !== 'seg') return;
    const lines: [{ x: number; y: number }, { x: number; y: number }][] = [];
    for (const v of hooks.traffic.vehiclesUsing(flowSeg)) {
      const a = v.meta ? net.buildings.get(v.meta.from) : undefined, b = v.meta ? net.buildings.get(v.meta.to) : undefined;
      if (a && b && v.meta!.kind !== 'test') lines.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]);
      if (lines.length >= 120) break;
    }
    hooks.onFlows(lines);
  }

  return {
    showVehicle(id: number) { clearOverlays(); sel = { kind: 'veh', id }; last = ''; render(); },
    showSegment(id: number | null) { if ((sel?.kind === 'seg' && sel.id !== id) || sel?.kind === 'veh') clearOverlays(); sel = id === null ? null : { kind: 'seg', id }; last = ''; render(); },
    showNode(id: number) { sel = { kind: 'node', id }; last = ''; render(); },
    update() { if (sel) { render(); updateFlows(); } },
  };
}
