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

/** 연말 신문: 연대기에서 그해의 소식을 골라 1면을 만든다(연말 결산 기록이 있는 해만) */
export interface Paper { year: number; headline: string; subs: { m: number; text: string }[]; numbers: [string, string][]; quote: string }
const PRIORITY: Record<string, number> = { rival: 75, major: 70, era: 65, record: 60, milestone: 55, contract: 50, rights: 45, release: 40, achievement: 35, event: 30, invest: 28 };
const HEAD = (kind: string, text: string): string => {
  if (kind === 'rival' && text.endsWith('파산')) return `${text.slice(0, -3)}, 끝내 파산… 항공 시장 요동`;
  if (kind === 'rival') return `${text}… 시장에 새 도전자`;
  if (kind === 'major') return `${text}… 업계 긴장`;
  if (kind === 'record') return `${text}, 사상 최고 경신`;
  if (kind === 'era') return `${text}… 업계는 비상`;
  if (kind === 'contract') return text.startsWith('계약 성사') ? `${text.replace(/ \(보상.*\)$/, '')}, 큰 보상 챙겼다` : text;
  return text;
};
const GOOD = ['“기내식이 맛있었어요. 다음에도 이 항공사를 탈게요.” — 서울발 승객', '“정시에 도착해서 회의에 늦지 않았습니다.” — 출장 중인 회사원', '“창밖으로 보이는 노을이 정말 근사했어요.” — 첫 해외여행 승객', '“승무원이 아이에게 비행기 모형을 줬어요.” — 가족 여행객', '“이 노선이 생겨서 고향에 자주 갑니다.” — 유학생', '“좌석이 편해서 푹 잤습니다.” — 장거리 승객'];
const BAD = ['“요즘 지연이 잦아서 걱정이에요.” — 단골 승객', '“가격이 조금만 내려가면 더 자주 탈 텐데요.” — 출장 중인 회사원', '“환승이 너무 빡빡했습니다.” — 여행객', '“경쟁 항공사가 더 싸더라고요.” — 학생 승객', '“그래도 이 항공사를 응원합니다.” — 오랜 단골', '“내년에는 더 나아지겠죠.” — 공항 직원'];
export function newspaper(g: Game, year: number): Paper | null {
  const c = g.state.chronicle, ye = c.find((e) => e.kind === 'year' && e.m === year * 12);
  if (!ye?.d) return null;
  const prev = c.find((e) => e.kind === 'year' && e.m === (year - 1) * 12)?.d;
  const items: { m: number; text: string; p: number }[] = c.filter((e) => e.m > (year - 1) * 12 && e.m <= year * 12 && PRIORITY[e.kind] !== undefined).map((e) => ({ m: e.m, text: HEAD(e.kind, e.text), p: PRIORITY[e.kind] }));
  const { rank, total } = ye.d;
  if (total >= 3) { // 매출 순위 소식
    if (rank === 1 && prev?.rank !== 1) items.push({ m: year * 12, text: prev ? '우리 항공사, 업계 매출 1위로 올라서다' : '창업 첫해부터 업계 매출 1위', p: 100 });
    else if (prev && rank < prev.rank) items.push({ m: year * 12, text: `우리 항공사, 매출 순위 ${prev.rank}위에서 ${rank}위로 도약`, p: 85 });
    else if (prev && rank > prev.rank) items.push({ m: year * 12, text: `매출 순위 ${rank}위로 밀려난 우리 항공사… 반격이 필요하다`, p: 80 });
    else items.push({ m: year * 12, text: `업계 ${rank}위를 지킨 우리 항공사`, p: 30 });
  }
  if (!items.length) items.push({ m: year * 12, text: ye.d.profit >= 0 ? '조용하지만 알찬 한 해, 우리 항공사 흑자 유지' : '어려운 한 해를 보낸 우리 항공사', p: 1 });
  items.sort((a, b) => b.p - a.p || a.m - b.m);
  const d = ye.d, fm = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(0)}M`, pool = d.profit >= 0 ? GOOD : BAD;
  return {
    year, headline: items[0].text, subs: items.slice(1, 5).map((x) => ({ m: x.m, text: x.text })),
    numbers: [['한 해 이익', fm(d.profit)], ['한 해 매출', fm(d.revenue)], ['수송 승객', `${Math.round(d.pax).toLocaleString('en-US')}명`], ['항공기', `${d.planes}대`], ['취항 도시', `${d.cities}곳`], ['매출 순위', `${d.rank}위 / ${d.total}곳`]],
    quote: pool[(year * 7 + Math.floor(Math.abs(d.profit))) % pool.length],
  };
}

/** 알림 한 줄의 종류(알림 탭 필터용): 경쟁 / 시대·신기종 / 계약·업적 / 그 밖의 경영 */
export type LogKind = 'rival' | 'era' | 'goal' | 'biz';
export function logKind(text: string): LogKind {
  const t = text.replace(/^\d+개월차: /, '');
  if (/^(신생 항공사|대형 항공사|.*파산했습니다|.*운임 전쟁|.*경매|.*노선에 진출)/.test(t) || /(제휴|경쟁사)/.test(t)) return 'rival';
  if (/(시대|신기종|예고 —|개막|호황기)/.test(t)) return 'era';
  if (/(계약|업적|이정표)/.test(t)) return 'goal';
  return 'biz';
}
