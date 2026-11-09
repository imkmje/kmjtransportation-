import type { Config } from '../config';
import { ciGrade, type Metrics } from '../sim/metrics';
import type { Network, Segment } from '../sim/network';

const SIGN = { stop: '정지 표지', yield: '양보 표지' } as const;
const RES = { noLeft: '좌회전 금지', noEntry: '진입 금지' } as const;

/** 도로 정보 창: 도로를 클릭하면 종류·제한속도·통과 차량·정체 지수와 양 끝의 제어(표지·신호·제한)를 보여 준다 */
export function createInfo(root: HTMLElement, cfg: Config, net: Network, metrics: Metrics, onClose: () => void, onUpgrade: (segId: number) => void) {
  let seg: number | null = null;
  let last = '';
  root.hidden = true;

  function endText(s: Segment, nodeId: number): string {
    const parts: string[] = [];
    if (net.hasSignal(nodeId)) parts.push(net.isActuated(nodeId) ? '감응식 신호' : '고정식 신호');
    const sign = net.signAt(s.id, nodeId);
    if (sign && !net.hasSignal(nodeId)) parts.push(SIGN[sign]);
    const res = net.restrictAt(s.id, nodeId);
    if (res) parts.push(RES[res]);
    return parts.join(', ') || '제어 없음';
  }

  function render() {
    const s = seg === null ? undefined : net.segments.get(seg);
    if (!s) { seg = null; root.hidden = true; return; }
    const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!, r = cfg.roads[s.kind];
    const rep = metrics.segmentReport().get(s.id);
    const ci = rep?.ci ?? null;
    root.hidden = false;
    const html = `
      <h4>도로 정보 <button id="in-close" title="닫기">✕</button></h4>
      <div class="kv">
        <div>종류</div><div>${r.name}${s.locked ? ' (철거 불가)' : ''}</div>
        <div>길이</div><div>${Math.round(net.segmentLength(s))} m</div>
        <div>제한속도</div><div>${s.playerSpeedKmh ?? r.defaultSpeedKmh} km/h${s.playerSpeedKmh === null ? ' (기본)' : ''}</div>
        <div>최근 통과 차량</div><div>${rep?.passes ?? 0}대 <small>(시뮬 ${cfg.metrics.windowSec / 60}분)</small></div>
        <div>정체 지수</div><div>${ci === null ? '판정 없음 (통과 적음)' : `${ci.toFixed(0)} · ${ciGrade(ci)}`}</div>
        <div>한쪽 끝 (${Math.round(a.x)}, ${Math.round(a.y)})</div><div>${endText(s, s.a)}</div>
        <div>반대쪽 끝 (${Math.round(b.x)}, ${Math.round(b.y)})</div><div>${endText(s, s.b)}</div>
      </div>
      ${s.kind === 'road2' && net.upgradeChain(s.id).length ? '<button id="in-up">왕복 4차로로 넓히기</button>' : ''}`;
    if (html === last) return; // 바뀐 것이 없으면 다시 그리지 않는다(누르는 중인 버튼이 사라지지 않게)
    last = html;
    root.innerHTML = html;
    root.querySelector<HTMLElement>('#in-close')!.onclick = () => { seg = null; root.hidden = true; onClose(); };
    const up = root.querySelector<HTMLElement>('#in-up');
    if (up) up.onclick = () => onUpgrade(s.id);
  }

  return {
    show(id: number | null) { seg = id; last = ''; render(); },
    get segId() { return seg; },
    update() { if (seg !== null) render(); },
  };
}
