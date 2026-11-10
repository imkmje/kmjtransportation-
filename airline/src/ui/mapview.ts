import land from '../data/land.json';
import { CITIES } from '../data';
import type { Game } from '../sim/game';
import { placeLabels, type LabelItem } from './labels';
import { marketSize } from '../sim/model';
import { config } from '../config';
import { subsolar, terminatorLat } from '../sim/report';

/** 세계 지도(등장방형도법) 캔버스: 이동·확대(핀치·휠), 도시·노선 누르기, 노선 위를 나는 작은 비행기 표시 */
export interface MapEvents { onCity(id: string | null): void; onRoute(id: number): void }

const LAT_MIN = -60, LAT_MAX = 80;

export function createMapView(canvas: HTMLCanvasElement, getGame: () => Game, ev: MapEvents) {
  const ctx = canvas.getContext('2d')!;
  let W = 0, H = 0, dpr = 1, resized = false;
  let scale = 3, cx = 100, cy = 25; // scale: 화면 px/도, (cx, cy): 화면 가운데의 경도·위도
  let selCity: string | null = null, selRoute: number | null = null, pulseCity: string | null = null;
  const widths = new Map<string, number>();
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
    // 세계 낮밤(장식): 해가 있는 곳의 반대편을 어둡게 칠한다. 게임 날짜에 따라 움직인다
    if (nightOn) { const sun = subsolar(g.state.day, (now / 3000) % 1), south = sun.lat >= 0; // south: 밤이 경계선 아래(남쪽)쪽인가
      ctx.fillStyle = 'rgba(14, 24, 60, 0.2)';
      for (const shift of [-360, 0, 360]) {
        ctx.beginPath();
        for (let lon = -180; lon <= 180; lon += 3) { const x = toX(lon + shift), y = toY(terminatorLat(lon, sun)); if (lon === -180) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.lineTo(toX(180 + shift), toY(south ? -90 : 90)); ctx.lineTo(toX(-180 + shift), toY(south ? -90 : 90)); ctx.closePath(); ctx.fill();
      } }
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
      if (served && r.id === selRoute) { // 선택한 노선: 곡선 가운데에 월 이익 표시
        const [x1, y1, x2, y2] = arcSegments(A, B)[0], [mx, my] = ctrl(x1, y1, x2, y2), lx = 0.25 * x1 + 0.5 * mx + 0.25 * x2, ly = 0.25 * y1 + 0.5 * my + 0.25 * y2;
        const txt = `월 ${profit >= 0 ? '+' : '−'}$${Math.abs(profit * config.daysPerMonth).toFixed(1)}M`;
        ctx.font = '700 12px system-ui, sans-serif'; const tw = ctx.measureText(txt).width + 12;
        ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(lx - tw / 2, ly - 22, tw, 18, 9); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, lx, ly - 13);
      }
      if (served) for (const [x1, y1, x2, y2] of arcSegments(A, B)) {
        const [mx, my] = ctrl(x1, y1, x2, y2);
        for (let k = 0; k < Math.min(3, planes); k++) { // 비행기 점(장식)
          const t = (now / 4000 + k / 3) % 1, u = 1 - t, px = u * u * x1 + 2 * u * t * mx + t * t * x2, py = u * u * y1 + 2 * u * t * my + t * t * y2;
          const tx = 2 * u * (mx - x1) + 2 * t * (x2 - mx), ty = 2 * u * (my - y1) + 2 * t * (y2 - my), ang = Math.atan2(ty, tx); // 진행 방향
          ctx.save(); ctx.translate(px, py); ctx.rotate(ang); ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#2b3a49'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, 3.6); ctx.lineTo(-2, 0); ctx.lineTo(-4, -3.6); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
        }
      }
    }
    // 도시: 운항 중이면 노란색, 선택하면 주황 테두리. 이름은 겹치지 않는 자리에 놓고, 자리가 없으면 중요하지 않은 도시의 이름은 숨긴다(확대하면 나타남)
    ctx.font = '600 12px system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'; ctx.textBaseline = 'middle';
    const connectedOf = (id: string) => g.state.routes.some((r) => r.open && (r.a === id || r.b === id) && g.planesOn(r.id).length > 0);
    const items: LabelItem[] = [];
    for (const c of CITIES) for (const shift of [-360, 0, 360]) {
      const x = toX(c.lon + shift), y = toY(c.lat);
      if (x < -40 || x > W + 40 || y < -20 || y > H + 20) continue;
      if (!widths.has(c.name)) widths.set(c.name, ctx.measureText(c.name).width + 4);
      items.push({ id: `${c.id}@${shift}`, x, y, w: widths.get(c.name)!, h: 14, priority: marketSize(c) + (connectedOf(c.id) ? 100 : 0) + (c.id === g.state.base ? 200 : 0), force: c.id === selCity || c.id === g.state.base, pref: c.label });
    }
    const placed = placeLabels(items, { w: W, h: H });
    const t = now / 1000;
    for (const it of items) {
      const id = it.id.split('@')[0], c = cityOf(id), sel = id === selCity, connected = connectedOf(id);
      if (id === pulseCity) { const ph = (t % 1.4) / 1.4; ctx.strokeStyle = `rgba(232, 121, 58, ${1 - ph})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(it.x, it.y, 10 + ph * 22, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = connected ? '#ffd86b' : '#ffffff'; ctx.strokeStyle = sel ? '#e8793a' : '#2b3a49'; ctx.lineWidth = sel ? 4 : 2;
      ctx.beginPath(); ctx.arc(it.x, it.y, c.id === g.state.base ? 8 : 4 + Math.min(3.5, Math.sqrt(marketSize(c)) * 0.55), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); // 시장이 큰 도시일수록 점이 크다
      const p = placed.get(it.id);
      if (!p) continue;
      ctx.fillStyle = '#16212c'; ctx.shadowColor = 'rgba(255,255,255,0.95)'; ctx.shadowBlur = 4;
      ctx.textAlign = p.align; ctx.fillText(c.name, p.x, p.y); ctx.textAlign = 'left'; ctx.shadowBlur = 0;
    }
  }

  // ---- 입력: 한 손가락 이동, 두 손가락 확대, 휠, 탭 ----
  const ptrs = new Map<number, { x: number; y: number }>();
  let tapStart: { x: number; y: number; t: number } | null = null, pinch = 0, moved = 0, lastMid: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 등에서는 무시 */ }
    ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (ptrs.size === 1) { tapStart = { x: e.offsetX, y: e.offsetY, t: performance.now() }; moved = 0; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; tapStart = null; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
    p.x = e.offsetX; p.y = e.offsetY;
    if (ptrs.size === 1) { cx -= dx / scale; cy += dy / scale; moved += Math.abs(dx) + Math.abs(dy); clamp(); }
    else if (ptrs.size === 2) { // 두 손가락: 벌리고 오므리면 확대·축소, 두 손가락을 같이 움직이면 이동(둘이 동시에 된다)
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinch > 0 && lastMid) {
        const lon = cx + (lastMid.x - W / 2) / scale, lat = cy - (lastMid.y - H / 2) / scale; // 이전 가운데 점 아래의 지리 좌표
        scale *= d / pinch; clamp();
        cx = lon - (mid.x - W / 2) / scale; cy = lat + (mid.y - H / 2) / scale; clamp(); // 그 좌표가 새 가운데 점 아래에 오도록
      }
      pinch = d; lastMid = mid;
    }
  });
  const end = (e: PointerEvent) => {
    const had = ptrs.has(e.pointerId); ptrs.delete(e.pointerId);
    if (had && ptrs.size === 0 && tapStart && moved < 8 && performance.now() - tapStart.t < 500) tap(tapStart.x, tapStart.y);
    if (ptrs.size < 2) { pinch = 0; lastMid = null; }
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

  let nightOn = true;
  return {
    setNight(v: boolean) { nightOn = v; },
    select(city: string | null, route: number | null) { selCity = city; selRoute = route; },
    /** 안내용: 이 도시 둘레에 퍼지는 주황색 원을 그린다(null이면 끔) */
    setPulse(city: string | null) { pulseCity = city; },
    focusCity(id: string) { const c = CITIES.find((x) => x.id === id); if (c) { cx = c.lon; cy = c.lat; clamp(); } },
    /** 도시의 화면 좌표(점검용) */
    screenOf(id: string): { x: number; y: number } | null { const c = CITIES.find((x) => x.id === id); if (!c) return null; const r = canvas.getBoundingClientRect(); return { x: r.left + toX(c.lon), y: r.top + toY(c.lat) }; },
    /** 지도 시점(점검용) */
    view() { return { scale, cx, cy }; },
    stop() { cancelAnimationFrame(raf); },
  };
}
