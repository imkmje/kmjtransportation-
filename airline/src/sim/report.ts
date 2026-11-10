import { cityById } from '../data';
import type { Game } from './game';

/** 노선별 최근 30일 요약(월간 보고서용). 노선 하루 기록(daily)만 읽는다 */
export interface RouteMonth { routeId: number; label: string; profit: number; pax: number; loadFactor: number; otp: number; days: number }

export function routeMonthStats(g: Game): RouteMonth[] {
  const out: RouteMonth[] = [];
  for (const r of g.state.routes) {
    if (!r.open || !r.daily.length) continue;
    const last = r.daily.slice(-30);
    const seats = last.reduce((a, d) => a + d.seats, 0), pax = last.reduce((a, d) => a + d.pax, 0);
    out.push({
      routeId: r.id, label: `${cityById(r.a).name} ⇄ ${cityById(r.b).name}`, days: last.length,
      profit: last.reduce((a, d) => a + d.profit, 0), pax, loadFactor: seats > 0 ? pax / seats : 0,
      otp: last.reduce((a, d) => a + (d.otp ?? 1), 0) / last.length,
    });
  }
  return out;
}

/** 가장 이익이 큰 노선·가장 적자인 노선(없으면 null). 노선이 하나뿐이면 둘 다 같다 */
export function bestWorst(stats: RouteMonth[]): { best: RouteMonth | null; worst: RouteMonth | null } {
  if (!stats.length) return { best: null, worst: null };
  const sorted = [...stats].sort((a, b) => b.profit - a.profit || a.routeId - b.routeId);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

/** 해가 머리 위에 있는 곳(지구의 "낮"의 중심)의 위도·경도(도). day는 게임 일수. 장식용 단순 모형: 12일에 지구가 한 바퀴 돈다 */
export function subsolar(day: number, frac = 0): { lat: number; lon: number } {
  const lon = ((180 - 30 * (day + frac)) % 360 + 540) % 360 - 180;
  const doy = (Math.floor(day / 30) % 12) * 30 + (day % 30); // 게임 달력(1년 = 360일)
  return { lat: 23.44 * Math.sin(((doy - 80 * (360 / 365)) / 360) * 2 * Math.PI), lon };
}

/** 위도 lat(도)·경도 lon(도)가 밤인가(태양 고도 < 0) */
export function isNight(lat: number, lon: number, sun: { lat: number; lon: number }): boolean {
  const rad = Math.PI / 180, h = (lon - sun.lon) * rad;
  return Math.sin(lat * rad) * Math.sin(sun.lat * rad) + Math.cos(lat * rad) * Math.cos(sun.lat * rad) * Math.cos(h) < 0;
}

/** 경도 lon에서 낮과 밤이 갈리는 위도(도). 해가 거의 적도면 ±0.5도로 보정 */
export function terminatorLat(lon: number, sun: { lat: number; lon: number }): number {
  const rad = Math.PI / 180, d = Math.abs(sun.lat) < 0.5 ? (sun.lat < 0 ? -0.5 : 0.5) : sun.lat;
  return Math.atan(-Math.cos((lon - sun.lon) * rad) / Math.tan(d * rad)) / rad;
}
