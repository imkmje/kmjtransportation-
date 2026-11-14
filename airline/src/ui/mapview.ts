import land from '../data/land.json';
import { CITIES, EVENTS, typeById } from '../data';
import type { Game } from '../sim/game';
import { placeLabels, type LabelItem } from './labels';
import { marketSize, seasonOf } from '../sim/model';
import { config } from '../config';
import { subsolar, terminatorLat } from '../sim/report';

/** 세계 지도(등장방형도법) 캔버스: 이동·확대(핀치·휠), 도시·노선 누르기, 노선 위를 나는 작은 비행기 표시 */
export interface MapEvents { onCity(id: string | null): void; onRoute(id: number): void }

const LAT_MIN = -60, LAT_MAX = 80;

export function createMapView(canvas: HTMLCanvasElement, getGame: () => Game, ev: MapEvents) {
  const ctx = canvas.getContext('2d')!;
  let W = 0, H = 0, dpr = 1, resized = false;
  let scale = 3, cx = 100, cy = 25; // scale: 화면 px/도, (cx, cy): 화면 가운데의 경도·위도
  let selCity: string | null = null, selRoute: number | null = null, pulseCity: string | null = null, focusComp: number | null = null, overlay: [string, string][] | null = null, overlayLabel = '', overlayNew = new Set<string>();
  let compMode: 'all' | 'mine' | 'subs' | 'off' = 'all'; // 경쟁사 노선 보기: 전부 / 내 노선과 겹치는 것만 / 자회사만 / 끔(경쟁사 탭에서 고른 회사는 늘 보임)
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

  function draw(now: number, real: number) { // now: 일시정지하면 멈추는 애니메이션 시계, real: 항상 흐르는 시계(안내용 원)
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
    const mineSet = new Set(g.state.routes.filter((r) => r.open && g.planesOn(r.id).length).flatMap((r) => [`${r.a}|${r.b}`, `${r.b}|${r.a}`]));
    for (const k of g.state.competitors) { const f = k.id === focusComp; if (!f && (compMode === 'off' || (compMode === 'subs' && !k.stake))) continue; ctx.strokeStyle = f ? 'rgba(214, 128, 58, 0.95)' : k.stake ? 'rgba(47, 158, 91, 0.8)' : 'rgba(138, 92, 196, 0.55)'; for (const cr of k.routes) if (f || compMode !== 'mine' || mineSet.has(`${cr.a}|${cr.b}`)) for (const [x1, y1, x2, y2] of arcSegments(cityOf(cr.a), cityOf(cr.b))) { ctx.lineWidth = f ? 3.5 : k.stake ? (cr.atk ? 3 : 2) : 1.5; const [mx, my] = ctrl(x1, y1, x2, y2); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke(); } } // 경쟁사 탭에서 고른 회사는 주황 굵은 선
    ctx.setLineDash([]);
    // 노선: 이익이면 초록, 적자면 빨강, 항공기가 없으면 회색 점선
    let chip: { txt: string; color: string; lx: number; ly: number } | null = null;
    if (overlay) { // 타임랩스: 기록된 노선망만 그린다
      ctx.strokeStyle = '#2f9e5b'; ctx.lineWidth = 3;
      for (const [a, b] of overlay) for (const [x1, y1, x2, y2] of arcSegments(cityOf(a), cityOf(b))) { const nw = overlayNew.has(`${a}|${b}`); ctx.strokeStyle = nw ? '#f2b705' : '#2f9e5b'; ctx.lineWidth = nw ? 5 : 3; const [mx, my] = ctrl(x1, y1, x2, y2); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke(); }
    }
    for (const r of overlay ? [] : g.state.routes) {
      if (!r.open) continue;
      const A = cityOf(r.a), B = cityOf(r.b), d = g.routeDay(r), profit = d.revenue - d.cost, onR = g.planesOn(r.id), planes = onR.length, served = planes > 0;
      const color = !served ? '#8a96a3' : profit >= 0 ? '#2f9e5b' : '#d64545';
      ctx.strokeStyle = color; ctx.lineWidth = r.id === selRoute ? 5 : served ? 2 + Math.min(5, Math.abs(profit) * config.daysPerMonth / 1.2) : 1.5; // 굵기 = 월 이익(손실)의 크기
      ctx.setLineDash(served ? [] : [6, 5]);
      for (const [x1, y1, x2, y2] of arcSegments(A, B)) {
        const [mx, my] = ctrl(x1, y1, x2, y2);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
      }
      ctx.setLineDash([]);
      if (served && d.share < 0.2) { ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 5]); for (const [x1, y1, x2, y2] of arcSegments(A, B)) { const [mx, my] = ctrl(x1, y1, x2, y2); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke(); } ctx.restore(); }
      if (served && r.id === selRoute) { // 선택한 노선: 곡선 가운데의 월 이익 표시는 도시 이름을 다 그린 뒤 겹치지 않는 자리에 그린다
        const [x1, y1, x2, y2] = arcSegments(A, B)[0], [mx, my] = ctrl(x1, y1, x2, y2);
        chip = { txt: `월 ${profit >= 0 ? '+' : '−'}$${Math.abs(profit * config.daysPerMonth).toFixed(1)}M`, color, lx: 0.25 * x1 + 0.5 * mx + 0.25 * x2, ly: 0.25 * y1 + 0.5 * my + 0.25 * y2 };
      }
      if (served) for (const [x1, y1, x2, y2] of arcSegments(A, B)) {
        const [mx, my] = ctrl(x1, y1, x2, y2);
        for (let k = 0; k < Math.min(3, planes); k++) { // 비행기 점(장식)
          const t = (now / 4000 + k / 3) % 1, u = 1 - t, px = u * u * x1 + 2 * u * t * mx + t * t * x2, py = u * u * y1 + 2 * u * t * my + t * t * y2;
          const tx = 2 * u * (mx - x1) + 2 * t * (x2 - mx), ty = 2 * u * (my - y1) + 2 * t * (y2 - my), ang = Math.atan2(ty, tx); // 진행 방향
          if (t < 0.07) { const ph = t / 0.07; ctx.save(); ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - ph)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x1, y1, 4 + ph * 14, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); } // 이륙 고리
          const seats = typeById(onR[k].type).seats, sz = seats <= 150 ? 0.8 : seats <= 300 ? 1 : 1.35; ctx.save(); ctx.translate(px, py); ctx.rotate(ang); ctx.scale(sz, sz); ctx.fillStyle = g.state.livery ?? '#ffffff'; ctx.strokeStyle = '#2b3a49'; ctx.lineWidth = 1.2;
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
    const t = real / 1000;
    for (const it of items) {
      const id = it.id.split('@')[0], c = cityOf(id), sel = id === selCity, connected = connectedOf(id);
      if (id === pulseCity) { const ph = (t % 1.4) / 1.4; ctx.strokeStyle = `rgba(232, 121, 58, ${1 - ph})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(it.x, it.y, 10 + ph * 22, 0, Math.PI * 2); ctx.stroke(); }
      const locked = !g.cityOpen(id); // 운수권이 없는 지역
      ctx.fillStyle = connected ? '#ffd86b' : locked ? '#cfd8e2' : '#ffffff'; ctx.strokeStyle = sel ? '#e8793a' : locked ? '#8b99a8' : '#2b3a49'; ctx.lineWidth = sel ? 4 : 2;
      ctx.beginPath(); ctx.arc(it.x, it.y, c.id === g.state.base ? 8 : 4 + Math.min(3.5, Math.sqrt(marketSize(c)) * 0.55), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); // 시장이 큰 도시일수록 점이 크다
      const links = g.linksAt(id); // 허브: 연결 노선이 3개 이상이면 금빛 고리, 5개 이상이면 두 겹
      if (links >= 3) { ctx.save(); ctx.strokeStyle = 'rgba(214,160,30,0.85)'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(it.x, it.y, 12 + Math.sin(now / 600) * 0.8, 0, Math.PI * 2); ctx.stroke(); if (links >= 5) { ctx.beginPath(); ctx.arc(it.x, it.y, 16, 0, Math.PI * 2); ctx.stroke(); } ctx.restore(); }
      if (seasonOf(c, g.month) >= 1.15 && !locked) { const a = 0.55 + 0.45 * Math.sin(now / 350 + it.x), sx = it.x + 8, sy = it.y - 9; ctx.save(); ctx.fillStyle = `rgba(255,190,40,${a})`; ctx.beginPath(); ctx.moveTo(sx, sy - 4); ctx.lineTo(sx + 1.2, sy - 1.2); ctx.lineTo(sx + 4, sy); ctx.lineTo(sx + 1.2, sy + 1.2); ctx.lineTo(sx, sy + 4); ctx.lineTo(sx - 1.2, sy + 1.2); ctx.lineTo(sx - 4, sy); ctx.lineTo(sx - 1.2, sy - 1.2); ctx.closePath(); ctx.fill(); ctx.restore(); } // 성수기 반짝임
      const p = placed.get(it.id);
      if (!p) continue;
      ctx.fillStyle = locked && !sel ? '#6b7a89' : '#16212c'; ctx.shadowColor = 'rgba(255,255,255,0.95)'; ctx.shadowBlur = 4;
      ctx.textAlign = p.align; ctx.fillText(c.name, p.x, p.y); ctx.textAlign = 'left'; ctx.shadowBlur = 0;
    }
    // 행사 표시: 예고되었거나 열려 있는 행사의 도시에 고리와 이름표
    const tags = new Map<string, { text: string; color: string }>();
    for (const u of g.state.upcoming) tags.set(u.city, { text: `${EVENTS.find((e) => e.id === u.def)?.name ?? '행사'} ${u.start - g.monthsPassed <= 0 ? '이번 달' : `${u.start - g.monthsPassed}개월 뒤`}`, color: '#8a5cc4' });
    for (const e of g.state.events) if (e.city) { const d = EVENTS.find((x) => x.id === e.def); if (d) tags.set(e.city, { text: `${d.name} ${e.monthsLeft}개월`, color: (d.effect.cityCap ?? 0) < 0 ? '#d64545' : '#1f9d57' }); }
    ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const it of items) { const tag = tags.get(it.id.split('@')[0]); if (!tag) continue;
      ctx.strokeStyle = tag.color; ctx.lineWidth = 2.5; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(it.x, it.y, 13, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      const tw = ctx.measureText(tag.text).width + 10; ctx.fillStyle = tag.color; ctx.beginPath(); ctx.roundRect(it.x - tw / 2, it.y + 17, tw, 15, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(tag.text, it.x, it.y + 25);
    }
    // 선택한 노선의 월 이익 표시: 도시 이름표와 겹치지 않는 자리를 찾는다
    if (overlay && overlayLabel) { ctx.font = '800 22px system-ui, "Apple SD Gothic Neo", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(18,32,45,0.85)'; const w = ctx.measureText(overlayLabel).width + 28; ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, 14, w, 40, 12); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(overlayLabel, W / 2, 35); ctx.textAlign = 'left'; }
    if (chip) {
      ctx.font = '700 12px system-ui, sans-serif'; const tw = ctx.measureText(chip.txt).width + 12, th = 18;
      const rects = items.filter((it) => placed.has(it.id)).map((it) => { const p = placed.get(it.id)!, x0 = p.align === 'left' ? p.x : p.align === 'right' ? p.x - it.w : p.x - it.w / 2; return { x0: x0 - 2, y0: p.y - it.h / 2 - 1, x1: x0 + it.w + 2, y1: p.y + it.h / 2 + 1 }; });
      const hit = (x: number, y: number) => rects.some((r) => x - tw / 2 < r.x1 && x + tw / 2 > r.x0 && y < r.y1 && y + th > r.y0);
      let best = { x: chip.lx, y: chip.ly - 22 };
      outer: for (const dy of [0, -26, 26, -52, 52, -78]) for (const dx of [0, -70, 70, -140, 140]) { if (!hit(chip.lx + dx, chip.ly - 22 + dy)) { best = { x: chip.lx + dx, y: chip.ly - 22 + dy }; break outer; } }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = chip.color; ctx.beginPath(); ctx.roundRect(best.x - tw / 2, best.y, tw, th, 9); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(chip.txt, best.x, best.y + 9);
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
  let clock = 0, lastReal = 0, paused = false; // 일시정지하면 노선의 비행기·낮밤 움직임이 멈춘다
  const loop = (real: number) => { if (lastReal && !paused) clock += Math.min(100, real - lastReal); lastReal = real; draw(clock, real); raf = requestAnimationFrame(loop); };
  new ResizeObserver(resize).observe(canvas);
  resize();
  raf = requestAnimationFrame(loop);

  let nightOn = true;
  return {
    setNight(v: boolean) { nightOn = v; },
    /** 경쟁사 탭에서 고른 회사의 노선을 강조(null이면 끔) */
    focusComp(id: number | null) { focusComp = id; },
    /** 타임랩스용: 이 노선망만 그린다(null이면 원래대로) */
    setOverlay(routes: [string, string][] | null, label: string, fresh: string[] = []) { overlay = routes; overlayLabel = label; overlayNew = new Set(fresh); },
    setCompMode(m: 'all' | 'mine' | 'subs' | 'off') { compMode = m; },
    /** 일시정지 중이면 애니메이션을 멈춘다 */
    setPaused(v: boolean) { paused = v; },
    /** 점검용: 애니메이션 시계와 일시정지 상태 */
    anim() { return { clock, paused }; },
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
