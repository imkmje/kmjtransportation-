import land from '../data/land.json';
import { CITIES } from '../data';
import type { Game } from '../sim/game';

/** 세계 지도(등장방형도법) 캔버스: 이동·확대(핀치·휠), 도시·노선 누르기, 노선 위를 나는 작은 비행기 표시 */
export interface MapEvents { onCity(id: string | null): void; onRoute(id: number): void }

const LAT_MIN = -60, LAT_MAX = 80;

export function createMapView(canvas: HTMLCanvasElement, getGame: () => Game, ev: MapEvents) {
  const ctx = canvas.getContext('2d')!;
  let W = 0, H = 0, dpr = 1, resized = false;
  let scale = 3, cx = 100, cy = 25; // scale: 화면 px/도, (cx, cy): 화면 가운데의 경도·위도
  let selCity: string | null = null, selRoute: number | null = null;
  const toX = (lon: number) => W / 2 + (lon - cx) * scale, toY = (lat: number) => H / 2 - (lat - cy) * scale;
  const fitScale = () => Math.min(W / 360, H / (LAT_MAX - LAT_MIN));

  function clamp() {
    const lo = fitScale() * 0.9, hi = fitScale() * 9;
    scale = Math.min(hi, Math.max(lo, scale));
    cx = Math.min(200, Math.max(-200, cx)); cy = Math.min(85, Math.max(-65, cy));
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (!resized && W > 0) { scale = fitScale() * 1.15; cx = 95; cy = 22; resized = true; }
    clamp();
  }

  // 두 도시 사이를 날짜변경선을 넘지 않는 가까운 쪽으로 이어 그린다(양쪽 복사본을 그려 경계에서 잘려도 이어 보이게)
  function arcSegments(a: { lat: number; lon: number }, b: { lat: number; lon: number }): [number, number, number, number][] {
    let bl = b.lon; if (bl - a.lon > 180) bl -= 360; else if (bl - a.lon < -180) bl += 360;
    return [0, -360, 360].map((shift) => [toX(a.lon + shift), toY(a.lat), toX(bl + shift), toY(b.lat)] as [number, number, number, number]);
  }
  const ctrl = (x1: number, y1: number, x2: number, y2: number): [number, number] => [(x1 + x2) / 2, (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.12]; // 위로 살짝 휜 호
  const cityOf = (id: string) => CITIES.find((c) => c.id === id)!;

  function draw(now: number) {
    const g = getGame();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const grd = ctx.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#cfe6f5'); grd.addColorStop(1, '#a9d0ea');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let lon = -360; lon <= 360; lon += 30) { const x = toX(lon); ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let lat = -60; lat <= 80; lat += 30) { const y = toY(lat); ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.fillStyle = '#e9f0d6'; ctx.strokeStyle = '#b9c9a0'; ctx.lineWidth = 1;
    for (const shift of [-360, 0, 360]) {
      for (const ring of land as number[][][]) {
        ctx.beginPath();
        ring.forEach(([lon, lat], i) => { const x = toX(lon + shift), y = toY(lat); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    // 경쟁사 노선(보라색 가는 선)
    ctx.strokeStyle = 'rgba(138, 92, 196, 0.55)'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 4]);
    for (const k of g.state.competitors) for (const cr of k.routes) for (const [x1, y1, x2, y2] of arcSegments(cityOf(cr.a), cityOf(cr.b))) { const [mx, my] = ctrl(x1, y1, x2, y2); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke(); }
    ctx.setLineDash([]);
    // 노선: 이익이면 초록, 적자면 빨강, 항공기가 없으면 회색 점선
    for (const r of g.state.routes) {
      if (!r.open) continue;
      const A = cityOf(r.a), B = cityOf(r.b), d = g.routeDay(r), profit = d.revenue - d.cost, planes = g.planesOn(r.id).length, served = planes > 0;
      const color = !served ? '#8a96a3' : profit >= 0 ? '#2f9e5b' : '#d64545';
      ctx.strokeStyle = color; ctx.lineWidth = r.id === selRoute ? 5 : served ? 2 + Math.min(3, d.pax / 800) : 1.5;
      ctx.setLineDash(served ? [] : [6, 5]);
      for (const [x1, y1, x2, y2] of arcSegments(A, B)) {
        const [mx, my] = ctrl(x1, y1, x2, y2);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
      }
      ctx.setLineDash([]);
      if (served) for (const [x1, y1, x2, y2] of arcSegments(A, B)) {
        const [mx, my] = ctrl(x1, y1, x2, y2);
        for (let k = 0; k < Math.min(3, planes); k++) { // 비행기 점(장식)
          const t = (now / 4000 + k / 3) % 1, u = 1 - t, px = u * u * x1 + 2 * u * t * mx + t * t * x2, py = u * u * y1 + 2 * u * t * my + t * t * y2;
          ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#2b3a49'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(px, py, 3.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
    }
    // 도시: 운항 중이면 노란색, 선택하면 주황 테두리
    ctx.font = '600 12px system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'; ctx.textBaseline = 'middle';
    for (const c of CITIES) {
      const connected = g.state.routes.some((r) => r.open && (r.a === c.id || r.b === c.id) && g.planesOn(r.id).length > 0);
      for (const shift of [-360, 0, 360]) {
        const x = toX(c.lon + shift), y = toY(c.lat);
        if (x < -40 || x > W + 40) continue;
        const sel = c.id === selCity;
        ctx.fillStyle = connected ? '#ffd86b' : '#ffffff'; ctx.strokeStyle = sel ? '#e8793a' : '#2b3a49'; ctx.lineWidth = sel ? 4 : 2;
        ctx.beginPath(); ctx.arc(x, y, c.base ? 8 : 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#16212c'; ctx.shadowColor = 'rgba(255,255,255,0.9)'; ctx.shadowBlur = 4;
        const lb = c.label ?? { dx: 11, dy: -1 };
        ctx.textAlign = lb.align === 'right' ? 'right' : 'left'; ctx.fillText(c.name, x + lb.dx, y + lb.dy); ctx.textAlign = 'left'; ctx.shadowBlur = 0;
      }
    }
  }

  // ---- 입력: 한 손가락 이동, 두 손가락 확대, 휠, 탭 ----
  const ptrs = new Map<number, { x: number; y: number }>();
  let tapStart: { x: number; y: number; t: number } | null = null, pinch = 0, moved = 0;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (ptrs.size === 1) { tapStart = { x: e.offsetX, y: e.offsetY, t: performance.now() }; moved = 0; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); tapStart = null; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
    p.x = e.offsetX; p.y = e.offsetY;
    if (ptrs.size === 1) { cx -= dx / scale; cy += dy / scale; moved += Math.abs(dx) + Math.abs(dy); clamp(); }
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch > 0) { scale *= d / pinch; clamp(); } pinch = d; }
  });
  const end = (e: PointerEvent) => {
    const had = ptrs.has(e.pointerId); ptrs.delete(e.pointerId);
    if (had && ptrs.size === 0 && tapStart && moved < 8 && performance.now() - tapStart.t < 500) tap(tapStart.x, tapStart.y);
    if (ptrs.size < 2) pinch = 0;
  };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const lon = cx + (e.offsetX - W / 2) / scale, lat = cy - (e.offsetY - H / 2) / scale;
    scale *= Math.exp(-e.deltaY * 0.0015); clamp();
    cx = lon - (e.offsetX - W / 2) / scale; cy = lat + (e.offsetY - H / 2) / scale; clamp();
  }, { passive: false });

  function tap(x: number, y: number) {
    let best: { id: string; d: number } | null = null;
    for (const c of CITIES) for (const shift of [-360, 0, 360]) {
      const d = Math.hypot(toX(c.lon + shift) - x, toY(c.lat) - y);
      if (d < 26 && (!best || d < best.d)) best = { id: c.id, d };
    }
    if (best) { ev.onCity(best.id); return; }
    for (const r of getGame().state.routes) { // 노선 선 근처를 누르면 그 노선
      if (!r.open) continue;
      for (const [x1, y1, x2, y2] of arcSegments(cityOf(r.a), cityOf(r.b))) {
        const [mx, my] = ctrl(x1, y1, x2, y2);
        for (let t = 0; t <= 1; t += 0.05) { const u = 1 - t, px = u * u * x1 + 2 * u * t * mx + t * t * x2, py = u * u * y1 + 2 * u * t * my + t * t * y2; if (Math.hypot(px - x, py - y) < 12) { ev.onRoute(r.id); return; } }
      }
    }
    ev.onCity(null);
  }

  let raf = 0;
  const loop = (now: number) => { draw(now); raf = requestAnimationFrame(loop); };
  new ResizeObserver(resize).observe(canvas);
  resize();
  raf = requestAnimationFrame(loop);

  return {
    select(city: string | null, route: number | null) { selCity = city; selRoute = route; },
    focusCity(id: string) { const c = CITIES.find((x) => x.id === id); if (c) { cx = c.lon; cy = c.lat; clamp(); } },
    /** 도시의 화면 좌표(점검용) */
    screenOf(id: string): { x: number; y: number } | null { const c = CITIES.find((x) => x.id === id); if (!c) return null; const r = canvas.getBoundingClientRect(); return { x: r.left + toX(c.lon), y: r.top + toY(c.lat) }; },
    stop() { cancelAnimationFrame(raf); },
  };
}
