import type { Pt } from './network';

/** 곡선 조각 길이(m). 일반 도로의 최소 길이(20m)보다 짧게 두어 더 매끄럽게 한다 */
export const CURVE_PIECE = 12;

/** 2차 베지어 곡선(시작 p0, 조절점 c, 끝 p2)을 호 길이가 거의 같은 점 목록으로 자른다. 조각 길이는 spacing 근처(최소 minLen 이상)로 맞춘다 */
export function curvePoints(p0: Pt, c: Pt, p2: Pt, spacing = CURVE_PIECE, minLen = CURVE_PIECE - 1): Pt[] {
  const at = (t: number): Pt => { const u = 1 - t; return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y }; };
  const N = 200, fine: Pt[] = [], cum = [0];
  for (let i = 0; i <= N; i++) fine.push(at(i / N));
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(fine[i].x - fine[i - 1].x, fine[i].y - fine[i - 1].y));
  const len = cum[N];
  const n = Math.max(1, Math.min(60, Math.floor(len / Math.max(spacing, minLen))));
  const out: Pt[] = [{ ...p0 }];
  for (let k = 1; k < n; k++) {
    const target = (len * k) / n;
    let i = 1;
    while (i < N && cum[i] < target) i++;
    const f = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    out.push({ x: fine[i - 1].x + (fine[i].x - fine[i - 1].x) * f, y: fine[i - 1].y + (fine[i].y - fine[i - 1].y) * f });
  }
  out.push({ ...p2 });
  return out;
}
