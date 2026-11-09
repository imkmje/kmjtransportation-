import { CI_GRADES, ciGrade } from '../sim/metrics';
import type { Sim } from '../sim/sim';
import type { Network } from '../sim/network';

const GRADE_COLORS = ['#3a9d5a', '#7fae3a', '#d98a1f', '#d65a2a', '#b3302a'];

// 오른쪽 통계 패널: 정체 지수(등급·게이지), 완료율, 평균 통행시간, 처리량, 차량 수, 안전·교착, 하루 그래프
export function createStats(root: HTMLElement, sim: Sim, net: Network, getUnconnected: () => number, rciRoot: HTMLElement, topCi: HTMLElement, onPick: (segId: number) => void) {
  rciRoot.innerHTML = `
    <div class="rb" title="주거 저밀 수요"><span><i id="st-dh"></i></span><em>저밀</em></div>
    <div class="rb" title="주거 중밀 수요"><span><i id="st-dm"></i></span><em>중밀</em></div>
    <div class="rb" title="주거 고밀 수요"><span><i id="st-dg"></i></span><em>고밀</em></div>
    <div class="rb" title="상업 수요"><span><i id="st-ds"></i></span><em>상업</em></div>
    <div class="rb" title="사무 수요"><span><i id="st-do"></i></span><em>사무</em></div>
    <div class="rb" title="산업 수요"><span><i id="st-di"></i></span><em>산업</em></div>
    <div class="rb" title="혼합 용도(상가주택) 수요"><span><i id="st-dx"></i></span><em>혼합</em></div>`;
  root.innerHTML = `
    <h4 id="st-head">교통 현황 <span style="font-weight:400">(최근 시뮬 2.5분)</span> <em>▾</em></h4><div id="st-body">
    <div class="ci"><b id="st-ci">-</b><span id="st-grade"></span></div>
    <div class="gauge"><i id="st-mark" style="left:0"></i></div>

    <div class="kv">
      <div>완료율 (오늘)</div><div id="st-comp">-</div>
      <div>평균 통행시간</div><div id="st-avg">-</div>
      <div>처리량 (시계 1시간)</div><div id="st-thr">0대</div>
      <div>주행 중 / 출발 대기</div><div id="st-live">0 / 0</div>
      <div>귀환 대기(직장)</div><div id="st-pool">0명</div>
      <div>교착 해소 · 안전망 개입</div><div id="st-safe">0 · 0</div>
      <div>일자리 부족 · 미연결 건물</div><div id="st-warn">0 · 0</div>
      <div>사고 · 날씨</div><div id="st-wx">0건 · 맑음</div>
    </div>
 <h4 class="top-h">막히는 곳 TOP 5 <span style="font-weight:400">(누르면 이동)</span></h4>
    <ol id="st-top"></ol>
    <svg id="st-chart" width="236" height="64" viewBox="0 0 236 64"></svg>
    <div id="st-yesterday" class="yday"></div></div>`;
  root.querySelector<HTMLElement>('#st-head')!.onclick = () => root.classList.toggle('closed'); // 머리글을 누르면 접고 편다
  const $ = (id: string) => document.getElementById(id)!;
  const el = { ci: $('st-ci'), grade: $('st-grade'), mark: $('st-mark'), dh: $('st-dh'), dof: $('st-do'), dsh: $('st-ds'), dmid: $('st-dm'), dhigh: $('st-dg'), dind: $('st-di'), dmix: $('st-dx'), comp: $('st-comp'), avg: $('st-avg'), thr: $('st-thr'), live: $('st-live'), pool: $('st-pool'), safe: $('st-safe'), warn: $('st-warn'), wx: $('st-wx'), chart: $('st-chart'), yday: $('st-yesterday') };
  const topEl = $('st-top');
  let lastTop = '';
  topEl.onclick = (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-seg]'); if (li) onPick(Number(li.dataset.seg)); };
  const num = (n: number | null, d = 0, unit = '') => (n === null ? '-' : `${n.toFixed(d)}${unit}`);

  return {
    update() {
      const m = sim.metrics, t = sim.traffic, dm = sim.demand;
      const ci = m.rollingCI();
      el.ci.textContent = num(ci);
      topCi.textContent = `정체 ${num(ci)} ${ciGrade(ci)}`;
      topCi.style.background = ci === null ? '#55655a' : GRADE_COLORS[CI_GRADES.findIndex((g) => g.name === ciGrade(ci))];
      const grade = ciGrade(ci);
      el.grade.textContent = grade;
      el.grade.style.color = ci === null ? '#55655a' : GRADE_COLORS[CI_GRADES.findIndex((g) => g.name === grade)];
      el.mark.style.left = `${ci === null ? 0 : Math.min(100, ci)}%`;
      const bars = sim.growth.bars();
      el.dh.style.height = `${bars.home}%`;
      el.dmid.style.height = `${bars.homeMid}%`;
      el.dhigh.style.height = `${bars.homeHigh}%`;
      el.dind.style.height = `${bars.industrial}%`;
      el.dmix.style.height = `${bars.mixed}%`;
      el.dof.style.height = `${bars.office}%`;
      el.dsh.style.height = `${bars.shop}%`;
      const completion = m.completion();
      el.comp.textContent = completion === null ? '-' : `${completion.toFixed(0)}% (진행 중 ${dm.inFlight()})`;
      el.avg.textContent = num(m.avgTravelMin(), 0, '분');
      el.thr.textContent = `${m.throughput(sim.tickCount)}대`;
      el.live.textContent = `${t.vehicles.size} / ${t.jobs.length}`;
      el.pool.textContent = `${dm.poolSize()}명`;
      el.safe.textContent = `${t.stats.deadlocks} · ${t.stats.interventions}`;
      const unc = getUnconnected();
      el.warn.textContent = `${dm.unemployed} · ${unc}`;
      el.wx.textContent = `${t.stats.accidents}건${t.crashed.size ? ` (진행 중 ${t.crashed.size})` : ''} · ${!t.eventsOn ? '꺼짐' : sim.raining ? '비' : '맑음'}`;
      el.warn.style.color = unc > 0 ? '#c0392b' : '';
      // 오늘 롤링 CI 그래프(10초 단위 기록)
      const s = m.ciSeries;
      const W = 224, H = 50, x0 = 6, y0 = 8;
      const pts = s.map((v, i) => (v === null ? null : `${(x0 + (i / Math.max(1, 360 - 1)) * W).toFixed(1)},${(y0 + H - (Math.min(100, v) / 100) * H).toFixed(1)}`)).filter((p): p is string => p !== null);
      el.chart.innerHTML =
        `<rect width="236" height="64" rx="6" fill="#eef4ee"/>` +
        [10, 25, 40].map((v) => `<line x1="0" x2="236" y1="${y0 + H - (v / 100) * H}" y2="${y0 + H - (v / 100) * H}" stroke="#cfd9cf" stroke-dasharray="3 3"/>`).join('') +
        (pts.length > 1 ? `<polyline fill="none" stroke="#e8743a" stroke-width="2" points="${pts.join(' ')}"/>` : '') +
        `<text x="6" y="11" font-size="9" fill="#55655a">정체 지수 · 오늘</text>`;
      // 막히는 곳 TOP 5: 최근 윈도우의 손실 거리가 큰 도로(정체 지수 25 이상, 통과 차량이 충분한 곳)
      const top = [...m.segmentReport()].filter(([id, r]) => net.segments.has(id) && r.ci !== null && r.ci >= 25).sort((a, b) => b[1].loss - a[1].loss).slice(0, 5);
      const key = top.map(([id, r]) => `${id}:${Math.round(r.ci!)}:${r.passes}`).join('|');
      if (key !== lastTop) {
        lastTop = key;
        topEl.innerHTML = top.length ? top.map(([id, r]) => { const s = net.segments.get(id)!, a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!; return `<li data-seg="${id}"><b>${s.name ? s.name.replace(/</g, '&lt;') : `${Math.round((a.x + b.x) / 2)}, ${Math.round((a.y + b.y) / 2)}`}</b> 정체 ${Math.round(r.ci!)} <small>· ${r.passes}대</small></li>`; }).join('') : '<li class="none">막히는 곳이 없습니다</li>';
      }
      const y = m.history[m.history.length - 1];
      el.yday.textContent = y ? `어제(${y.day}일차): 완료율 ${num(y.completion, 0, '%')} · CI ${num(y.ci, 0)} · 평균 ${num(y.avgTravelMin, 0, '분')}` : '';
    },
  };
}
