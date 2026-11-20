import type { CarLook } from './look';
import { chassisOf } from './variant';

// 옆모습 SVG: 3D와 같은 차대 값(chassisSeed 반영)에서 뽑는다(데모 sil()). color가 없으면 currentColor.
export function silhouetteSvg(look: CarLook, opts: { color?: string } = {}): string {
  const p = chassisOf(look), wr = p.wr, h = p.L / 2, f = (n: number) => n.toFixed(2);
  const c = opts.color ?? 'currentColor';
  const pts = [[-h, p.clr], [h, p.clr], [h, p.belt - (p.nose ?? .2)], [p.cF + p.rf, p.belt], [p.cF, p.roof], [p.cR, p.roof], [p.cR - p.rr, p.belt], [-h, p.belt - .06]];
  // 픽업: 객실 뒤 벽과 짐칸 사이 틈(흰 세로선)
  const bed = p.bed == null ? '' : `<path d="M${f(p.cR - p.rr - .1)} ${f(p.belt + .1)}V${f(p.belt - .3)}" stroke="#fff" stroke-width=".07"/>`;
  const wheels = [-p.wb, p.wb].map(x => `<circle cx="${x}" cy="${f(wr)}" r="${f(wr + .07)}" fill="#fff"/><circle cx="${x}" cy="${f(wr)}" r="${f(wr - .03)}" fill="${c}"/><circle cx="${x}" cy="${f(wr)}" r="${f(wr * .45)}" fill="#fff"/>`).join('');
  return `<svg viewBox="-2.9 -2.05 5.8 2.15" aria-hidden="true"><g transform="scale(1,-1)"><path d="M${pts.map(q => f(q[0]) + ' ' + f(q[1])).join('L')}Z" fill="${c}" stroke="${c}" stroke-width=".16" stroke-linejoin="round"/>${bed}${wheels}</g></svg>`;
}
