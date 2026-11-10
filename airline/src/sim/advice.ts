import { cityById, typeById } from '../data';
import type { Game } from './game';

/** "지금 할 일" 조언: 게임 상태만 읽어서 문제와 기회를 우선순위 순으로 알려 준다(화면은 이를 눌러 해당 탭으로 이동시킨다) */
export interface Advice { level: 'bad' | 'warn' | 'info'; text: string; tab?: 'map' | 'routes' | 'fleet' | 'money' | 'news'; routeId?: number; cityId?: string }

export function advise(g: Game): Advice[] {
  const s = g.state, out: Advice[] = [];
  if (s.status !== 'playing') return out;
  const idle = s.planes.filter((p) => p.routeId === null && p.shop <= 0);
  if (idle.length) out.push({ level: 'bad', text: `노는 항공기가 ${idle.length}대 있습니다. 노선에 배정해야 돈을 벌어요.`, tab: s.routes.some((r) => r.open) ? 'routes' : 'map' });
  for (const r of s.routes) if (r.open && g.planesOn(r.id).length === 0) out.push({ level: 'warn', text: `${cityById(r.a).name} ⇄ ${cityById(r.b).name} 노선에 배정된 항공기가 없습니다.`, tab: 'routes', routeId: r.id });
  for (const p of s.planes) if (p.cond < 0.5 && p.shop <= 0) out.push({ level: p.cond < 0.3 ? 'bad' : 'warn', text: `${typeById(p.type).name}의 정비 상태가 ${Math.round(p.cond * 100)}%입니다. 고장 나기 전에 점검하세요.`, tab: 'fleet' });
  const seen = new Set<string>();
  for (const r of s.routes) if (r.open && g.planesOn(r.id).length) for (const c of [r.a, r.b]) {
    if (seen.has(c)) continue; seen.add(c);
    if (g.slotsUsed(c) / Math.max(1, g.slotCapacity(c)) > 0.9) out.push({ level: 'warn', text: `${cityById(c).name} 공항 슬롯이 거의 가득 찼습니다. 슬롯을 사거나 노선 우선순위를 올리세요.`, tab: 'map', cityId: c });
  }
  for (const r of s.routes) {
    if (!r.open || !g.planesOn(r.id).length || r.daily.length < 8) continue;
    const last = r.daily.slice(-10), seats = last.reduce((a, d) => a + d.seats, 0), pax = last.reduce((a, d) => a + d.pax, 0), profit = last.reduce((a, d) => a + d.profit, 0) * 3; // 월 환산(10일 → 30일)
    const lf = seats > 0 ? pax / seats : 0, label = `${cityById(r.a).name} ⇄ ${cityById(r.b).name}`;
    if (profit < -0.3) out.push({ level: 'warn', text: `${label} 노선이 적자입니다(월 약 $${Math.abs(profit).toFixed(1)}M). 운임·횟수를 조정하거나 닫으세요.`, tab: 'routes', routeId: r.id });
    else if (lf < 0.6) out.push({ level: 'info', text: `${label} 탑승률이 ${Math.round(lf * 100)}%로 낮습니다. 운임을 내려 보세요.`, tab: 'routes', routeId: r.id });
    else if (lf > 0.97) { const d = g.routeDay(r); if (d.demand > d.seats * 1.15) out.push({ level: 'info', text: `${label}은(는) 자리가 꽉 차고 수요가 더 있습니다. 운임을 올리거나 증편하세요.`, tab: 'routes', routeId: r.id }); }
  }
  for (const r of s.routes) { if (!r.open || !g.planesOn(r.id).length) continue; const w = g.warOn(r); if (w) out.push({ level: 'warn', text: `${w.comp.name}이(가) ${cityById(r.a).name} ⇄ ${cityById(r.b).name}에서 운임 전쟁 중입니다(${w.route.war}개월 남음). 운임을 따라 내리거나 버티거나 제휴하세요.`, tab: 'routes', routeId: r.id }); }
  const hasRoute = s.routes.some((r) => r.open && g.planesOn(r.id).length);
  if (hasRoute && s.cash > 90 && s.planes.length < 12) out.push({ level: 'info', text: `현금이 $${Math.round(s.cash)}M으로 넉넉합니다. 항공기를 사서 노선을 늘려 보세요.`, tab: 'fleet' });
  if (!s.hedge && hasRoute) {
    if (g.state.fuel > 1.25) out.push({ level: 'info', text: '연료 가격이 비쌉니다. 계약으로 고정할지는 신중히 — 가격이 내릴 수도 있어요.', tab: 'money' });
    else if (g.state.fuel < 0.82) out.push({ level: 'info', text: '연료 가격이 쌉니다. 지금 계약하면 낮은 가격으로 6개월간 고정됩니다.', tab: 'money' });
  }
  if (s.freeze > 0) out.push({ level: 'warn', text: `경기 악화로 은행이 대출을 중단했습니다(${s.freeze}개월). 현금을 아껴 쓰세요.`, tab: 'money' });
  else if (s.loan > 0 && g.loanRate > 0.03) out.push({ level: 'warn', text: `대출 이율이 월 ${(g.loanRate * 100).toFixed(1)}%로 높습니다. 여유가 되면 갚으세요.`, tab: 'money' });
  if (s.cash < 3 && s.cash >= 0 && hasRoute) out.push({ level: 'warn', text: '현금이 거의 없습니다. 고정비를 낼 돈이 남아 있는지 확인하세요.', tab: 'money' });
  if (g.avgOtp < 0.85 && hasRoute) out.push({ level: 'warn', text: `정시율이 ${Math.round(g.avgOtp * 100)}%로 낮습니다. 정비와 슬롯 혼잡을 확인하세요.`, tab: 'routes' });
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]).slice(0, 5);
}
