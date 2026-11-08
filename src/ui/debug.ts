import type { Pt } from '../sim/network';
import type { Sim } from '../sim/sim';

interface Deps {
  panel: HTMLElement;
  labels: HTMLElement;
  sim: Sim;
  project: (p: Pt) => { x: number; y: number };
}

// 디버그 표시: 숫자 패널(FPS·차량 수·안전망) + 차선 ID 라벨 + 차량 상태 라벨
export function createDebug(d: Deps) {
  let on = false;
  let frame = 0;
  const pool: HTMLElement[] = [];
  const LANE_MAX = 50, VEH_MAX = 30;

  function label(i: number): HTMLElement {
    if (!pool[i]) { const e = document.createElement('div'); e.className = 'lbl'; d.labels.appendChild(e); pool[i] = e; }
    return pool[i];
  }

  function hideAll() { d.labels.replaceChildren(); pool.length = 0; }

  return {
    get on() { return on; },
    set(v: boolean) { on = v; d.panel.hidden = !v; if (!v) hideAll(); },
    /** 매 프레임 호출. 무거운 부분은 몇 프레임에 한 번만 갱신한다 */
    update(fps: number) {
      if (!on || ++frame % 6 !== 0) return;
      const t = d.sim.traffic, s = t.stats;
      d.panel.textContent =
        `FPS ${fps.toFixed(0)}   tick ${d.sim.tickCount}\n` +
        `차량 ${t.vehicles.size}   트랙 ${t.graph.tracks.length}\n` +
        `투입 ${s.spawned} / 도착 ${s.arrived} / 포기 ${s.abandoned} / 경로없음 ${s.noRoute}\n` +
        `안전망 개입 ${s.interventions}   충돌점유 ${s.conflicts}\n` +
        `차선변경 ${s.laneChanges}   교착해소 ${s.deadlocks} / 제거 ${s.removed}`;

      const cx = innerWidth / 2, cy = innerHeight / 2;
      const items: { x: number; y: number; text: string; cls: string; d: number }[] = [];
      const add = (p: Pt, text: string, cls: string, bucket: typeof items) => {
        const q = d.project(p);
        if (q.x < 0 || q.y < 0 || q.x > innerWidth || q.y > innerHeight) return;
        bucket.push({ x: q.x, y: q.y, text, cls, d: Math.hypot(q.x - cx, q.y - cy) });
      };
      const lanes: typeof items = [], vehs: typeof items = [];
      for (const tr of t.graph.tracks) {
        if (tr.kind !== 'lane') continue;
        const a = tr.pts[0], b = tr.pts[1];
        add({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, `L${tr.id}`, 'lane', lanes);
      }
      for (const v of t.vehicles.values()) add(v, `#${v.id} ${v.status || '주행'} ${(v.v * 3.6).toFixed(0)}km/h`, 'veh', vehs);
      const pick = [...lanes.sort((x, y) => x.d - y.d).slice(0, LANE_MAX), ...vehs.sort((x, y) => x.d - y.d).slice(0, VEH_MAX)];
      pick.forEach((it, i) => {
        const e = label(i);
        e.textContent = it.text;
        e.className = `lbl ${it.cls}`;
        e.style.left = `${it.x}px`;
        e.style.top = `${it.y}px`;
      });
      for (let i = pick.length; i < pool.length; i++) pool[i].remove();
      pool.length = Math.min(pool.length, pick.length);
    },
  };
}
