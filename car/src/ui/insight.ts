// 0.10.0 정보와 수습 수단의 카드·창 한 장씩(HTML 문자열). 화면 배치는 app.ts가 정한다. sim은 읽기만 한다(명령은 data-act 버튼으로 app.ts가 보낸다)
// 카드 함수: pnlCard(차고 상세 '이 차의 손익'), nameplatePnlLine(기록 탭 차종 계보), factorsCard(차고 상세 '판매 요인'), careerBlock(직원 상세 '경력'),
// decadePaper(10년 회고 신문 창 본문), decadeButtons(기록 탭 다시 보기), rescueBlock(차고 '다음 단계' 안 수습 버튼), rescueConfirm(확인 창 문구)
import { config } from '../config';
import * as Q from '../sim/queries';
import type { CarState } from '../sim/types';
import { esc, longCls, money, num, score } from './fmt';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const sign = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '±');
const KIND: Record<string, string> = { new: '신차', fullchange: '풀체인지', facelift: '페이스리프트', fix: '긴급 개선' };

/** 막대 그래프(월별 이익): 0 위는 초록, 아래는 빨강 */
function bars(vals: number[], label: string, w = 300, h = 56): string {
  if (!vals.length) return '';
  const mx = Math.max(1, ...vals.map(Math.abs)), hasNeg = vals.some((v) => v < 0), mid = hasNeg ? h / 2 : h - 2, bw = w / Math.max(12, vals.length);
  return `<svg class="mini ins-bars" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${vals.map((v, i) => { const bh = (Math.abs(v) / mx) * (hasNeg ? h / 2 - 2 : h - 4); return `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(v >= 0 ? mid - bh : mid).toFixed(1)}" width="${Math.max(0.6, bw - 1).toFixed(1)}" height="${Math.max(0.8, bh).toFixed(1)}" fill="${v >= 0 ? 'var(--pos)' : 'var(--neg)'}"/>`; }).join('')}${hasNeg ? `<line x1="0" x2="${w}" y1="${mid}" y2="${mid}" stroke="var(--line)"/>` : ''}</svg>`;
}

/** 차고 상세: 이 차(세대)의 손익 */
export function pnlCard(s: CarState, generationId: number): string {
  const p = Q.modelPnL(s, generationId);
  if (!p) return '';
  const k = (label: string, v: string, cls = '') => `<div class="kpi"><small>${label}</small><b class="${longCls(cls, v)}">${v}</b></div>`;
  const devParts = [['처음 개발', p.dev.base], ['페이스리프트', p.dev.lift], ['의무 장비', p.dev.retro], ['긴급 개선', p.dev.fix]].filter(([, v]) => (v as number) > 0).map(([n, v]) => `${n} ${money(v as number)}`).join(' · ');
  const pay = p.recovered ? `개발비를 회수했습니다${p.paybackMonths ? `(출시 ${p.paybackMonths}개월째)` : ''}.` : `개발비 회수까지 ${money(-p.net)} 남았습니다.`;
  return `<div class="card pnl-card"><p class="lbl">이 차의 손익${p.estimated ? ' <small class="hint">일부 추정</small>' : ''}</p>
    <div class="kpis">${k('누적 매출', money(p.revenue))}${k('판매 이익', money(p.profit, true), p.profit >= 0 ? 'pos' : 'neg')}${k('개발비 합', money(p.devTotal))}${k('개발비 뺀 이익', money(p.net, true), p.net >= 0 ? 'pos' : 'neg')}</div>
    <p class="hint" style="margin-top:6px">${pay} 원가 ${money(p.cogs)} · 광고비 ${money(p.marketing)}${p.recall ? ` · 리콜비 ${money(p.recall)}` : ''}</p>
    ${devParts ? `<p class="hint">개발비: ${devParts}</p>` : ''}
    ${p.monthly.length ? `<p class="lbl" style="margin-top:10px">월별 이익</p>${bars(p.monthly, '월별 이익')}` : ''}
    ${p.facelift ? `<p class="hint pnl-lift" style="margin-top:6px">${esc(p.facelift.text)}</p>` : ''}
    ${p.estimated ? '<p class="note">이전 버전에서 저장한 게임이라 매출·원가·월별 이익 일부는 판매 기록으로 추정했습니다.</p>' : ''}</div>`;
}

/** 기록 탭 차종 계보: 차종 손익 한 줄 */
export function nameplatePnlLine(s: CarState, nameplateId: number): string {
  const n = Q.nameplatePnL(s, nameplateId);
  if (!n) return '';
  return `<p class="hint np-pnl">손익${n.estimated ? '(일부 추정)' : ''}: 판매 이익 <b class="${n.profit >= 0 ? 'pos' : 'neg'}">${money(n.profit, true)}</b> − 개발비 ${money(n.devTotal)} = <b class="${n.net >= 0 ? 'pos' : 'neg'}">${money(n.net, true)}</b>${n.gens.length > 1 ? ` · ${n.gens.map((g) => `${g.number}세대 ${money(g.net, true)}`).join(' · ')}` : ''}</p>`;
}

/** 차고 상세: 판매 요인(깎는 요인 빨강, 올리는 요인 파랑). 부진하면 맨 위에 요약 한 줄 */
export function factorsCard(s: CarState, generationId: number): string {
  const f = Q.salesFactors(s, generationId);
  if (!f) return '';
  const show = f.factors.filter((x) => Math.abs(x.impact) >= config.factors.minShow), mx = Math.max(0.01, ...show.map((x) => Math.min(1, Math.abs(x.impact))));
  const row = (x: Q.SalesFactor) => { const w = (Math.min(1, Math.abs(x.impact)) / mx) * 50, neg = x.impact < 0;
    return `<div class="fac-row ${neg ? 'down' : 'up'}" data-key="${x.key}"><div class="fac-h"><b>${esc(x.name)}</b><b class="fac-v">${sign(x.impact)}${Math.round(Math.abs(x.impact) * 100)}%</b></div>
      <div class="fac-bar"><i></i><u style="width:${w.toFixed(1)}%"></u></div>
      <small class="hint">${esc(x.detail)}${x.fix ? ` · ${esc(x.fix)}` : ''}</small></div>`; };
  return `<div class="card factors-card"><p class="lbl">판매 요인 <small class="hint">이번 달 수요 약 ${num(f.demand)}대 · 기준 상태 대비</small></p>
    ${f.summary ? `<div class="warnbox fac-sum" style="margin-bottom:6px">${esc(f.summary)}</div>` : ''}
    ${show.length ? show.map(row).join('') : '<p class="hint">판매를 크게 깎거나 올리는 요인이 없습니다.</p>'}
    <p class="note">각 요인만 기준 상태(기준가, 인지도 ${pct(config.factors.awareness)}, 광고 없음, 수명 최대, 등급 5, 보통 경쟁 차, 사건 없음)로 바꿔 다시 계산한 판매와 비교한 값입니다. 서로 겹치므로 더해서 읽지 않습니다.</p></div>`;
}

/** 직원 상세: 경력(입사, 능력 꺾은선, 참여한 차, 임원 경력) */
export function careerBlock(s: CarState, staffId: number): string {
  const h = Q.staffHistory(s, staffId);
  if (!h) return '';
  const pts = h.points, w = 300, ht = 60, y0 = Math.min(...pts.map((p) => p.year)), y1 = Math.max(y0 + 1, ...pts.map((p) => p.year)), a0 = Math.max(0, Math.min(...pts.map((p) => p.ability)) - 5), a1 = Math.min(100, Math.max(...pts.map((p) => p.ability)) + 5);
  const xy = (p: { year: number; ability: number }) => `${(((p.year - y0) / (y1 - y0)) * (w - 8) + 4).toFixed(1)},${(ht - 4 - ((p.ability - a0) / Math.max(1, a1 - a0)) * (ht - 8)).toFixed(1)}`;
  const line = pts.length > 1 ? `<svg class="mini career-line" viewBox="0 0 ${w} ${ht}" role="img" aria-label="해마다 능력"><polyline fill="none" stroke="var(--ink)" stroke-width="2" points="${pts.map(xy).join(' ')}"/>${pts.map((p) => `<circle cx="${xy(p).split(',')[0]}" cy="${xy(p).split(',')[1]}" r="3" fill="var(--accent)"/>`).join('')}</svg><p class="hint">${pts.map((p) => `${p.year}년 ${p.ability}`).join(' → ')}</p>` : '';
  const head = h.join === null ? `${Q.dateLabel(h.since).replace(/ \d주$/, '')}부터 기록(이전 버전 저장)` : `${Q.dateLabel(h.join).replace(/ \d주$/, '')} 입사 · ${h.years}년째 · 입사 때 능력 ${h.joinAbility}`;
  const cars = h.cars.length ? `<table class="tbl career-cars"><tr><th>참여한 차</th><th>일</th><th class="r">평론</th><th class="r">판매</th></tr>${h.cars.map((c) => `<tr><td>${esc(c.name)}</td><td>${KIND[c.kind] ?? c.kind}</td><td class="r">${score(c.reviewAvg)}</td><td class="r">${num(c.totalSold)}대</td></tr>`).join('')}</table>` : '<p class="hint">아직 참여해 출시한 차가 없습니다.</p>';
  const ex = h.execs.length ? `<p class="hint">임원 경력: ${h.execs.map((e) => `${e.title} ${Q.dateLabel(e.from).replace(/ \d주$/, '')}~${e.to === null ? '지금' : Q.dateLabel(e.to).replace(/ \d주$/, '')}`).join(', ')}</p>` : '';
  return `<div class="career"><p class="lbl" style="margin-top:14px">경력</p><p class="hint">${esc(head)} · 교육 ${h.trainings}번</p>${line}${cars}${ex}</div>`;
}

/** 10년 회고 신문(창 본문). 닫기 버튼은 closeReview(기존 신문 창과 같은 동작) */
export function decadePaper(s: CarState, decade: number, logoHtml = ''): string {
  const r = Q.decadeReview(s, decade), li = (xs: string[]) => (xs.length ? `<ul class="yr-list">${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="hint">없음</p>');
  const body = [
    `${decade}년부터 ${decade + 9}년까지 ${num(r.sold)}대를 팔았다${r.revenue !== null ? `. 매출 ${money(r.revenue)}, 이익 ${money(r.profit!, true)}` : ''}.`,
    r.launches.length ? `이 기간에 ${r.launches.length}대를 새로 냈고, 평론이 가장 좋았던 차는 ${r.best!.name}(${score(r.best!.review)}점)이다.` : '이 기간에 새로 낸 차는 없다.',
    r.repChange !== null ? `평판은 ${sign(r.repChange)}${Math.abs(r.repChange).toFixed(1)} 움직여 지금 ${Math.round(r.reputation)}이다.` : `평판은 지금 ${Math.round(r.reputation)}이다.`,
  ].join(' ');
  return `<div class="eyebrow"><i></i>${decade}년대를 돌아보며</div><div class="news paper decade-paper"><div class="mast"><span>모터 데일리</span><span>${decade + 10}년 1월</span></div><h3>${esc(r.headline)}</h3><p>${esc(body)}</p>${logoHtml ? `<div class="rv me-by">${logoHtml}<span>${esc(s.companyName)}</span></div>` : ''}</div>
    <div class="yr-cols"><section><p class="lbl">국내 점유율(추정)</p><table class="tbl"><tr><td><b>${esc(s.companyName)}</b></td><td class="r"><b>${(r.share * 100).toFixed(1)}%</b></td></tr>${r.rivals.map((x) => `<tr><td>${esc(x.name)}</td><td class="r">${(x.share * 100).toFixed(1)}%</td></tr>`).join('')}</table>
      <p class="lbl">새로 낸 차</p>${li(r.launches)}</section>
    <section><p class="lbl">그 10년의 사건</p>${li(r.events)}<p class="lbl">다음 10년 예고</p>${li(r.next)}</section></div>
    <button class="go dark" data-act="closeReview">닫기</button>`;
}

/** 기록 탭: 지난 10년 회고 다시 보기 버튼(없으면 빈 문자열) */
export function decadeButtons(s: CarState): string {
  const ds = Q.decadeYears(s);
  return ds.length ? `<div class="card decades-card"><h3>10년 회고 <small class="hint">${ds.length}건</small></h3><div class="yr-years">${ds.map((d) => `<button class="btn" data-act="decadeOpen" data-v="${d}"><b>${d}년대</b><small>${num(Q.decadeReview(s, d).sold)}대 판매</small></button>`).join('')}</div></div>` : '';
}

/** 차고 '다음 단계' 카드 안: 실패한 차의 수습(대상일 때만 보인다) */
export function rescueBlock(s: CarState, generationId: number): string {
  const r = Q.rescueOptions(s, generationId);
  if (!r || (r.target && !r.clearance.ok)) return '';
  const fx = r.fix, cl = r.clearance;
  return `<hr><div class="rescue"><p class="lbl">실패한 차의 수습</p>
    <div class="row"><button class="btn" data-act="quickFix" data-id="${generationId}" ${fx.ok ? '' : 'disabled'}>긴급 개선 · ${money(fx.cost)}</button><button class="btn" data-act="clearance" data-id="${generationId}" ${cl.ok ? '' : 'disabled'}>가격 인하 판매</button></div>
    ${fx.ok ? '' : `<p class="note why">긴급 개선: ${esc(fx.reason ?? '')}</p>`}${cl.ok ? '' : `<p class="note why">가격 인하 판매: ${esc(cl.reason ?? '')}</p>`}</div>`;
}

/** 수습 확인 창 문구(예상 효과) */
export function rescueConfirm(s: CarState, generationId: number, kind: 'quickFix' | 'clearance'): string {
  const r = Q.rescueOptions(s, generationId);
  if (!r) return '';
  if (kind === 'quickFix') { const f = r.fix, n = f.team.length;
    return `긴급 개선: 쉬는 테스터·엔지니어 ${n}명이 ${f.weeks}주 동안 이 차의 결함을 잡고 품질을 조금 올린 개선판을 냅니다. 예상 비용 ${money(f.cost)}(${f.weeks}주에 나눠 냄), 개발팀 하나를 씁니다. 리콜 위험 연 ${pct(f.recallNow)} → ${pct(f.recallAfter)}, 품질 등급 ${score(f.qNow)} → ${score(f.qAfter)}. 평론은 다시 받지 않고 인지도·수명은 그대로입니다. 세대당 한 번만 할 수 있습니다.`; }
  const c = r.clearance;
  return `가격 인하 판매: 값을 시장 기준가의 ${pct(c.pct)}(${num(c.price)}만원)로 ${c.months}개월 고정하고 광고를 더해 재고를 정리합니다. 예상 월 판매 ${num(c.salesNow)}대 → ${num(c.salesAfter)}대, 예상 월 이익 ${money(c.profitNow, true)} → ${money(c.profitAfter, true)}. ${c.months}개월 뒤 자동으로 단종하며, 단종에 따른 평판 감점은 없습니다. 그동안 값을 바꾸거나 페이스리프트할 수 없습니다.`;
}
