import { CI_GRADES, ciGrade } from '../sim/metrics';
import type { Sim } from '../sim/sim';

const GRADE_COLORS = ['#3a9d5a', '#7fae3a', '#d98a1f', '#d65a2a', '#b3302a'];

// 오른쪽 통계 패널: 정체 지수(등급·게이지), 완료율, 평균 통행시간, 처리량, 차량 수, 안전·교착, 하루 그래프
export function createStats(root: HTMLElement, sim: Sim, getUnconnected: () => number) {
  root.innerHTML = `
    <h4>교통 현황 <span style="font-weight:400">(최근 시뮬 2.5분)</span></h4>
    <div class="ci"><b id="st-ci">-</b><span id="st-grade"></span></div>
    <div class="gauge"><i id="st-mark" style="left:0"></i></div>
    <div class="dem"><div>주거 수요<span><i id="st-dh"></i></span></div><div>직장 수요<span><i id="st-do"></i></span></div></div>
    <div class="kv">
      <div>완료율 (오늘)</div><div id="st-comp">-</div>
      <div>평균 통행시간</div><div id="st-avg">-</div>
      <div>처리량 (시계 1시간)</div><div id="st-thr">0대</div>
      <div>주행 중 / 출발 대기</div><div id="st-live">0 / 0</div>
      <div>귀환 대기(직장)</div><div id="st-pool">0명</div>
      <div>교착 해소 · 안전망 개입</div><div id="st-safe">0 · 0</div>
      <div>일자리 부족 · 미연결 건물</div><div id="st-warn">0 · 0</div>
    </div>
    <svg id="st-chart" width="236" height="64" viewBox="0 0 236 64"></svg>
    <div id="st-yesterday" class="yday"></div>`;
  const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  const el = { ci: $('st-ci'), grade: $('st-grade'), mark: $('st-mark'), dh: $('st-dh'), dof: $('st-do'), comp: $('st-comp'), avg: $('st-avg'), thr: $('st-thr'), live: $('st-live'), pool: $('st-pool'), safe: $('st-safe'), warn: $('st-warn'), chart: $('st-chart'), yday: $('st-yesterday') };
  const num = (n: number | null, d = 0, unit = '') => (n === null ? '-' : `${n.toFixed(d)}${unit}`);

  return {
    update() {
      const m = sim.metrics, t = sim.traffic, dm = sim.demand;
      const ci = m.rollingCI();
      el.ci.textContent = num(ci);
      const grade = ciGrade(ci);
      el.grade.textContent = grade;
      el.grade.style.color = ci === null ? '#55655a' : GRADE_COLORS[CI_GRADES.findIndex((g) => g.name === grade)];
      el.mark.style.left = `${ci === null ? 0 : Math.min(100, ci)}%`;
      const bars = sim.growth.bars();
      el.dh.style.width = `${bars.home}%`;
      el.dof.style.width = `${bars.office}%`;
      const completion = m.completion();
      el.comp.textContent = completion === null ? '-' : `${completion.toFixed(0)}% (진행 중 ${dm.inFlight()})`;
      el.avg.textContent = num(m.avgTravelMin(), 0, '분');
      el.thr.textContent = `${m.throughput(sim.tickCount)}대`;
      el.live.textContent = `${t.vehicles.size} / ${t.jobs.length}`;
      el.pool.textContent = `${dm.poolSize()}명`;
      el.safe.textContent = `${t.stats.deadlocks} · ${t.stats.interventions}`;
      const unc = getUnconnected();
      el.warn.textContent = `${dm.unemployed} · ${unc}`;
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
      const y = m.history[m.history.length - 1];
      el.yday.textContent = y ? `어제(${y.day}일차): 완료율 ${num(y.completion, 0, '%')} · CI ${num(y.ci, 0)} · 평균 ${num(y.avgTravelMin, 0, '분')}` : '';
    },
  };
}
