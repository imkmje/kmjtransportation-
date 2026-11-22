// 1.0.0 화면 정리: 재무(연도별·차종별 표와 그래프), 회사 요약 칸. 상태는 읽기만 한다(HTML 문자열을 돌려주고, 조작은 data-act 버튼으로 app.ts가 처리)
import { config } from '../config';
import * as Q from '../sim/queries';
import { yearOf } from '../sim/time';
import type { CarState, LedgerEntry } from '../sim/types';
import { ROLE_NAME, esc, money, num } from './fmt';

export type FinRange = '1y' | '5y' | 'all';
export const FIN_RANGES: [FinRange, string][] = [['1y', '1년(달마다)'], ['5y', '5년'], ['all', '전체']];

/** 표·그래프 한 줄: 한 달 또는 한 해. null = 그 기간의 장부가 남아 있지 않음(연 기록에는 매출·이익·현금만 있다) */
export interface FinRow {
  label: string; short: string; act: string; v: number;
  revenue: number; cogs: number | null; sga: number | null; dev: number | null; profit: number; op: number; cash: number | null;
  cars: Record<string, number>; // 세대 ID → 차종 이익(매출 − 원가 − 광고 − 리콜)
}
const M = () => config.time.monthsPerYear;
const carProfit = (c: NonNullable<LedgerEntry['cars']>[number]) => c.revenue - c.cogs - c.marketing - c.recall;
/** 장부 몇 달을 한 줄로: 판매관리 = 광고 + 월급 + 유지비 + 이자 + 리콜 + 일회성(연구 시작 비용 빼고), 개발 = 개발비 + 연구 시작 비용 */
function sumRows(rows: LedgerEntry[]) {
  const t = { revenue: 0, cogs: 0, sga: 0, dev: 0, profit: 0, oneOff: 0, cars: {} as Record<string, number> };
  for (const e of rows) {
    const res = e.research ?? 0;
    t.revenue += e.revenue; t.cogs += e.cogs; t.dev += e.dev + res; t.profit += e.profit; t.oneOff += e.oneOff || 0;
    t.sga += e.marketing + e.salaries + e.upkeep + e.interest + e.recall + (e.oneOff || 0) - res;
    for (const c of e.cars ?? []) t.cars[c.id] = (t.cars[c.id] ?? 0) + carProfit(c);
  }
  return t;
}
/** 기간 줄(오래된 것이 앞) */
export function finRows(s: CarState, range: FinRange): FinRow[] {
  const led = s.ledger;
  if (range === '1y') return led.slice(-12).map((e) => {
    const t = sumRows([e]);
    return { label: `${e.year}년 ${e.monthOfYear}월`, short: `${e.monthOfYear}월`, act: 'monthOpen', v: led.indexOf(e), revenue: t.revenue, cogs: t.cogs, sga: t.sga, dev: t.dev, profit: t.profit, op: t.profit + t.oneOff, cash: e.cash, cars: t.cars };
  });
  const cur = yearOf(s.week), first = config.time.startYear, out: FinRow[] = [];
  for (let y = range === '5y' ? Math.max(first, cur - 4) : first; y <= cur; y++) {
    const rows = led.filter((e) => e.year === y), log = s.years?.[y], months = Math.max(log?.months ?? 0, rows.length);
    if (!months) continue;
    const full = rows.length >= months, t = sumRows(rows), last = rows.at(-1);
    const part = y === cur ? `(${months}개월)` : '';
    const cars = log && Object.keys(log.cars).length ? log.cars : t.cars;
    out.push({
      label: `${y}년${part}`, short: `${String(y).slice(2)}년`, act: y < cur ? 'yearOpen' : 'tab', v: y,
      revenue: full ? t.revenue : log?.revenue ?? t.revenue, cogs: full ? t.cogs : null, sga: full ? t.sga : null, dev: full ? t.dev : null,
      profit: full ? t.profit : log?.profit ?? t.profit, op: full ? t.profit + t.oneOff : log?.profit ?? t.profit,
      cash: last && last.monthOfYear === M() ? last.cash : y === cur ? s.cash : log?.cash ?? null, cars,
    });
  }
  return out;
}

const H = 150, X0 = 58;
let W = 480; // 그래프 너비(viewBox). 두 칸에 나란히 둘 때는 좁게 해서 글자가 작아지지 않게
const axis = (top: string, bot: string, a: string, b: string, zeroY: number | null) =>
  `${zeroY === null ? '' : `<line class="ax" x1="${X0}" x2="${W}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}"/>`}<text class="tk" x="${X0 - 6}" y="12" text-anchor="end">${top}</text><text class="tk" x="${X0 - 6}" y="${H - 2}" text-anchor="end">${bot}</text>`
  + `<text class="tk" x="${X0}" y="${H + 14}">${a}</text><text class="tk" x="${W - 2}" y="${H + 14}" text-anchor="end">${b}</text>`;
/** 막대(0 위 이익, 0 아래 손실). 색 말고도 위·아래 위치와 제목(+−)으로 구분한다 */
function barChart(rows: FinRow[], val: (r: FinRow) => number, name: string): string {
  if (!rows.length) return '';
  W = 320;
  const vs = rows.map(val), mx = Math.max(1, ...vs.map(Math.abs)), bw = (W - X0) / Math.max(rows.length, 6), mid = H / 2;
  return `<svg class="fin-chart" viewBox="0 0 ${W} ${H + 18}" width="100%" role="img" aria-label="${esc(name)}">${axis(`+${money(mx)}`, `−${money(mx)}`, rows[0].short, rows.at(-1)!.short, mid)}
    ${vs.map((v, i) => { const h = (Math.abs(v) / mx) * (mid - 4), x = X0 + i * bw + 2; return `<rect class="${v >= 0 ? 'b-pos' : 'b-neg'}" x="${x.toFixed(1)}" y="${(v >= 0 ? mid - h : mid).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2"><title>${esc(rows[i].label)} ${esc(name)} ${money(v, true)}</title></rect>`; }).join('')}</svg>`;
}
/** 현금 꺾은선(0 아래로 가면 0 선을 긋는다) */
function cashChart(rows: FinRow[]): string {
  const pts = rows.map((r, i) => [i, r.cash] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return '<p class="hint">두 기간 이상 쌓이면 현금 그래프가 나옵니다.</p>';
  W = 320; // 꺾은선은 0에서 시작하지 않는다(변화가 보이게). 0이 범위 안이면 0 선을 긋는다
  const v0 = Math.min(...pts.map((p) => p[1])), v1 = Math.max(...pts.map((p) => p[1])), pad = Math.max(1, (v1 - v0) * 0.1), lo = v0 - pad, hi = v1 + pad, step = (W - X0 - 8) / Math.max(1, rows.length - 1);
  const X = (i: number) => X0 + 4 + i * step, Y = (v: number) => 6 + (1 - (v - lo) / (hi - lo)) * (H - 12);
  return `<svg class="fin-chart" viewBox="0 0 ${W} ${H + 18}" width="100%" role="img" aria-label="현금">${axis(money(v1), money(v0), rows[0].short, rows.at(-1)!.short, lo < 0 && hi > 0 ? Y(0) : null)}
    <polyline class="ln" points="${pts.map(([i, v]) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>${pts.map(([i, v]) => `<circle class="${v < 0 ? 'dot-neg' : 'dot'}" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3"><title>${esc(rows[i].label)} 현금 ${money(v)}</title></circle>`).join('')}</svg>`;
}
/** 차종별 이익 쌓은 막대: 이익은 0 위로, 손실은 0 아래로 쌓는다. 큰 차종 6개 + 기타 */
function stackChart(s: CarState, rows: FinRow[]): string {
  const tot = new Map<string, number>();
  for (const r of rows) for (const [id, v] of Object.entries(r.cars)) tot.set(id, (tot.get(id) ?? 0) + Math.abs(v));
  if (!tot.size) return '<p class="hint">차를 팔기 시작하면 차종별 이익이 쌓입니다.</p>';
  W = 480;
  const top = [...tot].sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0])).slice(0, 6).map(([id]) => id), key = (id: string) => (top.includes(id) ? top.indexOf(id) : 6);
  const name = (id: string) => { const g = Q.generationById(s, Number(id)); return g ? `${Q.nameplateOf(s, g.id)?.name ?? ''} ${g.number}세대` : '단종한 차'; };
  const per = rows.map((r) => { const a = new Array(7).fill(0); for (const [id, v] of Object.entries(r.cars)) a[key(id)] += v; return a as number[]; });
  const mx = Math.max(1, ...per.map((a) => Math.max(a.filter((v) => v > 0).reduce((x, y) => x + y, 0), -a.filter((v) => v < 0).reduce((x, y) => x + y, 0))));
  const hasNeg = per.some((a) => a.some((v) => v < 0)), mid = hasNeg ? H / 2 : H - 2, scale = (hasNeg ? H / 2 - 4 : H - 8) / mx, bw = (W - X0) / Math.max(rows.length, 6);
  const bars = per.map((a, i) => { let up = mid, dn = mid; const x = X0 + i * bw + 2;
    return a.map((v, k) => { if (!v) return ''; const h = Math.abs(v) * scale, y = v > 0 ? (up -= h) : dn; if (v < 0) dn += h;
      return `<rect class="cat${k}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}"><title>${esc(rows[i].label)} ${esc(k < 6 ? name(top[k]) : '기타')} ${money(v, true)}</title></rect>`; }).join(''); }).join('');
  const legend = [...top.map((id, k) => [k, name(id)] as const), ...(tot.size > 6 ? [[6, `기타 ${tot.size - 6}종`] as const] : [])].map(([k, n]) => `<span><i class="cat${k}"></i>${esc(n)}</span>`).join('');
  return `<svg class="fin-chart" viewBox="0 0 ${W} ${H + 18}" width="100%" role="img" aria-label="차종별 이익">${axis(`+${money(mx)}`, hasNeg ? `−${money(mx)}` : '0원', rows[0].short, rows.at(-1)!.short, mid)}${bars}</svg><div class="fin-legend">${legend}</div>`;
}
/** 재무 화면 왼쪽 칸: 그래프 세 개와 기간 표 */
export function finMain(s: CarState, range: FinRange): string {
  const rows = finRows(s, range), m = range === '1y';
  const seg = `<div class="seg fin-range" role="tablist" aria-label="기간">${FIN_RANGES.map(([k, l]) => `<button role="tab" data-act="finRange" data-v="${k}" aria-selected="${range === k}">${l}</button>`).join('')}</div>`;
  if (!rows.length) return `<div class="card fin-main">${seg}<p class="hint">첫 달 결산이 끝나면 표와 그래프가 나옵니다.</p></div>`;
  const cell = (v: number | null, sign = false) => `<td class="r${v === null ? ' d' : sign ? ` ${v >= 0 ? 'pos' : 'neg'}` : ''}">${v === null ? '—' : money(v, sign)}</td>`;
  const lab = (r: FinRow) => r.act === 'tab' ? `${esc(r.label)}` : `<button class="lnk" data-act="${r.act}" data-v="${r.v}">${esc(r.label)}</button>`;
  const table = `<div class="tblwrap"><table class="tbl fin-t"><tr><th>${m ? '달' : '해'}</th><th class="r">매출</th><th class="r">원가</th><th class="r">판매관리</th><th class="r">개발</th><th class="r">이익</th><th class="r">${m ? '월말' : '연말'} 현금</th></tr>
    ${[...rows].reverse().map((r) => `<tr>${`<td>${lab(r)}</td>`}${cell(r.revenue)}${cell(r.cogs)}${cell(r.sga)}${cell(r.dev)}${cell(r.profit, true)}${cell(r.cash)}</tr>`).join('')}</table></div>`;
  const gap = rows.some((r) => r.cogs === null);
  return `<div class="card fin-main">${seg}
    <div class="fin-charts"><section><p class="lbl">${m ? '영업 이익(일회성 지출 뺌)' : '연 이익'}</p>${barChart(rows, (r) => (m ? r.op : r.profit), m ? '영업 이익' : '연 이익')}</section>
    <section><p class="lbl">${m ? '월말' : '연말'} 현금</p>${cashChart(rows)}</section>
    <section class="wide"><p class="lbl">차종별 이익(매출 − 원가 − 광고 − 리콜)</p>${stackChart(s, rows)}</section></div>
    <p class="lbl" style="margin-top:12px">${m ? '최근 12개월' : '연도별'} 손익 · <small class="hint">${m ? '달을 누르면 월 결산 창' : '지난 해를 누르면 연 보고서'}</small></p>${table}
    <p class="note">판매관리 = 광고비 + 직원·임원 월급 + 본사·공장 유지비 + 대출 이자 + 리콜 + 일회성 지출(채용 공고·교육·퇴직금·승급·건설). 개발 = 개발비 + 연구 시작 비용.${gap ? ' 장부는 최근 24개월만 남아, 그보다 오래된 해는 매출·이익·현금만 보입니다(—).' : ''}</p></div>`;
}

/** 회사 탭 첫 화면: 칸마다 누르면 그 안쪽 탭 */
export function companySummary(s: CarState): string {
  const rows = Q.staffInfo(s), h = Q.hiringInfo(s), e = Q.execInfo(s), hq = Q.hqInfo(s), f = Q.factoryInfo(s);
  const byRole = (['designer', 'engineer', 'tester', 'sales'] as const).map((r) => `${ROLE_NAME[r]} ${rows.filter((x) => x.role === r).length}`).join(' · ');
  const pay = rows.reduce((a, x) => a + x.salary, 0), xpay = e.roles.reduce((a, r) => a + (r.holder?.pay ?? 0), 0), interest = Math.round(s.loan.balance * Q.loanRate(s));
  const fix: [string, number][] = [['직원 월급', pay], ['임원 월급', xpay], ['본사 유지비', hq.current.upkeep], ['공장 유지비', f.current.upkeep], ['배터리 공장 유지비', Q.batteryPlantInfo(s).upkeep], ['대출 이자', interest]];
  const total = fix.reduce((a, [, v]) => a + v, 0), util = f.current.capacity ? f.produced / f.current.capacity : 0, un = Q.execUnread(s);
  const n = hq.next, nextLine = n ? `다음 ${n.level}등급 ${esc(n.name)} · 비용 ${money(n.cost)}` : '최고 등급입니다';
  const box = (v: string, title: string, big: string, lines: string, cls = '') => `<button class="card co-box${cls ? ` ${cls}` : ''}" data-act="cotab" data-v="${v}"><span class="lbl">${title}</span><b>${big}</b>${lines}<span class="co-go" aria-hidden="true">자세히 →</span></button>`;
  return `<div class="co-sum">
    ${box('staff', '직원', `${h.staffCount}<span>/${h.capacity}명</span>`, `<small>${byRole}</small><small>${h.candidates.length ? `채용 후보 ${h.candidates.length}명 대기` : h.full ? '정원이 찼습니다' : `${h.capacity - h.staffCount}명 더 뽑을 수 있습니다`}</small>`)}
    ${box('exec', '임원', `${e.used}<span>/${e.seats}석</span>`, `<small>${e.roles.filter((r) => r.holder).map((r) => esc(r.title)).join(' · ') || '임원이 없습니다'}</small><small>${un ? `읽지 않은 보고 ${un}건` : '새 보고 없음'}</small>`)}
    ${box('hq', '본사', `${hq.current.level}<span>등급 · ${esc(hq.current.name)}</span>`, `<small>${nextLine}</small><small>${n ? (hq.canUpgrade ? '지금 올릴 수 있습니다' : esc(hq.reason ?? '')) : ''}</small>`)}
    ${box('factory', '공장', `${f.current.level}<span>등급</span>`, `<small>가동률 ${Math.round(util * 100)}% · 한 달 ${num(f.produced)}/${num(f.current.capacity)}대</small><small>생산 라인 ${f.linesUsed}/${f.current.lines}개${f.building ? ` · 증설 공사 ${f.building.monthsLeft}개월 남음` : ''}</small>`)}
    <div class="card co-box co-fix"><span class="lbl">월 고정비</span><b>${money(total)}<span>/월</span></b><table class="tbl">${fix.filter(([, v]) => v).map(([k, v]) => `<tr><td>${k}</td><td class="r">${money(v)}</td></tr>`).join('')}</table><small>차 원가·광고비·개발비는 빼고, 지금 기준으로 매달 나가는 돈입니다.</small></div></div>`;
}
