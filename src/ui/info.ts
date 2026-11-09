import type { Config } from '../config';
import type { Editor } from '../sim/editor';
import { ciGrade, type Metrics } from '../sim/metrics';
import type { Segment } from '../sim/network';
import type { Signals } from '../sim/signals';

const SIGN = { stop: '정지 표지', yield: '양보 표지' } as const;
const RES = { noLeft: '좌회전 금지', noEntry: '진입 금지' } as const;

type Sel = { kind: 'seg'; id: number } | { kind: 'node'; id: number } | null;

/**
 * 정보 창: 도로를 클릭하면 종류·제한속도·통과 차량·정체 지수·양 끝의 제어를, 교차로를 클릭하면 신호 방식과 단계별 녹색 시간을 보여 준다.
 * 신호 편집(방식 고르기, 녹색 시간 늘리고 줄이기, 녹색파 맞추기)도 여기서 한다
 */
export function createInfo(root: HTMLElement, cfg: Config, editor: Editor, metrics: Metrics, signals: Signals, say: (t: string) => void, onClose: () => void, onUpgrade: (segId: number) => void) {
  const net = editor.network;
  let sel: Sel = null;
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

  function segHtml(s: Segment): string {
    const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!, r = cfg.roads[s.kind];
    const rep = metrics.segmentReport().get(s.id);
    const ci = rep?.ci ?? null;
    const wave = net.hasSignal(s.a) && net.hasSignal(s.b) && !net.isActuated(s.a) && !net.isActuated(s.b);
    return `
      <h4>도로 정보 <button id="in-close" title="닫기">✕</button></h4>
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
      ${s.kind === 'road2' && net.upgradeChain(s.id).length ? '<button class="wide" id="in-up">왕복 4차로로 넓히기</button>' : ''}
      ${wave ? `<div class="sub-h">녹색파 (고정식 신호끼리)</div><button class="wide" data-wave="${s.a}">(${Math.round(a.x)}, ${Math.round(a.y)}) → (${Math.round(b.x)}, ${Math.round(b.y)}) 방향으로 맞추기</button><button class="wide" data-wave="${s.b}">(${Math.round(b.x)}, ${Math.round(b.y)}) → (${Math.round(a.x)}, ${Math.round(a.y)}) 방향으로 맞추기</button>` : ''}`;
  }

  function nodeHtml(id: number): string {
    const n = net.nodes.get(id)!;
    const on = net.hasSignal(id), act = net.isActuated(id);
    const mode = !on ? 'off' : act ? 'act' : 'fix';
    const seg = (m: string, t: string) => `<button data-mode="${m}" class="${mode === m ? 'on' : ''}">${t}</button>`;
    let prog = '';
    if (on && !act) {
      const p = signals.program(id), cyc = p.reduce((t, x) => t + x.green + cfg.signals.yellowSec + cfg.signals.allRedSec, 0);
      prog = `<div class="sub-h">단계별 녹색 시간 (주기 ${Math.round(cyc)}초 · 시차 ${Math.round(n.sigOffset)}초)</div>` + p.map((x, i) => `<div class="ph"><span>${i + 1}단계 ${axis(id, x.segs)}</span><button data-g="${i}" data-d="-5">−</button><b>${Math.round(x.green)}초</b><button data-g="${i}" data-d="5">＋</button></div>`).join('') + (n.sigOffset ? '<button class="wide" id="in-off">시차 없애기</button>' : '');
    } else if (act) {
      prog = `<div class="sub-h">감응식: 차가 오는 방향에 녹색 ${cfg.signals.minGreenSec}~${cfg.signals.maxGreenSec}초(큰 도로는 2배), 차가 없으면 넘깁니다</div>`;
    }
    return `
      <h4>교차로 정보 <button id="in-close" title="닫기">✕</button></h4>
      <div class="kv"><div>위치</div><div>(${Math.round(n.x)}, ${Math.round(n.y)})</div><div>연결 도로</div><div>${net.segmentsAt(id).length}개</div></div>
      <div class="sub-h">신호등</div><div class="seg3">${seg('off', '없음')}${seg('fix', '고정식')}${seg('act', '감응식')}</div>${prog}`;
  }

  function render() {
    let html = '';
    if (sel?.kind === 'seg') { const s = net.segments.get(sel.id); if (s) html = segHtml(s); }
    else if (sel?.kind === 'node') { if (net.nodes.has(sel.id) && net.segmentsAt(sel.id).length >= 3) html = nodeHtml(sel.id); }
    if (!html) { sel = null; root.hidden = true; last = ''; return; }
    root.hidden = false;
    if (html === last) return; // 바뀐 것이 없으면 다시 그리지 않는다(누르는 중인 버튼이 사라지지 않게)
    last = html;
    root.innerHTML = html;
    root.querySelector<HTMLElement>('#in-close')!.onclick = () => { sel = null; root.hidden = true; last = ''; onClose(); };
    const up = root.querySelector<HTMLElement>('#in-up');
    if (up && sel?.kind === 'seg') { const id = sel.id; up.onclick = () => onUpgrade(id); }
    root.querySelectorAll<HTMLElement>('[data-wave]').forEach((b) => (b.onclick = () => {
      if (sel?.kind !== 'seg') return;
      const r = editor.greenWave(sel.id, Number(b.dataset.wave), signals);
      say(r.ok ? `녹색파를 맞췄습니다 (이동 ${r.travelSec.toFixed(0)}초, 반대쪽 시차 ${r.offset.toFixed(0)}초)` : '두 교차로가 모두 고정식 신호여야 합니다');
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
      const off = root.querySelector<HTMLElement>('#in-off');
      if (off) off.onclick = () => { editor.setSignalProgram(id, { offset: 0 }); };
    }
  }

  return {
    showSegment(id: number | null) { sel = id === null ? null : { kind: 'seg', id }; last = ''; render(); },
    showNode(id: number) { sel = { kind: 'node', id }; last = ''; render(); },
    update() { if (sel) render(); },
  };
}
