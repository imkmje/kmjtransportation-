// 1.3.0 평론가별 시승기: 출시 때 평론가(config.critics.list와 같은 순서) 4명의 점수는 기존 평론 점수(reviews) 그대로이고(합계·판매 영향 불변),
// 거기에 2~3문장 글을 결정론적으로 붙인다(차의 강점·약점, 가격, 시대의 기대 장비, 전기차 주행 거리). 문장 조각은 data/critics.json
import { CRITICS, optionById } from '../data';
import { grades } from './cars';
import { josa, type JosaPair } from './josa';
import { hash32 } from './rng';
import type { CarState, Critique, Stat, Stats } from './types';

export interface CritiqueCtx { name: string; genId: number; stats: Stats; year: number; reviews: number[]; price: number; base: number; missing: string[]; fresh: string[]; ev: { km: number; exp: number } | null }

/** "{car}", "{car|은/는}"처럼 자리 채우기(조사는 josa.ts) */
function fill(t: string, vars: Record<string, string>): string {
  return t.replace(/\{(\w+)(?:\|([^}]+))?\}/g, (_, k: string, j?: string) => (vars[k] ?? '') + (j ? josa(vars[k] ?? '', j as JosaPair) : ''));
}

export function writeCritiques(s: CarState, c: CritiqueCtx): Critique[] {
  const g = grades(c.stats, c.year), names = (ids: string[]) => ids.map((id) => optionById(id).name).join('·');
  const vars = { car: `「${c.name}」`, opts: '', km: String(c.ev?.km ?? ''), exp: String(c.ev?.exp ?? '') };
  const used = new Set<string>(); // 한 차의 시승기 4개 안에서 같은 조각을 다시 쓰지 않는다(앞 평론가가 쓴 것은 건너뛰고 다음 후보)
  return CRITICS.critics.map((cr, i) => {
    const score = c.reviews[i] ?? 0, pick = (list: string[], salt: number): string | null => {
      const k = hash32(s.seed, c.genId, i, salt) % list.length;
      for (let d = 0; d < list.length; d++) { const t = list[(k + d) % list.length]; if (!used.has(t)) { used.add(t); return t; } }
      return null; // 후보가 모자라면 그 문장은 뺀다
    }, add = (a: string[], t: string | null) => { if (t) a.push(t); }, fillN = (t: string | null, v: Record<string, string>) => (t === null ? null : fill(t, v));
    const band = score >= 7 ? 'high' : score >= 5 ? 'mid' : 'low';
    const focus = [...cr.focus].sort((a, b) => g[b] - g[a] || (a < b ? -1 : 1)), best: Stat = focus[0], worst: Stat = focus[focus.length - 1];
    const out = [fill(pick(cr.open[band], 1) ?? cr.open[band][0], vars)];
    if (band !== 'low' && g[best] >= 5) add(out, pick(CRITICS.good[best], 2));
    if (band !== 'high' && g[worst] < 5 && worst !== best) add(out, pick(CRITICS.bad[worst], 3));
    if (out.length < 2) add(out, pick(band === 'low' ? CRITICS.bad[worst] : CRITICS.good[best], 4));
    // 셋째 문장: 평론가 성향별(가성비파는 가격, 살림꾼은 빠진 장비·주행 거리, 디자인파는 드문 장비, 성능파는 주행 거리)
    const ratio = c.price / c.base;
    const extra = cr.id === 'value' ? pick(CRITICS.price[ratio <= 0.95 ? 'cheap' : ratio <= 1.05 ? 'fair' : 'dear'], 5)
      : cr.id === 'household' && c.missing.length ? fillN(pick(CRITICS.missing, 6), { ...vars, opts: names(c.missing) })
      : cr.id === 'design' && c.fresh.length ? fillN(pick(CRITICS.fresh, 7), { ...vars, opts: names(c.fresh) })
      : (cr.id === 'household' || cr.id === 'performance') && c.ev ? fillN(pick(CRITICS.range[c.ev.km >= c.ev.exp * 1.1 ? 'long' : c.ev.km >= c.ev.exp ? 'ok' : 'short'], 8), vars) : null;
    if (extra && out.length < 3) out.push(extra);
    return { critic: cr.id, score, text: out.slice(0, 3).join(' ') };
  });
}

/** 화면용: 세대의 시승기에 평론가 이름·매체를 붙인다(없으면 빈 목록) */
export function critiquesOf(s: CarState, genId: number) {
  const g = s.nameplates.flatMap((n) => n.generations).find((x) => x.id === genId);
  return (g?.critiques ?? []).map((c) => { const d = CRITICS.critics.find((x) => x.id === c.critic); return { ...c, name: d?.name ?? '', outlet: d?.outlet ?? '' }; });
}
