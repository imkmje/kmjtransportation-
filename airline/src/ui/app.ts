import { config } from '../config';
import { AIRCRAFT, CITIES, EVENTS, SCENARIOS, cityById, scenarioById, typeById } from '../data';
import { Game, type GameOptions } from '../sim/game';
import type { City, Competitor, Difficulty, Plane, Route } from '../sim/types';
import { baseFare, canFly, distanceKm, maxWeeklyRoundTrips, rawMonthlyDemand } from '../sim/model';
import { fillFare } from '../sim/strategies';
import { advise, type Advice } from '../sim/advice';
import { ACHIEVEMENTS, LADDERS, achieved, nextSteps, reachedSteps } from '../sim/achievements';
import { AIR_VERSION } from '../version';
import { createMapView } from './mapview';
import { icon } from './icons';
import { musicOn, play, renderPeaks, setMusic, setSound, setVolumes, soundOn, volumes, type Sfx } from './sound';
import { bestWorst, logKind, newspaper, routeMonthStats, type LogKind } from '../sim/report';
import { deleteSlot, exportText, loadSlot, parseImport, saveSlot, slotInfos } from './saves';
import { LOCKED_BASES, UNLOCK_NEED, addAch, baseUnlocked, lifetime, startBonus, titleOf } from './profile';
import { esc, eulReul, fare, km, money, num, pct } from './fmt';

type Tab = 'map' | 'routes' | 'fleet' | 'rivals' | 'money' | 'news';
const SAVE_KEY = 'the-air-save';
const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const HINT_KEY = 'the-air-hints';
const REC_KEY = 'the-air-records';
const DIFF_NAME: Record<Difficulty, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };
interface Rec { score: number; status: string; months: number; base: string; diff: Difficulty; when: string }
const SECONDS_PER_DAY = 3; // 1× 속도에서 하루가 흐르는 실제 시간

/** 작은 선 그래프(값 배열 → SVG). zero가 true면 0선을 그린다 */
function spark(values: number[], color: string, opts: { zero?: boolean; min?: number; max?: number } = {}): string {
  if (values.length < 2) return '<div class="hint">하루가 지나면 그래프가 나옵니다.</div>';
  const mn = opts.min ?? Math.min(0, ...values), mx = opts.max ?? Math.max(0.0001, ...values), W = 300, H = 56;
  const y = (v: number) => (H - 4 - ((v - mn) / (mx - mn || 1)) * (H - 8)).toFixed(1);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${y(v)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="spark" preserveAspectRatio="none">${opts.zero ? `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#9fb0bf" stroke-dasharray="3 3"/>` : ''}<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/></svg>`;
}

const $ = <T extends HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s)!;

export function startApp(): void {
  let game = new Game(1);
  let tab: Tab = 'map';
  let reportMonth = -1;
  let selCity: string | null = null, selRoute: number | null = null, selPlane: number | null = null, selComp: number | null = null, reportOpen = false, alertsOpen = false;
  let drawer: 'min' | 'half' | 'full' = 'half', lastSpeed = 1, resumeAfterFull = false; // 아래 서랍 높이, 마지막으로 고른 배속(크게 펼쳤다 닫으면 이 배속으로 다시 시작)
  const tsort: Record<string, { k: string; d: number }> = { routes: { k: 'profit', d: -1 }, fleet: { k: 'cond', d: 1 }, rivals: { k: 'rev', d: -1 } }; // 표마다 정렬 열과 방향
  let speed = 0, acc = 0, last = performance.now(), lastMonth = 0, prevLog = 0;
  let toastTimer = 0, seenLog = 0, seenEvents = new Set<string>();
  let hintsOn = (() => { try { return localStorage.getItem(HINT_KEY) === 'on'; } catch { return false; } })();
  let autoPause = (() => { try { return localStorage.getItem('the-air-autopause') !== '0'; } catch { return true; } })();

  const panel = $('#panel'), top = { date: $('#date'), cash: $('#cash'), rep: $('#rep') };
  const toast = (msg: string, ms = 2600) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove('show'), ms); };

  // ---- 저장 ----
  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.toJSON())); } catch { /* 저장 불가 환경 */ } };
  const hasSave = (): boolean => { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } };
  /** 불러온 게임으로 갈아탄다(화면 상태도 함께 초기화) */
  const adopt = (g: Game) => { game = g; lastMonth = game.monthsPassed; seenLog = game.state.log.length; seenEvents = new Set(); achSeen = new Set(achieved(game)); addAch(achSeen.size ? [...achSeen] : []); msSeen = new Set(reachedSteps(game)); recorded = game.state.status !== 'playing'; };
  const load = (): boolean => {
    try { const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false; adopt(Game.fromJSON(JSON.parse(raw))); return true; } catch { toast('저장 파일을 불러오지 못했습니다'); return false; }
  };

  const map = createMapView($<HTMLCanvasElement>('#map'), () => game, {
    onCity: (id) => { selCity = id; selRoute = null; if (id) { tab = 'map'; if (drawer === 'min') setDrawer('half'); } syncMap(); render(); },
    onRoute: (id) => { selRoute = id; selCity = null; tab = 'routes'; if (drawer === 'min') setDrawer('half'); syncMap(); render(); },
  });
  const CL: Record<string, string> = { all: '전부', mine: '겹침만', subs: '자회사만', off: '끔' }, CL_KEY = 'the-air-complayer';
  let compLayer = (() => { try { const v = localStorage.getItem(CL_KEY); return v && CL[v] ? v : 'all'; } catch { return 'all'; } })();
  const syncLayer = () => { map.setCompMode(compLayer as 'all'); $('#complayer').textContent = `경쟁사 노선: ${CL[compLayer]}`; };
  $('#complayer').addEventListener('click', () => { const ks = Object.keys(CL); compLayer = ks[(ks.indexOf(compLayer) + 1) % ks.length]; try { localStorage.setItem(CL_KEY, compLayer); } catch { /* 저장 불가 */ } syncLayer(); });
  syncLayer();
  const syncMap = () => { const pr = tab === 'fleet' && selPlane !== null ? game.state.planes.find((p) => p.id === selPlane)?.routeId ?? null : null; map.select(selCity, selRoute ?? pr); map.focusComp(tab === 'rivals' ? selComp : null); };

  // ---- 위쪽 바 ----
  function renderTop() {
    const s = game.state;
    top.date.textContent = `${Math.floor(game.monthsPassed / 12) + 1}년차 ${MONTH_NAMES[game.month - 1]} ${(s.day % config.daysPerMonth) + 1}일`;
    top.cash.textContent = money(s.cash);
    top.cash.classList.toggle('neg', s.cash < 0);
    top.rep.textContent = `평판 ${pct(s.reputation)} · 정시 ${pct(game.avgOtp)}`;
    const eco = $('#eco'); eco.innerHTML = `경기 ${game.economyLabel}${s.economy > 1.02 ? ` ${icon('up', 13)}` : s.economy < 0.98 ? ` ${icon('down', 13)}` : ''}`; eco.className = game.economyLabel === '호황' ? 'good' : game.economyLabel === '불황' ? 'bad' : '';
    const fu = $('#fuel'); fu.innerHTML = `연료 ${game.fuelLabel}${s.hedge ? ' (계약)' : s.fuel > 1.04 ? ` ${icon('up', 13)}` : s.fuel < 0.96 ? ` ${icon('down', 13)}` : ''}`; fu.className = game.fuelLabel === '비쌈' && !s.hedge ? 'bad' : game.fuelLabel === '저렴' ? 'good' : '';
    renderAlerts();
    document.querySelectorAll<HTMLElement>('#speeds button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === speed));
  }

  // ---- 알림 띠(지도 위에 항상 보임)와 탭 표시 ----
  function renderAlerts() {
    const s = game.state, el = $('#alerts');
    const unread = s.log.slice(seenLog).filter((l) => /사건|전쟁|진출|파산|인수|합병|계약|이야기|라이벌|고장|도전|대출|신기종|시대/.test(l)).length, open = s.events.filter((e) => { const d = EVENTS.find((x) => x.id === e.def)!; return !!d.option && !e.handled; }).length;
    const newsBtn = $('#tabs button[data-tab="news"]');
    const n = tab === 'news' ? 0 : Math.max(unread, open);
    if (n > 0) newsBtn.dataset.badge = n > 9 ? '9+' : String(n); else delete newsBtn.dataset.badge; // 중요한 알림만 센다
    const html = s.events.map((e, i) => {
      const def = EVENTS.find((x) => x.id === e.def)!, key = `${e.def}:${e.city ?? ''}:${s.day - (def.months - e.monthsLeft) * config.daysPerMonth}`, fresh = !seenEvents.has(key);
      return `<div class="chip${fresh ? ' new' : ''}" data-key="${key}"><span>${icon('alert', 18)}</span><div class="grow" data-act="goNews"><b>${esc(def.name)}${e.city ? ` · ${esc(cityById(e.city).name)}` : ''}</b> <small>${e.monthsLeft}개월 남음${e.handled ? ' · 대응함' : ''}</small></div>${def.option && !e.handled ? `<button data-act="respond" data-id="${i}" ${no(s.cash < game.eventCost(def), short(game.eventCost(def)))}>${esc(def.option.label)} ${money(game.eventCost(def))}</button>` : ''}</div>`;
    }).join('');
    const many = s.events.length > 1;
    const out = !many ? html : alertsOpen ? html + `<div class="chip" data-act="alertsToggle"><div class="grow"><small>사건 ${s.events.length}건 접기</small></div></div>` : `<div class="chip" data-act="alertsToggle"><span>${icon('alert', 18)}</span><div class="grow"><b>진행 중인 사건 ${s.events.length}건</b> <small>${s.events.map((e) => esc(EVENTS.find((x) => x.id === e.def)!.name)).join(' · ')}</small></div><button class="ghost">펼치기</button></div>`;
    if (el.innerHTML !== out) { el.innerHTML = out; el.querySelectorAll<HTMLElement>('.chip').forEach((c) => seenEvents.add(c.dataset.key!)); }
  }
  $('#alerts').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-act="alertsToggle"]')) { alertsOpen = !alertsOpen; renderAlerts(); return; }
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]'); if (!b) return;
    if (b.dataset.act === 'goNews') { tab = 'news'; seenLog = game.state.log.length; lastHtml = ''; render(); }
    else if (b.dataset.act === 'respond') { const r = game.respondEvent(Number(b.dataset.id)); if (!r.ok) return err(r.error); toast('사건에 대응했습니다'); lastHtml = ''; render(); }
  });

  // ---- 패널 내용 ----
  /** 배정을 시도하고, 슬롯이 모자라면 창을 옮기지 않고 그 자리에서 합계 금액을 보여 주고 확인받아 사서 배정한다 */
  async function assignOffer(planeId: number, routeId: number, weekly: number): Promise<boolean> {
    const r = game.assign(planeId, routeId, weekly);
    if (r.ok) return true;
    if (!r.error.includes('슬롯')) { err(r.error); return false; }
    const sf = game.slotShortfall(planeId, routeId, weekly);
    if (!await ask(`슬롯이 모자랍니다. ${sf.needs.map((x) => `${cityById(x.city).name} ${x.n}개`).join(', ')}를 ${money(sf.cost)}에 사고 배정할까요?\n(슬롯마다 월 임대료 ${money(config.slot.lease)})`)) return false;
    const r2 = game.assignBuyingSlots(planeId, routeId, weekly);
    if (!r2.ok) { err(r2.error); return false; }
    play('buy'); return true;
  }
  /** 누를 수 없는 버튼: disabled로 꺼 두면 눌러도 반응이 없으므로, 회색으로 보이게 하고 눌렀을 때 이유를 알려 준다 */
  const no = (cond: boolean, why: string) => (cond ? ` data-why="${esc(why)}"` : '');
  const short = (need: number) => `현금이 모자랍니다 (필요 ${money(need)}, 지금 ${money(game.state.cash)})`;
  /** 화면 안에서 묻는 확인 창. 브라우저 기본 창은 열려 있는 동안 소리(배경 음악)가 끊겨서 쓰지 않는다. 묻는 동안 시간은 멈춘다 */
  function ask(msg: string): Promise<boolean> {
    if ((window as unknown as { __airYes?: boolean }).__airYes) return Promise.resolve(true); // 자동 점검용
    return new Promise((res) => {
      const sp = speed; speed = 0; renderTop();
      const d = document.createElement('div'); d.id = 'ask'; d.innerHTML = `<div class="box"><p>${esc(msg).replace(/\n/g, '<br>')}</p><div class="btnrow"><button class="ghost" data-v="0">취소</button><button data-v="1">확인</button></div></div>`;
      d.addEventListener('click', (e) => { const v = (e.target as HTMLElement).closest('button')?.dataset.v; if (v === undefined) return; d.remove(); speed = sp; renderTop(); res(v === '1'); });
      document.body.append(d);
    });
  }
  const err = (m: string) => { play('error'); toast(m); };
  const HELP_HTML = `<h4>기본 흐름</h4><ul><li>지도에서 도시를 눌러 <b>노선을 열고</b>, 노선 탭에서 <b>항공기를 배정</b>한 뒤 시간을 흘립니다. 노선 화면의 <b>항공기 추가</b>에서 기종 추천(추정)을 보고 바로 살 수 있습니다.</li><li><b>운임</b>이 높으면 손님이 줄고, 낮으면 자리가 모자랍니다. 탑승률 85~95%가 대체로 좋습니다. 노선 탭의 <b>자동 운임</b>을 켜면 매주 알아서 맞춥니다.</li><li>현황 탭의 <b>지금 할 일</b>을 눌러 보세요. 문제와 기회를 급한 순서로 알려 줍니다.</li></ul>
<h4>공항과 허브</h4><ul><li><b>슬롯</b>: 공항마다 하루 이착륙 한도가 있습니다. 꽉 차면 지연이 늘고, 모자라면 그 자리에서 사고 배정할 수 있습니다.</li><li><b>허브·환승</b>: 한 도시에 노선이 모이면 수요가 늘고, 직항이 없는 도시 사이 손님이 우리 허브에서 갈아탑니다.</li><li><b>허브 투자</b>(도시 화면): 터미널 확장(슬롯·지연), 정비 기지(정비 상태), 프리미엄 라운지(비즈니스 수요). 단계마다 월 운영비가 듭니다.</li><li><b>정시율</b>이 낮으면 손님이 줄고 보상금이 나갑니다. 원인은 슬롯 혼잡·정비 상태·폭설·파업입니다.</li><li><b>지역 운수권</b>(자유 모드, 켰을 때): 처음엔 출발 도시가 속한 지역만 열려 있고, 돈과 누적 이익을 갖추면 다른 지역을 살 수 있습니다. 지도에서 흐린 도시가 아직 못 여는 곳입니다.</li></ul>
<h4>항공기</h4><ul><li><b>새것</b>은 비싸지만 대출 담보가 됩니다. <b>중고</b>는 싸지만 운영비가 더 듭니다. <b>임대</b>는 보증금만 내고 쓰지만 임대료가 비싸고 12개월 약정이 있으며, 나중에 <b>매입</b>할 수 있습니다.</li><li><b>신기종</b>은 시간이 지나며 출시됩니다(6개월 전에 발표). 기단 탭의 "곧 출시"에서 볼 수 있습니다. 신형은 같은 좌석당 운영비가 낮습니다.</li><li><b>정비 상태</b>가 45% 아래면 고장 위험이 있습니다. 재무 탭의 <b>자동 정비</b>를 켜 둘 수 있습니다. 7년이 넘은 기체는 점검해도 100%까지 회복되지 않고, 상한이 낮아지면 교체를 권합니다.</li><li>장거리는 <b>비즈니스석</b>, 먼 대도시 사이는 <b>화물기</b>가 잘 벌립니다.</li></ul>
<h4>돈</h4><ul><li><b>대출</b>은 한도를 많이 쓸수록 이율이 오르고, 불황에는 은행이 대출을 멈춥니다.</li><li><b>연료 계약</b>은 지금 가격으로 6개월 고정합니다. <b>회사 업그레이드</b>(재무 탭)는 한 번 사면 계속 이득입니다.</li><li>사건 대응 비용은 시간이 지나고 항공기가 많아질수록 비싸집니다.</li><li>현금이 −$5M 아래로 2개월 이어지면 <b>파산</b>입니다.</li></ul>
<h4>경쟁과 시장</h4><ul><li>같은 노선에 경쟁사가 있으면 손님을 나눠 갖습니다. 가끔 <b>운임 전쟁</b>을 걸어옵니다. <b>제휴</b>를 맺으면 그 항공사는 손님을 덜 빼앗고 전쟁도 하지 않습니다.</li><li>경쟁사는 새로 생기고 망합니다. 망하면 항공기가 반값쯤에 <b>경매</b>로 나옵니다(현황 탭).</li><li><b>대형 항공사</b>는 파산하지 않고 시장과 함께 커지며 내 노선에 들어옵니다. <b>매출 순위</b>로 겨뤄 보세요.</li></ul>
<h4>계약·시대·행사</h4><ul><li><b>계약 제안</b>(현황 탭)은 보상이 크고, 못 해도 평판이 조금 깎일 뿐입니다. 부담 없이 받아 보세요.</li><li><b>시대</b>가 몇 해마다 바뀝니다(유가 위기·탄소세·소음 규제 등). 6개월 전에 예고합니다.</li><li><b>올림픽·월드컵·축제</b>는 6개월 전에 예고되고, 열리면 개최 도시 노선의 수요가 늘어납니다.</li></ul>
<h4>기록</h4><ul><li><b>연대기</b>와 <b>연말 신문</b>(메뉴)에 회사의 역사가 쌓입니다. <b>통계</b>에서 손익과 노선별 성적을 봅니다.</li><li><b>저장 관리</b>(메뉴): 저장 칸 3개와 파일 내보내기. 사파리는 일주일 넘게 안 쓰면 저장이 지워질 수 있으니, 가끔 파일로 내보내거나 홈 화면에 추가해 두세요.</li><li>업적을 모으면 <b>칭호</b>가 오르고, 자유 모드 시작 자금 보너스와 도전 출발지가 열립니다.</li></ul>
<h4>조작</h4><ul><li>스페이스: 정지/재생 · 1·2·3: 배속 · Esc: 선택 해제</li><li>지도: 두 손가락으로 확대·이동. 아래 서랍은 접기·절반·크게로 높이를 바꿉니다(크게 펼치면 시간이 멈추고, 흐르던 중이었다면 내려올 때 그 배속으로 다시 흐름). 오른쪽 아래 화살표 버튼으로 패널 접기</li><li>하단 탭을 누르면 그 탭의 첫 화면으로 돌아갑니다. 누를 수 없는 버튼은 눌러 보면 이유를 알려 줍니다.</li></ul><h4>화면</h4><ul><li>지도 아래 <b>서랍</b>에 탭(현황·노선·기단·경쟁사·재무·알림)이 있습니다. 오른쪽 위 <b>접기·절반·크게</b>나 가운데 손잡이를 끌어 높이를 바꿉니다.</li><li><b>크게</b>를 누르면 시간이 멈추고, 흐르던 중이었다면 내려올 때 그 배속으로 다시 흐릅니다. 크게 상태에서 위쪽 지도 띠를 누르면 접힙니다.</li><li>노선·기단·경쟁사는 <b>표</b>입니다. 열 제목을 누르면 정렬, 줄을 누르면 오른쪽에 상세가 열립니다. 아무것도 안 골랐을 때 오른쪽에는 요약(할 일·상위·하위)이 나옵니다.</li></ul>
<h4>점유율과 경쟁 대응</h4><ul><li>노선 표의 점유율 막대는 우리(파랑)와 경쟁사별 몫입니다. ▲▼는 지난달 대비 변화입니다.</li><li>노선 상세의 <b>경쟁 대응</b>: 상대 운임에 맞추기, 맞대응 광고(3개월), 점유율 우선 운임(경쟁사 최저가보다 5% 싸게, 매주), 서비스 등급(고급·최고급, 항공기당 월 비용).</li><li>노선 상세 맨 아래 <b>상세 지표</b>에 최근 12개월 이익·점유율 추이가 있습니다.</li></ul>
<h4>자회사</h4><ul><li>경쟁사 탭에서 회사를 고르면 <b>지분 20%</b>(배당만)나 <b>자회사 51%</b>(운영 방향: 확장·수익·공세)를 살 수 있습니다(자유 모드).</li><li>지분을 가진 회사는 내 노선에서 손님을 덜 빼앗고 운임 전쟁을 걸지 않습니다. 자금난이면 증자를 요청하고, 무시해 파산하면 평판이 떨어집니다.</li><li>배당은 재무 탭 <b>배당 내역</b>과 월말 정산에서 봅니다. 지분 매각·완전 흡수도 할 수 있습니다.</li></ul>
<h4>기단 관리</h4><ul><li>항공기 카드의 <b>교체 추천</b>: 같은 노선에서 새 기종으로 바꾸면 월 이익이 얼마 늘고 몇 달 만에 본전인지 보여 주고, 한 번에 교체합니다(지금 기체는 매각·반납).</li><li>항공기에 <b>이름</b>을 붙이고, 기단 탭 위쪽에서 <b>도색</b>(지도의 내 비행기 색)을 고릅니다.</li></ul>
<h4>자유 모드의 즐길 거리</h4><ul><li><b>전세기 주문</b>(현황 탭): 노는 항공기를 몇 달 보내고 매달 돈을 받습니다. <b>입찰</b>: 공항 운영권(5년간 슬롯·착륙료 혜택)과 신공항 슬롯을 경쟁사와 값을 불러 다툽니다.</li><li><b>마일리지</b>·<b>대형 사업</b>(전용 터미널·정비 단지·항공 학교)은 재무 탭, <b>동맹</b>(3곳까지)은 경쟁사 탭, <b>선주문</b>·<b>기종 도감</b>은 기단 탭에 있습니다.</li><li>노선마다 <b>고객 별점</b>이 있고 수요에 영향을 줍니다. 경쟁사가 없는 도시에 처음 취항하면 6개월간 <b>첫 취항 보너스</b>. 해마다 <b>항공 시상식</b>이 열리고, 통계에 <b>개인 기록</b>이 쌓입니다. 메뉴의 <b>성장 타임랩스</b>로 노선망이 커 온 모습을 봅니다.</li><li>태풍·화산재 같은 재난, 영화 촬영·유명인 탑승, 이어지는 이야기(노조 재협상 등)도 생깁니다.</li></ul><h4>자유 모드의 경쟁과 이야기</h4><ul><li>경쟁사마다 <b>성격</b>(공세형·확장형·서비스형·안정형)이 있고, 매출이 비슷한 곳이 <b>라이벌</b>로 정해집니다(직접 바꿀 수 있어요).</li><li>내 이익이 큰 노선에 경쟁사가 <b>진출을 예고</b>합니다. 제휴를 맺거나 인수하면 막을 수 있어요. 경쟁사끼리 합병하기도 하고, 노선이 많은 도시의 빈 슬롯은 경쟁사가 먼저 차지합니다.</li><li>경쟁사가 있는 노선에서는 노선 화면에서 상대 운임에 맞추거나 <b>맞대응 광고</b>를 낼 수 있습니다.</li><li>가끔 <b>이야기 사건</b>이 생깁니다. 두 선택지 중 하나를 고르면 결과가 갈립니다. 매년 <b>올해의 도전</b>도 하나씩 나옵니다.</li></ul>`;
  function showInfo(title: string, html: string) { $('#info-title').textContent = title; $('#info-body').innerHTML = html; $('#info').hidden = false; }
  const afterLoad = () => { popSeen = new Set(pending().map((p) => p.key)); popQ = []; selCity = selRoute = null; speed = 0; $('#report').hidden = true; prevComp = ''; prevLog = game.state.log.length; syncMap(); lastHtml = ''; render(); };
  /** 저장 관리: 저장 칸 3개, 파일 내보내기·가져오기, 홈 화면 추가 안내 */
  function showSaves() {
    const infos = slotInfos();
    showInfo('저장 관리', `<h4>저장 칸</h4>${infos.map((i) => `<div class="slot"><div><b>칸 ${i.slot}</b><br><small>${i.empty ? '비어 있음' : `${esc(i.when ?? '')} · ${esc(i.summary ?? '')}`}</small></div><div class="btns2"><button data-act="slotSave" data-i="${i.slot}">저장</button>${i.empty ? '' : `<button class="ghost" data-act="slotLoad" data-i="${i.slot}">불러오기</button><button class="ghost" data-act="slotDel" data-i="${i.slot}">삭제</button>`}</div></div>`).join('')}
      <h4>파일로 보관</h4><p class="hint">브라우저 저장소는 사파리에서 일주일 넘게 안 쓰면 지워질 수 있습니다. 파일로 내보내 두면 안전합니다. 평생 업적(칭호·시작 보너스)도 함께 담깁니다.</p>
      <div class="btns row2"><button data-act="exportFile">파일로 내보내기</button><button class="ghost" data-act="importFile">파일에서 가져오기</button></div><div class="btns row2" style="margin-top:8px"><button class="ghost" data-act="copyExport">내용 복사</button></div>
      <h4>홈 화면에 추가</h4><p class="hint">아이패드: 사파리의 공유 버튼 → "홈 화면에 추가". 앱처럼 열리고, 저장도 훨씬 오래 보존됩니다(애플이 홈 화면 앱은 일주일 삭제 규칙에서 제외한다고 밝혔습니다).</p>`);
  }
  const download = (name: string, text: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  async function infoAct(b: HTMLElement) {
    const act = b.dataset.act, i = Number(b.dataset.i);
    if (act === 'paper') showPaper(Number(b.dataset.y));
    else if (act === 'slotSave') { if (slotInfos()[i - 1].empty || await ask(`칸 ${i}의 저장을 덮어쓸까요?`)) { if (saveSlot(i, game)) { toast(`칸 ${i}에 저장했습니다`); play('ok'); } else err('저장하지 못했습니다(브라우저 저장 공간 부족)'); showSaves(); } }
    else if (act === 'slotLoad') { const g = loadSlot(i); if (!g) return err('불러오지 못했습니다'); if (!await ask('지금 하던 게임은 저장하지 않으면 사라집니다. 불러올까요?')) return; adopt(g); $('#info').hidden = true; $('#title').hidden = true; afterLoad(); toast(`칸 ${i}을 불러왔습니다`); }
    else if (act === 'slotDel') { if (await ask(`칸 ${i}의 저장을 지울까요?`)) { deleteSlot(i); showSaves(); } }
    else if (act === 'exportFile') { download(`the-air-${new Date().toISOString().slice(0, 10)}.json`, exportText(game, lifetime())); toast('파일로 내보냈습니다'); }
    else if (act === 'copyExport') { const t = exportText(game, lifetime()); navigator.clipboard?.writeText(t).then(() => toast('내용을 복사했습니다'), () => toast('복사하지 못했습니다. 파일로 내보내기를 써 주세요')); }
    else if (act === 'importFile') $<HTMLInputElement>('#import-file').click();
  }
  $<HTMLInputElement>('#import-file').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (!f) return;
    const r = parseImport(await f.text()); if (!r.ok) return err(r.error);
    if (!await ask('지금 하던 게임은 저장하지 않으면 사라집니다. 파일의 게임을 불러올까요?')) return;
    adopt(r.game); addAch(r.ach); $('#info').hidden = true; $('#title').hidden = true; afterLoad(); toast('파일에서 불러왔습니다');
  });
  /** 통계: 최근 12개월 손익, 노선별 성적, 기종별 현황 */
  function showStats() {
    const s = game.state, h = s.history.slice(-12), sum = (f: (m: typeof h[number]) => number) => h.reduce((a, m) => a + f(m), 0), fm = (v: number) => money(v);
    const rev = sum((m) => m.revenue), cost = sum((m) => m.cost), dep = sum((m) => m.depreciation), fixed = sum((m) => m.fixed), interest = sum((m) => m.interest), profit = sum((m) => m.profit);
    const pnl = h.length ? `<table class="brk"><tr><td>수익(여객·화물)</td><td class="pos">${fm(rev)}</td></tr><tr><td>운영비(연료·착륙료·수수료·보상금)</td><td>−${fm(cost)}</td></tr><tr><td>감가상각</td><td>−${fm(dep)}</td></tr><tr><td>고정비(본사·정비·슬롯·임대·투자·제휴)</td><td>−${fm(fixed)}</td></tr><tr><td>대출 이자</td><td>−${fm(interest)}</td></tr><tr><td><b>이익</b></td><td class="${profit >= 0 ? 'pos' : 'neg'}">${fm(profit)}</td></tr></table><small>최근 ${h.length}개월 합계</small>` : '<p class="hint">첫 달이 끝나면 나옵니다.</p>';
    const rt = routeMonthStats(game).sort((a, b) => b.profit - a.profit), rts = rt.length ? `<table><tr><td><b>노선</b></td><td><b>월 이익</b></td><td><b>탑승률</b></td><td><b>정시</b></td></tr>${rt.map((x) => `<tr><td>${esc(x.label)}</td><td class="${x.profit >= 0 ? 'pos' : 'neg'}">${fm(x.profit)}</td><td>${pct(x.loadFactor)}</td><td>${pct(x.otp)}</td></tr>`).join('')}</table><small>최근 30일 기준, 이익이 큰 순서</small>` : '<p class="hint">운항 중인 노선이 없습니다.</p>';
    const groups = new Map<string, Plane[]>(); for (const p of s.planes) groups.set(p.type, [...(groups.get(p.type) ?? []), p]);
    const fl = groups.size ? `<table><tr><td><b>기종</b></td><td><b>대수</b></td><td><b>평균 나이</b></td><td><b>평균 정비</b></td></tr>${[...groups].map(([t, ps]) => `<tr><td>${esc(typeById(t).name)}${ps.some((p) => p.leased) ? ' (임대 포함)' : ''}</td><td>${ps.length}</td><td>${(ps.reduce((a, p) => a + p.age, 0) / ps.length / 12).toFixed(1)}년</td><td>${pct(ps.reduce((a, p) => a + p.cond, 0) / ps.length)}</td></tr>`).join('')}</table>` : '';
    showInfo('통계', `<h4>손익표</h4>${pnl}<h4>노선별 성적</h4>${rts}<h4>기종별 현황</h4>${fl}<h4>이번 판 기록</h4><table class="brk"><tr><td>운항 기간</td><td>${game.monthsPassed}개월</td></tr><tr><td>누적 이익</td><td>${fm(s.cumProfit)}</td></tr><tr><td>수송한 승객</td><td>${num(Math.round(s.history.reduce((a, m) => a + m.pax, 0)))}명</td></tr><tr><td>취항 도시</td><td>${game.servedCities().size}곳</td></tr><tr><td>매출 순위</td><td>${game.rank()}위 / ${game.state.competitors.length + 1}곳</td></tr></table>${recordsHtml()}`);
  }
  /** 연말 신문 1면 */
  function showPaper(year: number) {
    const p = newspaper(game, year);
    if (!p) return toast('이 해의 신문이 없습니다');
    showInfo(`${year}년차 연말 신문`, `<div class="paper"><div class="mast">The Air 일보</div><div class="dateline">${year}년차 말 · 연말 특집호</div><h2 class="hl">${esc(p.headline)}</h2>${p.subs.length ? `<ul>${p.subs.map((x) => `<li><small>${x.m}개월차</small> ${esc(x.text)}</li>`).join('')}</ul>` : ''}<div class="nums">${p.numbers.map(([k, v]) => `<span>${esc(k)}<b>${esc(v)}</b></span>`).join('')}</div><p class="quote">${esc(p.quote)}</p></div>`);
  }
  /** 연대기: 회사의 주요 사건을 해마다 묶어 보여 준다 */
  /** 성장 타임랩스: 6개월마다 남긴 노선망을 지도에 차례로 보여 준다(재생하는 동안 시간은 멈춤) */
  function playTimelapse() {
    const h = game.state.netHist ?? []; if (h.length < 2) return err('6개월마다 기록이 쌓입니다. 1년쯤 지나면 볼 수 있어요');
    const sp = speed; speed = 0; renderTop(); let i = 0;
    const cities = (r: [string, string][]) => new Set(r.flat()).size, first = h[0], last = h[h.length - 1];
    const step = () => { if (i >= h.length) { map.setOverlay(null, ''); speed = sp; renderTop(); toast(`${Math.floor(last.m / 12) + 1}년 동안 노선 ${first.routes.length}→${last.routes.length}개, 도시 ${cities(first.routes)}→${cities(last.routes)}곳`, 6000); return; } const x = h[i++], prev = new Set((i > 1 ? h[i - 2].routes : []).map(([a, b]) => `${a}|${b}`)); map.setOverlay(x.routes, `${Math.floor(x.m / 12) + 1}년차 ${(x.m % 12) + 1}월 · 노선 ${x.routes.length}개`, x.routes.map(([a, b]) => `${a}|${b}`).filter((k) => i > 1 && !prev.has(k))); window.setTimeout(step, 900); }; // 새로 생긴 노선은 노랗게
    toast('성장 타임랩스 재생'); step();
  }
  function showChronicle() {
    const ent = game.state.chronicle.filter((e) => e.kind !== 'old'), years = [...new Set(ent.map((e) => Math.ceil(e.m / 12)))].sort((a, b) => b - a);
    showInfo('연대기', years.length ? `<div class="chron">${years.map((y) => `<h4><span>${y}년차</span>${game.state.chronicle.some((e) => e.kind === 'year' && e.m === y * 12) ? `<button class="ghost small" data-act="paper" data-y="${y}">연말 신문</button>` : ''}</h4>${ent.filter((e) => Math.ceil(e.m / 12) === y && e.kind !== 'year').sort((a, b) => a.m - b.m).map((e) => `<div class="ln"><small>${e.m}개월차</small>${esc(e.text)}</div>`).join('') || '<div class="ln"><small>조용한 해였습니다</small></div>'}`).join('')}</div>` : '<p class="hint">아직 기록이 없습니다. 이정표·업적·경쟁사 소식·계약·시대 변화가 여기에 쌓입니다.</p>');
  }
  const later = (n: number) => (n <= 0 ? '이번 달' : `${n}개월 뒤`);
  function routeLabel(a: string, b: string) { return `${cityById(a).name} ⇄ ${cityById(b).name}`; }

  let newsFilter: 'all' | LogKind = 'all', newsAll = false;
  let advList: Advice[] = [], achSeen = new Set<string>(), msSeen = new Set<string>(), destSort: 'demand' | 'near' | 'far' | 'season' | 'name' = 'demand', destNew = false;
  const rbuyOpen = new Map<number, boolean>(); // 노선별 '항공기 추가' 펼침 상태(누른 것만 기억)
  const detOpen = new Map<string, boolean>(); // 사용자가 누른 접이식 상태(알림이 와서 화면을 다시 그려도 유지)
  const detKey = (d: HTMLElement) => `${tab}|${selRoute ?? ''}|${selCity ?? ''}|${(d.querySelector('summary')?.textContent ?? '').replace(/[\d.,$%+\-]+/g, '').trim().slice(0, 24)}`;
  const secOpen = new Map<string, boolean>(); // 현황 탭 접이식 구역(사용자가 누른 것만 기억)
  /** <h3> 구역마다 접이식으로 바꾼다. 계약·경매처럼 바로 할 일이 있는 구역만 기본으로 펼친다 */
  const fold = (html: string) => html.split('<h3>').filter(Boolean).map((chunk) => { const i = chunk.indexOf('</h3>'), head = chunk.slice(0, i), key = head.replace(/<[^>]*>/g, '').trim().split(' ')[0]; return `<details class="more sec" data-k="${key}" ${(secOpen.get(key) ?? /^(결정|계약|항공기|이야기|진출|라이벌|올해의|전세기|입찰|대출|대형)/.test(key)) ? 'open' : ''}><summary>${head}</summary>${chunk.slice(i + 5)}</details>`; }).join('');
  /** 현황 탭 위쪽(자유 모드): 전세기 주문, 입찰 */
  function funTop(): string {
    const s = game.state; if (!s.sandbox) return '';
    const idle = s.planes.filter((p) => p.routeId === null && p.shop <= 0 && p.charter === undefined && typeById(p.type).seats > 0);
    const chs = s.charters ?? [], offers = chs.filter((c) => c.planeId === undefined), active = chs.filter((c) => c.planeId !== undefined);
    const cht = chs.length ? `<h3>전세기 주문 <small>${offers.length}건 제안 · ${active.length}건 운항 중</small></h3><div class="list">${active.map((c) => `<div class="row"><div class="grow"><b>${routeLabel(c.a, c.b)}</b><small>운항 중 · 남은 ${c.left}개월 · 월 ${money(c.perMonth)} · ${esc(typeById(game.plane(c.planeId!)?.type ?? 'B737').name)}</small></div></div>`).join('')}${offers.map((c) => { const km0 = distanceKm(cityById(c.a), cityById(c.b)), ok = idle.filter((p) => typeById(p.type).seats >= c.seats && typeById(p.type).range >= km0); return `<div class="rowc"><div class="top"><div class="grow"><b>${routeLabel(c.a, c.b)}</b><small>${km(km0)} · ${c.seats}석 이상 · ${c.months}개월 · 월 <b class="pos">${money(c.perMonth)}</b> · ${Math.max(0, c.expires - game.monthsPassed)}개월 안에 수락</small></div></div>${ok.length ? `<div class="btnrow">${ok.slice(0, 3).map((p) => `<button data-act="charter" data-id="${c.id}" data-p="${p.id}">${esc(p.name ?? typeById(p.type).name)} 보내기</button>`).join('')}</div>` : '<p class="hint">조건에 맞는 노는 항공기가 없습니다(좌석·항속).</p>'}</div>`; }).join('')}</div>` : '';
    const bids = (s.bids ?? []).map((b) => { const lead = b.best?.who === 0, who = b.best ? (b.best.who === 0 ? '우리' : s.competitors.find((c) => c.id === b.best!.who)?.name ?? '경쟁사') : '없음', next = b.best ? b.best.amount + config.extra.bid.step : b.min;
      return `<div class="rowc"><div class="top"><div class="grow"><b>${esc(cityById(b.city).name)} ${b.kind === 'concession' ? '공항 운영권' : `신공항 슬롯 ${b.n}개`}</b><small>${b.kind === 'concession' ? `낙찰되면 5년간 슬롯 +${config.extra.bid.concessionSlots} · 착륙료 −30%` : `낙찰되면 이 공항 슬롯 +${b.n}`} · 최고가 ${b.best ? money(b.best.amount) : '-'}(${esc(who)}) · 경쟁사는 보통 ${money(game.bidValue(b) * 0.8)}~${money(game.bidValue(b) * 1.4)}까지 부릅니다 · ${later(b.ends - game.monthsPassed)} 마감</small></div></div><div class="btnrow"><button data-act="bid" data-id="${b.id}" ${no(lead, '우리가 최고가입니다') + no(!lead && s.cash < next, short(next))}>${lead ? '우리가 최고가' : `${money(next)} 부르기`}</button></div></div>`; }).join('');
    return cht + (bids ? `<h3>입찰 <small>돈은 낙찰될 때 냅니다</small></h3><div class="list">${bids}</div>` : '');
  }
  /** 현황 탭 오른쪽(자유 모드): 시상식 */
  function funRest(): string {
    const s = game.state, a = s.awards?.at(-1); if (!s.sandbox || !a) return '';
    return `<h3>항공 시상식 <small>${a.y}년차</small></h3><div class="list">${Object.entries(a.winners).map(([k, v]) => `<div class="row"><div class="grow"><b>${esc(k)}</b></div><div class="right"><b class="${v === '우리' ? 'pos' : ''}">${esc(v)}</b></div></div>`).join('')}</div><p class="hint">해마다 연말에 정시율·서비스(별점)·성장으로 뽑습니다. 상 하나마다 평판이 오릅니다.</p>`;
  }
  /** 결정을 기다리는 것 전부(마감 빠른 순). 현황 탭 '결정 대기'와 지도 구석 팝업이 같이 쓴다. sec: 현황 탭의 접이식 구역, comp: 경쟁사 탭에서 볼 회사 */
  type Pend = { key: string; kind: string; sec: string; title: string; left: number; cid?: number; comp?: number };
  function pending(): Pend[] {
    const s = game.state, mp = game.monthsPassed, L: Pend[] = [], sd = s.story ? game.storyDef() : undefined;
    if (sd && s.story) L.push({ key: `s${s.story.id}:${s.story.expires}`, kind: '이야기', sec: '이야기', title: sd.title, left: s.story.expires - mp });
    for (const c of s.contracts) if (c.status === 'offer') L.push({ key: `c${c.id}`, kind: '계약', sec: '계약', title: c.title, left: c.expires - mp, cid: c.id });
    for (const c of s.charters ?? []) if (c.planeId === undefined) L.push({ key: `h${c.id}`, kind: '전세기', sec: '전세기', title: routeLabel(c.a, c.b), left: c.expires - mp });
    for (const b of s.bids ?? []) if (b.best?.who !== 0) L.push({ key: `b${b.id}`, kind: '입찰', sec: '입찰', title: `${cityById(b.city).name} ${b.kind === 'concession' ? '공항 운영권' : `신공항 슬롯 ${b.n}개`}`, left: b.ends - mp });
    for (const a of s.auctions) L.push({ key: `a${a.id}`, kind: '경매', sec: '항공기', title: typeById(a.type).name, left: a.expires - mp });
    for (const t of s.threats ?? []) { const c = s.competitors.find((x) => x.id === t.comp); if (c) L.push({ key: `t${t.comp}:${t.a}:${t.b}`, kind: '진출 예고', sec: '진출', title: `${c.name} → ${routeLabel(t.a, t.b)}`, left: t.start - mp }); }
    for (const c of s.competitors) if (c.call) L.push({ key: `k${c.id}:${c.call.expires}`, kind: '증자', sec: '', title: `${c.name} ${money(c.call.amount)}`, left: c.call.expires - mp, comp: c.id });
    return L.sort((x, y) => x.left - y.left);
  }
  const leftTxt = (n: number) => (n <= 0 ? '이번 달' : `${n}개월`);
  /** 결정 대기 항목으로 이동: 경쟁사 증자는 그 회사, 나머지는 현황 탭의 해당 구역을 펼쳐 보여 준다 */
  function goPend(k: string, comp: string | undefined) {
    if (comp) { tab = 'rivals'; selComp = Number(comp); selCity = selRoute = null; }
    else { tab = 'map'; selCity = selRoute = null; secOpen.set(k, true); }
    if (drawer === 'min') setDrawer('half'); syncMap(); lastHtml = ''; render();
    if (!comp) document.querySelector(`#panel details.sec[data-k="${k}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function viewMap(): string {
    const s = game.state;
    if (!selCity) {
      advList = advise(game);
      const advCard = (off: number) => (a: typeof advList[number], i: number) => `<button class="card" data-act="advice" data-i="${i + off}"><div class="row"><div class="grow"><span class="dot ${a.level}"></span>${esc(a.text)}</div></div></button>`;
      const todo = advList.length ? `<h3>지금 할 일 <small>(눌러서 이동)</small></h3><div class="list">${advList.slice(0, 3).map(advCard(0)).join('')}</div>${advList.length > 3 ? `<details class="more"><summary>할 일 ${advList.length - 3}개 더 보기</summary><div class="list">${advList.slice(3).map(advCard(3)).join('')}</div></details>` : ''}` : '';
      const fmtProg = (c: typeof s.contracts[number]) => (c.kind === 'pax' ? `${num(Math.round(c.progress))} / ${num(c.goal)}명` : c.kind === 'otp' ? `${c.progress} / ${c.goal}개월 연속` : c.kind === 'cities' ? `${c.progress} / ${c.goal}곳` : `${money(c.progress)} / ${money(c.goal)}`);
      const offers = s.contracts.filter((c) => c.status === 'offer'), actives = s.contracts.filter((c) => c.status === 'active');
      const conHtml = offers.length || actives.length ? `<h3>계약 제안 <small>(진행 ${actives.length}/${config.contract.maxActive}건)</small></h3><div class="list">${actives.map((c) => `<div class="rowc"><div class="top"><div class="grow"><b>${esc(c.title)}</b><small>진행 ${fmtProg(c)} · ${Math.max(0, (c.start ?? 0) + c.limit - game.monthsPassed)}개월 남음 · 보상 ${esc(c.reward.label)}</small></div></div><div class="bar"><i style="width:${Math.min(100, Math.max(0, (c.progress / c.goal) * 100))}%"></i></div></div>`).join('')}${offers.map((c) => `<div class="rowc"><div class="top"><div class="grow"><b>${esc(c.title)}</b><small>보상 <b class="pos">${esc(c.reward.label)}</b> · 수락 후 ${c.limit}개월 · 제안 ${Math.max(0, c.expires - game.monthsPassed)}개월 남음</small></div></div><div class="btnrow"><button data-act="acceptContract" data-id="${c.id}" ${no(actives.length >= config.contract.maxActive, `진행 중인 계약은 ${config.contract.maxActive}건까지입니다`)}>수락</button><button class="ghost" data-act="declineContract" data-id="${c.id}">거절</button></div></div>`).join('')}</div><p class="hint">달성하면 보상을 받고, 못 해도 평판이 ${Math.round(config.contract.repLoss * 100)}%만 깎입니다. 큰 부담 없이 받아도 됩니다.</p>` : '';
      const eraD = game.eraNow, eraNext = s.nextEra ? config.eras.list.find((x) => x.id === s.nextEra!.id) : null;
      const eraHtml = eraD || eraNext ? `<h3>시대</h3><div class="list">${eraD ? `<div class="row"><div class="grow"><b>${esc(eraD.name)}</b><small>${esc(eraD.desc)}</small></div><div class="right"><b>${Math.max(0, s.era!.end - game.monthsPassed)}개월 남음</b></div></div>` : ''}${eraNext ? `<div class="row" style="opacity:.85"><div class="grow"><b>예고: ${esc(eraNext.name)}</b><small>${esc(eraNext.desc)}</small></div><div class="right"><b>${later(s.nextEra!.start - game.monthsPassed)}</b></div></div>` : ''}</div>` : '';
      const rightsHtml = s.rights ? `<h3>지역 운수권 <small>(${s.rights.length}/${Object.keys(config.rights.regions).length}곳 보유)</small></h3><p class="hint">운수권이 있는 지역의 도시 사이에서만 노선을 열 수 있습니다. 다음 지역을 사려면 누적 이익 ${money(game.rightsNeed)} 이상이 필요하고(지금 ${money(s.cumProfit)}), 가진 지역과 가까울수록 쌉니다. 지도에서 흐린 도시가 아직 못 여는 곳입니다.</p><div class="list">${Object.keys(config.rights.regions).map((r) => { const i = game.regionInfo(r); return `<div class="row"><div class="grow"><b>${esc(i.name)}</b><small>${i.cities.map((c) => esc(cityById(c).name)).join(' · ')}</small></div>${i.owned ? '<b class="pos">보유</b>' : `<button data-act="buyRights" data-region="${r}" ${no(!i.profitOk || !i.cashOk, !i.profitOk ? `누적 이익 ${money(i.need)} 이상이 필요합니다 (지금 ${money(s.cumProfit)})` : short(i.price))}>${money(i.price)}</button>`}</div>`; }).join('')}</div>` : '';
      const fest = s.upcoming.length ? `<h3>예고된 행사</h3><div class="list">${s.upcoming.map((u) => { const d = EVENTS.find((x) => x.id === u.def)!; return `<div class="row"><div class="grow"><b>${esc(d.name)} · ${esc(cityById(u.city).name)}</b><small>${esc(d.text)}</small></div><div class="right"><b>${later(u.start - game.monthsPassed)}</b></div></div>`; }).join('')}</div>` : '';
      const auc = s.auctions.length ? `<h3>항공기 경매 <small>(파산한 경쟁사)</small></h3><div class="list">${s.auctions.map((a) => `<div class="row"><div class="grow"><b>${esc(typeById(a.type).name)}</b><small>${esc(a.from)} · ${Math.floor(a.age / 12)}년 사용 · 정비 ${Math.round(a.cond * 100)}% · ${a.expires - game.monthsPassed}개월 남음</small></div><button data-act="auction" data-id="${a.id}" ${no(s.cash < a.price, short(a.price))}>낙찰 ${money(a.price)}</button></div>`).join('')}</div><p class="hint">새 기체 값의 ${Math.round(config.auction.price * 100)}%입니다. 임대 한도와 상관없이 내 항공기가 됩니다.</p>` : '';
      const rv = rivalryHtml();
      const pd = pending(), pendHtml = pd.length > 1 || pd.some((p) => p.comp !== undefined) ? `<h3>결정 대기 <small>${pd.length}건 · 마감 빠른 순</small></h3><div class="list">${pd.map((p) => `<button class="card" data-act="pend" data-k="${p.sec}" data-id="${p.comp ?? ''}"><div class="row"><div class="grow"><span class="ptag">${p.kind}</span> ${esc(p.title)}</div><div class="right"><small>${leftTxt(p.left)}</small></div></div></button>`).join('')}</div>` : '';
      const compTop = fold(`${pendHtml}${rv.top}${funTop()}${conHtml}${auc}`), compRest = fold(`${eraHtml}${rightsHtml}${fest}${rv.bottom}${funRest()}`);
      if (s.sandbox) {
        const ms = nextSteps(game).map(({ ladder: l, value, next, prev }) => { const fmt = (n: number) => (l.unit === 'M' ? money(n) : `${num(n)}${l.unit}`); return `<div class="ms"><small>${esc(l.name)} ${fmt(value)}${next === null ? ' · 최고 단계 달성' : ` → 다음 이정표 ${fmt(next)}`}</small><div class="bar"><i style="width:${next === null ? 100 : Math.min(100, Math.max(0, ((value - prev) / (next - prev)) * 100))}%"></i></div></div>`; }).join('');
        return `<div class="cols2"><div><h2>현황</h2><p class="hint"><b>자유 모드</b> · ${esc(cityById(s.base).name)} 시작 · 난이도 ${DIFF_NAME[s.difficulty ?? 'normal']}<br>목표와 기한 없이 마음껏 키워 보세요. 파산만 조심하세요.</p>${todo}${compTop}</div><div>${fold(`<h3>이정표</h3>${ms}`)}${compRest}</div></div>`;
      }
      return `<div class="cols2"><div><h2>현황</h2>
        <p class="hint"><b>${esc(game.scenario.name)}</b> · ${esc(cityById(s.base).name)} 시작 · 난이도 ${DIFF_NAME[s.difficulty ?? 'normal']}<br>${esc(game.scenario.desc)}</p>
        <div class="goal"><div><b>목표</b> (${game.scenario.mode === 'all' ? '모두 달성하면 승리' : game.scenario.goals.length > 1 ? '하나만 달성해도 승리' : '달성하면 승리'})</div>
          ${game.goalProgress().map((g) => `<div class="bar"><i style="width:${Math.min(100, Math.max(0, (g.value / g.target) * 100))}%"></i></div><small>${esc(g.label)} ${g.unit === 'M' ? money(g.value) : num(g.value)}${g.unit === 'M' ? '' : g.unit} / ${g.unit === 'M' ? money(g.target) : num(g.target)}${g.unit === 'M' ? '' : g.unit}${g.done ? ` <span class="pos">${icon('check', 13)}</span>` : ''}</small>`).join('')}
          <small>남은 기간 ${Math.max(0, game.scenario.timeLimit - game.monthsPassed)}개월 · 현재 점수 ${num(game.score)}</small></div>
        ${todo}${compTop}</div><div>${compRest}
        <h3>시작하기</h3><ol class="steps"><li>${esc(eulReul(cityById(s.base).name))} 눌러 <b>노선을 엽니다</b>.</li><li>노선 탭에서 <b>항공기를 배정</b>합니다.</li><li>위쪽 <b>1×</b> 버튼을 눌러 시간을 흘리고, <b>운임</b>을 조절해 이익을 냅니다.</li></ol></div></div>`;
    }
    const c = cityById(selCity);
    const selLocked = !game.cityOpen(c.id);
    const dests = CITIES.filter((d) => d.id !== c.id).map((d) => {
      const dist = distanceKm(c, d), ex = s.routes.find((r) => r.open && ((r.a === c.id && r.b === d.id) || (r.a === d.id && r.b === c.id)));
      const demand = rawMonthlyDemand(c, d, game.month) * (1 + config.demand.repBoost * s.reputation), avg = Array.from({ length: 12 }, (_, i) => rawMonthlyDemand(c, d, i + 1)).reduce((a, b) => a + b, 0) / 12;
      return { d, dist, demand, ex, season: demand / (avg * (1 + config.demand.repBoost * s.reputation)) }; // season: 이번 달 수요 ÷ 연평균(1보다 크면 성수기)
    }).filter((x) => !destNew || !x.ex).sort((x, y) => (destSort === 'near' ? x.dist - y.dist : destSort === 'far' ? y.dist - x.dist : destSort === 'season' ? y.season - x.season : destSort === 'name' ? (x.d.name < y.d.name ? -1 : 1) : 0) || y.demand - x.demand);
    const drow = ({ d, dist, demand, ex }: typeof dests[number]) => `<div class="row${ex ? ' clickable' : ''}"${ex ? ` data-act="goRoute" data-id="${ex.id}" title="눌러서 이 노선으로 이동"` : ''}><div class="grow"><b>${esc(d.name)}</b><small>${km(dist)} · 기준 운임 ${fare(baseFare(dist))} · 월 수요 ${num(demand)}명 </small><span class="season" title="1~12월 수요 변화(진한 막대가 이번 달)">${seasonBar(c, d)}</span></div>
        ${ex ? `<button data-act="goRoute" data-id="${ex.id}" class="ghost">운항 중</button>` : selLocked ? `<button class="ghost" ${no(true, `${c.name}은(는) ${game.regionName(c.region)} 지역이라 운수권이 필요합니다. 위의 운수권 구매 버튼을 누르세요.`)}>잠김</button>` : !game.cityOpen(d.id) ? `<button class="ghost" data-act="buyRights" data-region="${d.region}" ${no(!game.regionInfo(d.region).profitOk || !game.regionInfo(d.region).cashOk, !game.regionInfo(d.region).profitOk ? `누적 이익 ${money(game.rightsNeed)} 이상이 필요합니다 (지금 ${money(s.cumProfit)})` : short(game.regionInfo(d.region).price))}>운수권 ${money(game.regionInfo(d.region).price)}</button>` : `<button data-act="open" data-a="${c.id}" data-b="${d.id}">열기</button>`}</div>`;
    const hubX = s.routes.filter((r) => r.open).reduce((a, r) => a + game.transferDemand(r, c.id), 0), hubN = s.routes.filter((r) => r.open && (r.a === c.id || r.b === c.id) && game.planesOn(r.id).length).length;
    const peak = c.peak.months.map((m) => `${m}월`).join('·');
    return `<div class="cols2"><div><h2>${esc(c.name)} <small>${c.id}</small></h2>
      <div class="kv"><div>시장 규모</div><div>인구 ${c.pop}백만 · 소득 ${c.income}배</div><div>시장 성장</div><div>${s.growth[c.id] ? `${(s.growth[c.id] >= 1 ? '+' : '') + Math.round((s.growth[c.id] - 1) * 100)}%` : '0%'}</div><div>활주로</div><div>${num(c.runway)} m</div><div>성수기</div><div>${peak} (수요 ×${c.peak.factor})</div><div>허브 효과</div><div>${game.linksAt(c.id)}개 노선 · 수요 +${Math.round(game.hubBonus(c.id) * 100)}%</div>${hubX > 0 ? `<div>환승 손님</div><div class="pos"><b>월 ${num(hubX)}명</b> <small>(이 도시에서 노선을 갈아타는 손님)</small></div>` : hubN === 1 ? `<div>환승 손님</div><div><small>노선을 하나 더 운항하면 갈아타는 손님이 생깁니다</small></div>` : ''}</div>
      <div class="goal"><div><b>공항 슬롯</b> <small>하루 이착륙 한도</small></div><div class="bar"><i style="width:${Math.min(100, (game.slotsUsed(c.id) / game.slotCapacity(c.id)) * 100)}%"></i></div><small>${game.slotsUsed(c.id).toFixed(1)} / ${game.slotCapacity(c.id)}${(s.slots[c.id] ?? 0) ? ` (구매 ${s.slots[c.id]}개 포함)` : ''}${s.taken?.[c.id] ? ` · <b class="warn">경쟁사가 ${s.taken[c.id]}개 선점</b>` : ''}</small><button data-act="buySlot" data-city="${c.id}" ${no(s.cash < game.slotPrice(c.id), short(game.slotPrice(c.id)))}>슬롯 1개 구매 ${money(game.slotPrice(c.id))} <br><span class="sub">월 임대 ${money(config.slot.lease)}</span></button></div>
      ${game.cityOpen(c.id) ? `<div class="goal"><div><b>허브 투자</b> <small>단계마다 월 운영비 ${money(config.investUpkeep)}</small></div>${(() => { const one = game.hubBulkPlan(c.id, 'one'), max = game.hubBulkPlan(c.id, 'max'); return max.list.length ? `<div class="btnrow"><button class="ghost" data-act="hubBulk" data-city="${c.id}" data-v="one" ${no(s.cash < one.total, short(one.total))}>${one.list.length}종 한 단계씩 ${money(one.total)}</button><button class="ghost" data-act="hubBulk" data-city="${c.id}" data-v="max" ${no(s.cash < max.total, short(max.total))}>모두 최고 단계 ${money(max.total)}</button></div>` : '<p class="hint">모든 허브 투자가 최고 단계입니다.</p>'; })()}${(['terminal', 'mro', 'lounge'] as const).map((kind) => { const k = config.invest[kind], lv = game.hubLevel(c.id, kind), price = game.hubPrice(c.id, kind), allowed = game.linksAt(c.id) >= 1 || c.id === s.base; return `<div class="row" style="margin-top:6px"><div class="grow"><b>${k.name}</b><span class="pips">${[0, 1, 2].map((i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span><small>${k.desc}</small></div>${price === null ? '<small class="pos">최고 단계</small>' : `<button data-act="hub" data-city="${c.id}" data-kind="${kind}" ${no(!allowed || s.cash < price, !allowed ? '이 도시에 취항(항공기 배정)한 뒤에 투자할 수 있습니다' : short(price))}>${money(price)}</button>`}</div>`; }).join('')}</div>` : ''}
      ${s.competitors.filter((k) => k.routes.some((r) => r.a === c.id || r.b === c.id)).map((k) => `<p class="hint">경쟁: <b>${esc(k.name)}</b>이(가) ${esc(c.name)}에 취항 중입니다.</p>`).join('')}
      ${selLocked ? `<div class="goal"><div><b>운수권이 없는 지역</b> <small>${esc(game.regionName(c.region))}</small></div><small>이 도시로 노선을 열려면 ${esc(game.regionName(c.region))} 운수권이 필요합니다.</small><button class="wide" data-act="buyRights" data-region="${c.region}" ${no(!game.regionInfo(c.region).profitOk || !game.regionInfo(c.region).cashOk, !game.regionInfo(c.region).profitOk ? `누적 이익 ${money(game.rightsNeed)} 이상이 필요합니다 (지금 ${money(s.cumProfit)})` : short(game.regionInfo(c.region).price))}>운수권 구매 ${money(game.regionInfo(c.region).price)}</button></div>` : ''}
      </div><div><h3>${esc(c.name)}에서 노선 열기</h3><p class="hint">월 수요는 기준 운임일 때의 값입니다. 먼 거리는 큰 비행기가 필요합니다.</p>
      <div class="chips">${([['demand', '수요 많은 순'], ['near', '가까운 순'], ['far', '먼 순'], ['season', '지금 성수기'], ['name', '이름순']] as const).map(([v, t]) => `<button data-act="destSort" data-v="${v}" class="${destSort === v ? 'on' : ''}">${t}</button>`).join('')}</div><label class="chk"><input type="checkbox" data-act="destNew" ${destNew ? 'checked' : ''}> 이미 운항 중인 노선 제외</label>
      <div class="list">${dests.slice(0, 8).map(drow).join('')}</div>${dests.length > 8 ? `<details class="more"><summary>나머지 도시 ${dests.length - 8}곳 보기</summary><div class="list">${dests.slice(8).map(drow).join('')}</div></details>` : ''}</div></div>`;
  }





  const routeText = (id: number) => { const r = game.route(id); return r ? `${cityById(r.a).name}${cityById(r.b).name}` : ''; };
  /** 표 머리: 열 제목을 누르면 그 열로 정렬(다시 누르면 반대로) */
  function thead(t: string, cols: [string, string][]): string {
    const st = tsort[t];
    return `<div class="thead">${cols.map(([k, label]) => k ? `<button data-act="tsort" data-t="${t}" data-k="${k}" class="${st.k === k ? 'on' : ''}">${label}${st.k === k ? (st.d < 0 ? ' ▼' : ' ▲') : ''}</button>` : `<span>${label}</span>`).join('')}</div>`;
  }
  function tsorted<T>(t: string, rows: T[], val: (x: T, k: string) => number | string): T[] {
    const { k, d } = tsort[t];
    return [...rows].sort((a, b) => { const x = val(a, k), y = val(b, k); return (typeof x === 'string' ? String(x).localeCompare(String(y)) : (x as number) - (y as number)) * d; });
  }
  /** 노선 표의 점유율 칸: 우리와 경쟁사별 몫을 한 막대에 색으로 나누고, 아래에 이름과 % */
  const SHARE_COL = ['#8a6fc0', '#7a8a99', '#c0587a', '#5b6fa8', '#a08a6a']; // 경쟁사는 보라·회색 계열(주황=경고, 청록=자회사, 초록=이익과 겹치지 않게)
  function shareCell(r: Route): string {
    const sh = game.routeShares(r), stakeOf = (id: number) => game.state.competitors.find((c) => c.id === id)?.stake ?? 0;
    const col = (x: typeof sh[number], i: number) => (x.me ? 'var(--accent)' : stakeOf(x.id) >= 0.51 ? '#138a8a' : stakeOf(x.id) > 0 ? '#8fd3d1' : SHARE_COL[(i - 1) % SHARE_COL.length]); // 자회사는 청록(20% 지분은 연한 청록)
    const tag = (x: typeof sh[number]) => (stakeOf(x.id) >= 0.51 ? ' <b class="subtag">자회사</b>' : stakeOf(x.id) > 0 ? ' <b class="subtag lite">지분 20%</b>' : '');
    const m = r.monthly ?? [], dlt = m.length >= 2 ? m.at(-1)!.s - m.at(-2)!.s : 0, trend = Math.abs(dlt) >= 0.01 ? ` <b class="${dlt > 0 ? 'pos' : 'neg'}">${dlt > 0 ? '▲' : '▼'}${Math.round(Math.abs(dlt) * 100)}%p</b>` : '';
    return `<span class="scell"><span class="sbar">${sh.map((x, i) => `<i style="width:${(x.share * 100).toFixed(1)}%;background:${col(x, i)}"></i>`).join('')}</span><small>${sh.map((x, i) => `<span class="nw"><u style="background:${col(x, i)}"></u>${x.me ? '우리' : esc(x.name)}${x.me ? '' : tag(x)} ${pct(x.share)}${x.me ? trend : ''}</span>`).join(' ')}</small></span>`;
  }
  const mbar = (v: number) => `<span class="mbar${v < 0.3 ? ' low' : ''}"><span class="b"><i style="width:${(v * 100).toFixed(0)}%"></i></span>${pct(v)}</span>`;
  function viewRoutes(): string {
    const s = game.state, open = s.routes.filter((r) => r.open);
    if (!open.length) return `<h2>노선</h2><p class="hint">아직 열린 노선이 없습니다. <b>현황</b> 탭이나 지도에서 도시를 눌러 노선을 열어 보세요.</p>`;
    const sel = selRoute !== null && game.route(selRoute)?.open ? selRoute : null;
    const rows = open.map((r) => { const d = game.routeDay(r), n = game.planesOn(r.id).length; return { r, n, d, profit: n ? (d.revenue - d.cost) * config.daysPerMonth : 0, lf: n && d.seats > 0 ? d.pax / d.seats : 0, share: n ? d.share : 0, name: `${cityById(r.a).name}${cityById(r.b).name}` }; });
    const losing = rows.filter((x) => x.n && x.profit < 0).length, total = rows.reduce((a, x) => a + x.profit, 0);
    const sorted = tsorted('routes', rows, (x, k) => (k === 'name' ? x.name : k === 'profit' ? x.profit : k === 'share' ? x.share : k === 'lf' ? x.lf : k === 'otp' ? x.d.otp : x.n));
    const ordered = [...sorted.filter((x) => x.n === 0), ...sorted.filter((x) => x.n > 0)]; // 항공기가 없는 노선(할 일)은 늘 맨 위
    const status = (x: typeof rows[number]) => (x.n === 0 ? '<span class="badge need">배정 필요</span>' : game.warOn(x.r) ? `<span class="neg">${icon('war', 14)} 전쟁</span>` : x.profit < 0 ? '<span class="badge">적자</span>' : (x.r.ad ?? 0) > 0 ? '<small>광고 중</small>' : x.r.stance === 'share' ? '<small>점유 우선</small>' : '');
    const hasSt = ordered.some((x) => status(x)), served = rows.filter((x) => x.n > 0), avg = (f: (x: typeof rows[number]) => number) => (served.length ? served.reduce((a, x) => a + f(x), 0) / served.length : 0);
    const main = `<div class="toolbar"><h2>노선 <small>${open.length}개${losing ? ` · 적자 ${losing}개` : ''}</small></h2><button class="${s.autoFare ? '' : 'ghost'}" data-act="autoFare">자동 운임: <b>${s.autoFare ? '켜짐' : '꺼짐'}</b></button></div>
      <div class="tbl" style="--cols: minmax(96px, 1.2fr) 68px minmax(120px, 2fr) 46px 46px 38px${hasSt ? ' 64px' : ''}">${thead('routes', [['name', '노선'], ['profit', '월 이익'], ['share', '점유율'], ['lf', '탑승률'], ['otp', '정시율'], ['n', '항공기'], ...(hasSt ? [['', '상태'] as [string, string]] : [])])}
      ${ordered.map((x) => `<button class="trow${x.r.id === sel ? ' sel' : ''}" data-act="goRoute" data-id="${x.r.id}"><span><b>${x.r.name ? `${esc(x.r.name)} · ` : ''}${routeLabel(x.r.a, x.r.b)}</b>${s.sandbox && x.n ? `<br><small>별점 ${game.routeRating(x.r).toFixed(1)}</small>` : ''}</span><span class="${x.profit >= 0 ? 'pos' : 'neg'}">${x.n ? money(x.profit) : '-'}</span>${x.n ? (x.d.share < 1 ? shareCell(x.r) : '<span><small>독점</small></span>') : '<span>-</span>'}<span>${x.n ? pct(x.lf) : '-'}</span><span>${x.n ? pct(x.d.otp) : '-'}</span><span>${x.n}대</span>${hasSt ? `<span>${status(x)}</span>` : ''}</button>`).join('')}
      <div class="tfoot"><span>합계 ${open.length}개</span><span class="${total >= 0 ? 'pos' : 'neg'}">${money(total)}</span><span>평균 ${pct(avg((x) => x.d.share))}</span><span>${pct(avg((x) => x.lf))}</span><span>${pct(avg((x) => x.d.otp))}</span><span>${rows.reduce((a, x) => a + x.n, 0)}대</span>${hasSt ? '<span></span>' : ''}</div></div>
      ${open.length > 1 ? `<details class="more"><summary>노선 일괄 편집</summary><p class="hint">열려 있는 노선 ${open.length}개 전체에 한 번에 적용합니다.</p><div class="btnrow"><button class="ghost" data-act="bulk" data-v="fareDown" ${no(!!s.autoFare, '자동 운임이 켜져 있으면 운임은 매주 다시 맞춰집니다')}>운임 −5%</button><button class="ghost" data-act="bulk" data-v="fareUp" ${no(!!s.autoFare, '자동 운임이 켜져 있으면 운임은 매주 다시 맞춰집니다')}>운임 +5%</button><button class="ghost" data-act="bulk" data-v="fareBase" ${no(!!s.autoFare, '자동 운임이 켜져 있으면 운임은 매주 다시 맞춰집니다')}>기준 운임</button></div><div class="btnrow">${[1, 2, 3].map((n) => `<button class="ghost" data-act="bulk" data-v="pri${n}">우선순위 ${n}</button>`).join('')}</div><button class="wide danger" data-act="bulk" data-v="closeLoss" ${no(!losing, '적자 노선이 없습니다')}>적자 노선 모두 닫기 (${losing}개)</button></details>` : ''}
      <p class="hint">열 제목을 누르면 정렬됩니다. 자동 운임을 켜면 매주 모든 노선의 운임을 ‘자리를 꽉 채우는 가장 높은 운임’으로 맞춥니다(비즈니스석 포함, 화물 제외).</p>`;
    const pick = (list: typeof rows, title: string, val: (x: typeof rows[number]) => string) => (list.length ? `<h3>${title}</h3><div class="list">${list.map((x) => `<button class="card" data-act="goRoute" data-id="${x.r.id}"><div class="row"><div class="grow"><b>${routeLabel(x.r.a, x.r.b)}</b></div><div class="right">${val(x)}</div></div></button>`).join('')}</div>` : '');
    const byProfit = [...served].sort((a, b) => b.profit - a.profit);
    const side = sel !== null ? viewRouteDetail(sel) : `<h3 style="margin-top:4px">한눈에 보기</h3><p class="hint">왼쪽 표에서 노선을 누르면 여기서 운임·항공기·경쟁 대응을 고칩니다.</p>
      ${pick(rows.filter((x) => x.n === 0), '항공기 배정이 필요한 노선', () => '<span class="badge need">배정 필요</span>')}
      ${pick(byProfit.slice(0, 3), '이익 상위 3', (x) => `<b class="pos">${money(x.profit)}</b>`)}
      ${pick(byProfit.slice(-3).reverse().filter((x) => !byProfit.slice(0, 3).includes(x)), '이익 하위 3', (x) => `<b class="${x.profit >= 0 ? '' : 'neg'}">${money(x.profit)}</b>`)}
      ${pick(served.filter((x) => x.d.share < 0.5).sort((a, b) => a.d.share - b.d.share).slice(0, 3), '점유율 낮은 노선', (x) => `<b class="warn">${pct(x.d.share)}</b>`)}`;
    return `<div class="split${sel !== null ? ' sel' : ''}"><div class="pmain" data-sc="m-routes">${main}</div><div class="pside" data-sc="s-r${sel}">${side}</div></div>`;
  }


  /** 노선 화면의 '항공기 추가': 이 노선을 날 수 있는 기종과 예상(추정), 바로 사기 */
  function buyOptionsHtml(rId: number): string {
    const opts = game.routeOptions(rId), rec = opts.find((o) => o.recommended), s = game.state, n = game.planesOn(rId).length;
    if (!opts.length) return '<p class="hint">이 노선을 날 수 있는 기종이 없습니다.</p>';
    const open = rbuyOpen.get(rId) ?? n === 0; // 비행기가 하나도 없는 노선은 펼쳐서 보여 준다
    const slotsNote = (o: typeof opts[number]) => (o.slotCost > 0 ? `<small class="warn">슬롯 ${o.slotNeeds.map((x) => `${esc(cityById(x.city).name)} ${x.n}개`).join('·')} 추가 필요 (${money(o.slotCost)})</small><br>` : '');
    const leaseOk = game.leasedCount < game.leaseCap, leaseFull = `임대는 내 항공기 수 + ${config.lease.extra}대까지 가능합니다 (지금 ${game.leasedCount}/${game.leaseCap}대). 항공기를 더 사거나 임대기를 매입하면 한도가 늘어납니다.`;
    const optRow = (o: typeof opts[number]) => { const t = typeById(o.type), used = Math.round(t.price * config.used.price * 10) / 10, rent = t.price * config.lease.rate, dep = rent * config.lease.deposit;
      return `<div class="opt"><div class="top"><span><b>${esc(t.name)}</b>${o.recommended ? '<span class="badge rec">추천</span>' : ''}<br><small>${t.cls} · ${t.seats ? `${t.seats}석` : '화물기'} · 주 ${o.weekly}회${o.shareAfter > o.shareBefore + 0.005 ? ` · 점유 ${pct(o.shareBefore)} → <b class="pos">${pct(o.shareAfter)}</b>` : ''}</small></span>
          <span class="right">${o.profit > 0.05 ? `<b class="pos">+${money(o.profit)}/월</b><br><small>회수 ${Math.round(o.payback!)}개월</small>` : `<b class="neg">${money(o.profit)}/월</b><br><small>손해 예상</small>`}</span></div>
          ${slotsNote(o)}<div class="btnrow"><button data-act="rbuy" data-t="${t.id}" data-how="new" ${no(s.cash < t.price + o.slotCost, short(t.price + o.slotCost))}>새것 ${money(t.price)}</button><button class="ghost" data-act="rbuy" data-t="${t.id}" data-how="used" ${no(s.cash < used + o.slotCost, short(used + o.slotCost))}>중고 ${money(used)}</button><button class="ghost" data-act="rbuy" data-t="${t.id}" data-how="lease" ${no(!leaseOk || s.cash < dep + o.slotCost, !leaseOk ? leaseFull : short(dep + o.slotCost))}>임대 ${money(rent)}/월</button></div></div>`; };
    return `<details class="rbuy" data-rid="${rId}" ${open ? 'open' : ''}><summary><span>항공기 추가</span><small>${rec ? `추천 ${esc(typeById(rec.type).name)} · 회수 ${Math.round(rec.payback!)}개월` : '지금은 늘려도 이익이 안 늘어납니다'}</small></summary>
      <p class="hint">한 대를 더 넣었을 때의 <b>추정</b>입니다(지금 수요 기준, 경기·성수기·사건에 따라 달라짐). 사면 이 노선에 최대 횟수로 바로 배정됩니다. 회수 기간 = 새 기체 값 ÷ 늘어나는 월 이익.</p>
      ${(() => { const sorted = [...opts].sort((a, b) => (a.payback ?? 1e9) - (b.payback ?? 1e9) || b.profit - a.profit), row = (o: typeof opts[number]) => optRow(o), top = sorted.slice(0, 5), rest = sorted.slice(5); return top.map(row).join('') + (rest.length ? `<details class="rbuymore"><summary>나머지 기종 ${rest.length}개 보기</summary>${rest.map(row).join('')}</details>` : ''); })()}
      <small class="hint">임대 보증금은 임대료 ${config.lease.deposit}개월치, 임대 가능 ${game.leasedCount}/${game.leaseCap}대.</small></details>`;
  }
  /** 노선 화면 아래에 늘 보이는 예상치: 운임을 움직이는 동안에도 바로 바뀐다 */
  function liveHtml(rId: number): string {
    const r = game.route(rId)!, d = game.routeDay(r), n = game.planesOn(rId).length, profit = (d.revenue - d.cost) * config.daysPerMonth;
    if (!n) return '<span>항공기를 배정하면 예상 이익이 나옵니다</span>';
    return `<span>예상 월 이익 <b class="${profit >= 0 ? 'pos' : 'neg'}">${money(profit)}</b></span><span>탑승률 <b>${d.seats > 0 ? pct(d.pax / d.seats) : '-'}</b>${d.cargoCap > 0 ? ` · 화물 <b>${pct(d.cargoT / d.cargoCap)}</b>` : ''}</span>`;
  }
  /** 노선 화면: 경쟁사와의 가격 비교와 대응(운임 맞추기·광고) */
  function rivalBlock(r: Route): string {
    const cs = game.competitorsOn(r.a, r.b); if (!cs.length) return '';
    const s = game.state, mine = r.fare / game.routeBaseFare(r), low = Math.min(...cs.map((x) => x.route.fareRatio)), gap = mine - low;
    const verdict = gap > 0.1 ? `<b class="neg">상대가 ${Math.round((gap / mine) * 100)}% 더 쌉니다.</b> 손님이 빠지고 있습니다. 운임을 맞추거나 광고로 맞서세요.` : gap < -0.1 ? '<b class="pos">내 운임이 더 쌉니다.</b> 점유율에 유리하지만 이익은 줄 수 있어요.' : '운임이 비슷합니다. 서비스·정시율·좌석 수로 승부가 갈립니다.';
    return `<div class="goal"><div><b>경쟁 대응</b></div><p class="hint">${verdict}</p><div class="btnrow"><button class="ghost" data-act="matchFare" data-id="${r.id}" ${no(!!s.autoFare, '자동 운임이 켜져 있으면 운임은 매주 다시 맞춰집니다')}>상대 운임에 맞추기</button><button class="ghost" data-act="adRoute" data-id="${r.id}" ${no((r.ad ?? 0) > 0 || s.cash < config.rivalry.ad.cost, (r.ad ?? 0) > 0 ? `이미 광고 중입니다(${r.ad}개월 남음)` : short(config.rivalry.ad.cost))}>${(r.ad ?? 0) > 0 ? `광고 중 ${r.ad}개월` : `맞대응 광고 ${money(config.rivalry.ad.cost)}`}</button></div>
      <button class="wide ${r.stance === 'share' ? '' : 'ghost'}" data-act="stance" data-id="${r.id}">점유율 우선 운임: <b>${r.stance === 'share' ? '켜짐' : '꺼짐'}</b></button>
      <p class="hint" style="margin-top:2px">켜면 매주 경쟁사 최저가보다 5% 싸게 맞춥니다(손님은 늘지만 단가가 내려갑니다).</p>
      <p class="hint" style="margin-bottom:2px">서비스 등급 — 경쟁사와 나누는 몫이 커지는 대신 항공기 1대당 월 비용이 듭니다.</p>
      <div class="seg">${config.strategy.svcName.map((n, i) => `<button data-act="svc" data-id="${r.id}" data-v="${i}" class="${(r.svc ?? 0) === i ? 'on' : ''}">${n}${i ? ` $${config.strategy.svcCost[i]}M/대` : ''}</button>`).join('')}</div></div>`;
  }
  /** 지도 탭(자유 모드): 이야기·진출 예고(위쪽, 바로 할 일)와 라이벌·올해의 도전(아래쪽) */
  function rivalryHtml(): { top: string; bottom: string } {
    const s = game.state; if (!s.sandbox) return { top: '', bottom: '' };
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0), mine = sum(s.history.slice(-12).map((h) => h.revenue)), mp = game.monthsPassed;
    const sd = s.story ? game.storyDef() : undefined;
    const story = sd && s.story ? `<h3>이야기 <small>(${Math.max(0, s.story.expires - mp)}개월 안에 선택)</small></h3><div class="rowc"><div class="top"><div class="grow"><b>${esc(sd.title)}</b><small>${esc(sd.desc)}</small></div></div><div class="btnrow">${sd.choices.map((c, i) => `<button class="${i ? 'ghost' : ''}" data-act="story" data-i="${i}" ${no(!!c.cash && c.cash < 0 && s.cash < -c.cash, short(-(c.cash ?? 0)))}>${esc(c.label)}</button>`).join('')}</div></div>` : '';
    const th = (s.threats ?? []).map((t) => ({ t, c: s.competitors.find((x) => x.id === t.comp) })).filter((x) => x.c);
    const threats = th.length ? `<h3>진출 예고 <small>${th.length}건</small></h3><div class="list">${th.map(({ t, c }) => `<div class="row"><div class="grow"><b>${esc(c!.name)} → ${esc(cityById(t.a).name)} ⇄ ${esc(cityById(t.b).name)}</b><small>${later(t.start - mp)} 진출 · 제휴를 맺거나 인수하면 막을 수 있습니다</small></div><button class="ghost small" data-act="ally" data-id="${c!.id}" ${no(s.ally === c!.id, '이미 제휴 중입니다')}>제휴 ${money(config.ally.fee)}/월</button></div>`).join('')}</div>` : '';
    const rv = s.competitors.find((c) => c.id === s.rivalId);
    const theirs = rv ? sum(rv.revHist ?? []) : 0, mx = Math.max(1, mine, theirs);
    const rival = rv ? `<h3>라이벌 <small>${esc(rv.name)}</small></h3><div class="rowc"><div class="grow"><small>최근 12개월 매출 · ${s.rivalLead ? '<b class="pos">내가 앞서는 중</b>' : '<b class="neg">뒤처지는 중</b>'}</small><div class="rb2"><span>나</span><div class="bar"><i style="width:${(mine / mx) * 100}%"></i></div><b>${money(mine)}</b></div><div class="rb2"><span>${esc(rv.name.slice(0, 5))}</span><div class="bar rivalbar"><i style="width:${(theirs / mx) * 100}%"></i></div><b>${money(theirs)}</b></div></div></div>` : (mp + 1 < config.rivalry.rival.startMonth ? '' : '<h3>라이벌</h3><p class="hint">매출이 비슷한 경쟁사가 다음 달에 라이벌로 정해집니다.</p>');
    const se = s.season;
    const season = se ? `<h3>올해의 도전 <small>${se.done ? '달성' : `보상 ${money(se.cash)}`}</small></h3><div class="rowc"><div class="grow"><b>${esc(se.text)}</b><div class="bar"><i style="width:${Math.min(100, (se.best / se.goal) * 100)}%"></i></div><small>${se.kind === 'otp' ? `이번 해 최고 ${pct(se.best)} / ${pct(se.goal)}` : se.kind === 'cities' ? `${Math.max(0, se.best)} / ${se.goal}곳` : se.kind === 'profit' ? `이번 해 최고 ${money(se.best)} / ${money(se.goal)}` : `이번 해 최고 ${num(se.best)} / ${num(se.goal)}명`}${se.done ? ' · 달성!' : ''}</small></div></div>` : '';
    return { top: story + threats, bottom: rival + season };
  }
  function viewRouteDetail(rId: number): string {
    const r = game.route(rId)!, d = game.routeDay(r), planes = game.planesOn(rId), A = cityById(r.a), B = cityById(r.b), dist = distanceKm(A, B);
    const base = game.routeBaseFare(r), lf = d.seats > 0 ? d.pax / d.seats : 0, profit = (d.revenue - d.cost) * config.daysPerMonth;
    const idle = s_idlePlanes().filter((p) => canFly(typeById(p.type), A, B).ok);
    const lo = Math.round(base * config.fare.minRatio), hi = Math.round(base * config.fare.maxRatio);
    const hasComp = game.competitorsOn(r.a, r.b).length > 0;
    return `<button class="back" data-act="routesHome">${icon('back', 14)} 노선 목록</button>
      <h2>${r.name ? `${esc(r.name)} <small>${routeLabel(r.a, r.b)}</small>` : routeLabel(r.a, r.b)} <button class="ghost small" data-act="rename">이름</button></h2>
      ${(() => { const w = game.warOn(r); return w ? `<p class="hint"><b class="neg">${icon('war', 14)} 운임 전쟁</b>: ${esc(w.comp.name)}이(가) 이 노선 운임을 크게 내렸습니다(${w.route.war}개월 남음). 따라 내리면 손님을 지키지만 이익이 줄고, 버티면 손님을 잃습니다. 제휴를 맺으면 바로 끝납니다.</p>` : ''; })()}
      <div class="kpi"><div><small>예상 월 이익</small><b class="${profit >= 0 ? 'pos' : 'neg'}">${money(profit)}</b></div><div><small>탑승률</small><b>${planes.length ? pct(lf) : '-'}</b></div><div><small>정시율</small><b class="${d.otp < 0.85 ? 'neg' : d.otp < 0.95 ? 'warn' : ''}">${pct(d.otp)}</b></div><div><small>점유율</small><b class="${d.share < 0.5 ? 'warn' : ''}">${d.share < 1 ? pct(d.share) : '독점'}</b></div></div>${game.state.sandbox && planes.length ? `<p class="hint" style="margin:2px 0 6px">고객 별점 <b>${game.routeRating(r).toFixed(1)}</b> / 5 — 정시율·서비스 등급·평판으로 매겨지고, 1점마다 수요 ±${Math.round(config.extra.rating.weight * 100)}%</p>` : ''}
      <h3>운임 <b>${fare(r.fare)}</b> <small>(기준 ${fare(base)})</small></h3>
      <input type="range" id="fare" min="${lo}" max="${hi}" step="1" value="${r.fare}" />
      <div class="two"><small>${fare(lo)}</small><small class="right">${fare(hi)}</small></div>
      <button class="wide" data-act="fillFare">자리를 꽉 채우는 운임으로 맞추기</button>
      ${d.seatsB > 0 || planes.some((p) => p.bizShare > 0) ? `<h3>비즈니스 운임 <b>${fare(r.fareBiz)}</b> <small>(기준 ${fare(game.routeBaseFareBiz(r))})</small></h3><input type="range" id="fareBiz" min="${Math.round(game.routeBaseFareBiz(r) * config.fare.minRatio)}" max="${Math.round(game.routeBaseFareBiz(r) * config.fare.maxRatio)}" step="1" value="${r.fareBiz}" />` : ''}
      ${d.cargoCap > 0 ? `<h3>화물 운임 배율 <b>×${r.cargoRatio.toFixed(2)}</b></h3><input type="range" id="cargoRatio" min="${config.fare.minRatio}" max="${config.fare.maxRatio}" step="0.05" value="${r.cargoRatio}" />` : ''}
      <p class="hint">운임이 높으면 수익은 늘지만 손님이 줄어요. 비행기가 비면 내리고, 자리가 모자라면 올려 보세요.</p>
      <h3>배정된 항공기</h3>
      ${planes.length ? planes.map((p) => { const t = typeById(p.type), max = maxWeeklyRoundTrips(dist, t); return `<div class="row"><div class="grow"><b>${esc(t.name)}</b><small>${t.seats}석${t.seats ? ` (비즈니스 ${Math.round(p.bizShare * 100)}%)` : ' · 화물기'} · 주 ${p.weekly}회 왕복 (최대 ${max})</small></div>
        <div class="stepper"><button data-act="weekly" data-id="${p.id}" data-d="-1" aria-label="횟수 줄이기">−</button><button data-act="weekly" data-id="${p.id}" data-d="1" aria-label="횟수 늘리기">+</button><button class="ghost" data-act="unassign" data-id="${p.id}">빼기</button></div></div>${t.seats ? `<div class="cabin"><small>객실:</small>${config.cabin.shares.map((sh) => `<button class="ghost small ${p.bizShare === sh ? 'on' : ''}" data-act="cabin" data-id="${p.id}" data-share="${sh}">${sh === 0 ? '일반석만' : `비즈 ${sh * 100}%`}</button>`).join('')}</div>` : ''}`; }).join('') : '<p class="hint">배정된 항공기가 없습니다.</p>'}
      ${idle.length ? `<h3>대기 중인 항공기 배정</h3>${idle.map((p) => { const t = typeById(p.type); return `<div class="row"><div class="grow"><b>${esc(t.name)}</b><small>${t.seats}석 · 최대 주 ${maxWeeklyRoundTrips(dist, t)}회</small></div><button data-act="assign" data-id="${p.id}">배정</button></div>`; }).join('')}` : ''}
      ${buyOptionsHtml(rId)}
      ${hasComp ? `<details class="more rsec" ${game.warOn(r) || d.share < 0.5 ? 'open' : ''}><summary>경쟁 대응 <small>점유 ${pct(d.share)}${game.warOn(r) ? ' · 운임 전쟁 중' : ''}</small></summary>` : ''}
      ${rivalBlock(r)}
      ${hasComp ? '</details>' : ''}
      <details class="more rsec"><summary>공항 우선순위 <small>지금 ${r.priority ?? 1}단계</small></summary>
      <div class="seg">${[1, 2, 3].map((lv) => `<button data-act="priority" data-v="${lv}" class="${(r.priority ?? 1) === lv ? 'on' : ''}">${icon('star', 13).repeat(lv)}${lv > 1 ? ` ${money((lv - 1) * config.delay.priorityFee)}` : ' 무료'}</button>`).join('')}</div>
      <p class="hint">정시율이 낮으면 손님이 줄고 보상금이 나가며 평판이 떨어집니다. 원인: 공항 슬롯 혼잡(${esc(cityById(r.a).name)} ${pct(game.slotsUsed(r.a) / game.slotCapacity(r.a))}, ${esc(cityById(r.b).name)} ${pct(game.slotsUsed(r.b) / game.slotCapacity(r.b))}), 정비 상태, 폭설·파업.</p>
      </details>
      <details class="more rsec"><summary>상세 지표 · 손익 분해 · 최근 그래프</summary>
      <div class="kv"><div>거리</div><div>${km(dist)}</div><div>월 수요</div><div>${num(d.demand * config.daysPerMonth)}명</div><div>월 좌석</div><div>${num(d.seats * config.daysPerMonth)}석</div>
        <div>탑승률</div><div>${planes.length ? pct(lf) : '-'}</div><div>예상 월 수익</div><div>${money(d.revenue * config.daysPerMonth)}</div><div>예상 월 비용</div><div>${money(d.cost * config.daysPerMonth)}</div>
        <div>예상 월 이익</div><div class="${profit >= 0 ? 'pos' : 'neg'}"><b>${money(profit)}</b></div>
        <div>정시율</div><div class="${d.otp < 0.85 ? 'neg' : d.otp < 0.95 ? 'warn' : 'pos'}"><b>${pct(d.otp)}</b>${d.compensation > 0 ? ` <small>(보상금 월 ${money(d.compensation * config.daysPerMonth)})</small>` : ''}</div>
        ${d.transfer > 0 ? `<div>환승 수요</div><div class="pos"><b>+${num(d.transfer)}명/월</b> <small>(우리 다른 노선에서 갈아타는 손님)</small></div>` : ''}
        ${d.share < 1 ? `<div>경쟁 점유율</div><div class="warn"><b>${pct(d.share)}</b></div>` : ''}${game.competitorsOn(r.a, r.b).map(({ comp, route }) => `<div>${esc(comp.name)}${game.traitOf(comp) ? ` <small>${game.traitOf(comp)!.name}</small>` : ''}${route.war ? ` <span class="neg">${icon('war', 14)}</span>` : ''}</div><div>점유 ${pct(game.routeShares(r).find((x) => x.id === comp.id)?.share ?? 0)} · 운임 ${pct(route.fareRatio)} (내 ${pct(r.fare / game.routeBaseFare(r))}) · 하루 ${num(route.seatsDay)}석</div>`).join('')}${d.seatsB > 0 ? `<div>비즈니스 탑승</div><div>${num(d.paxB * config.daysPerMonth)} / ${num(d.seatsB * config.daysPerMonth)}석</div>` : ''}${d.cargoCap > 0 ? `<div>화물</div><div>${num(d.cargoT * config.daysPerMonth)}t / ${num(d.cargoCap * config.daysPerMonth)}t · ${money(d.cargoRevenue * config.daysPerMonth)}</div>` : ''}</div>
      <details class="rbuymore"><summary>월 손익 분해 보기</summary><table class="brk" style="width:100%"><tr><td>여객 수익</td><td class="pos">${money(d.revenuePax * config.daysPerMonth)}</td></tr>${d.cargoRevenue > 0 ? `<tr><td>화물 수익</td><td class="pos">${money(d.cargoRevenue * config.daysPerMonth)}</td></tr>` : ''}<tr><td>운영·연료비</td><td>−${money(d.costOps * config.daysPerMonth)}</td></tr><tr><td>착륙료</td><td>−${money(d.costLanding * config.daysPerMonth)}</td></tr><tr><td>승객당 수수료</td><td>−${money(d.costPax * config.daysPerMonth)}</td></tr><tr><td>지연 보상금</td><td>−${money(d.compensation * config.daysPerMonth)}</td></tr><tr><td><b>이익</b></td><td class="${profit >= 0 ? 'pos' : 'neg'}"><b>${money(profit)}</b></td></tr></table><small class="hint">고정비(본사·정비·슬롯 등)는 노선이 아니라 회사 전체에 붙으므로 여기에 넣지 않았습니다.</small></details>
      ${(r.monthly?.length ?? 0) >= 2 ? `<h3>최근 ${r.monthly!.length}개월 추이</h3><div class="chartlabel"><small>월 이익(지난달 ${money(r.monthly!.at(-1)!.p)})</small></div>${spark(r.monthly!.map((x) => x.p), '#1f9d57', { zero: true })}<div class="chartlabel"><small>점유율(지난달 ${pct(r.monthly!.at(-1)!.s)})</small></div>${spark(r.monthly!.map((x) => x.s), '#1f7ae0', { min: 0, max: 1 })}` : '<p class="hint">두 달이 지나면 월별 이익·점유율 추이가 나옵니다.</p>'}
      <h3>최근 ${r.daily.length}일</h3><div class="chartlabel"><small>일 이익(${money(r.daily.at(-1)?.profit ?? 0)})</small></div>${spark(r.daily.map((x) => x.profit), '#1f9d57', { zero: true })}
      <div class="chartlabel"><small>탑승률(${pct(r.daily.at(-1) && r.daily.at(-1)!.seats ? r.daily.at(-1)!.pax / r.daily.at(-1)!.seats : 0)})</small></div>${spark(r.daily.map((x) => (x.seats ? x.pax / x.seats : 0)), '#1f7ae0', { min: 0, max: 1 })}
      </details>
      <button class="wide danger" data-act="close">노선 닫기</button>
      <div class="live" id="live">${liveHtml(rId)}</div>`;
  }
  const s_idlePlanes = () => game.state.planes.filter((p) => p.routeId === null && p.charter === undefined);

  let shopOpen: boolean | null = null, shopSort: 'price' | 'seats' | 'range' | 'eff' | 'cargo' = 'price';
  panel.addEventListener('click', (e) => { const gs = (e.target as HTMLElement).closest('details > summary'); if (gs) { const d = gs.parentElement as HTMLDetailsElement; detOpen.set(detKey(d), !d.open); } const rs = (e.target as HTMLElement).closest('details.rbuy > summary'); if (rs) { const d = rs.parentElement as HTMLDetailsElement; rbuyOpen.set(Number(d.dataset.rid), !d.open); } const sc = (e.target as HTMLElement).closest('details.sec > summary'); if (sc) { const d = sc.parentElement as HTMLDetailsElement; secOpen.set(d.dataset.k ?? '', !d.open); } const sm = (e.target as HTMLElement).closest('#shop > summary'); if (sm) shopOpen = !(sm.parentElement as HTMLDetailsElement).open; }); // 사용자가 누른 것만 기억(화면을 다시 그릴 때 생기는 toggle 신호는 무시)
  /** 대기 중인 항공기: 눌러서 어느 노선에 넣으면 좋은지 본다 */
  /** 1~12월 수요 변화를 작은 막대 그림(SVG)으로. 이번 달은 진한 색, 가장 높은 달 위에 점 */
  function seasonBar(a: City, b: City): string {
    const v = Array.from({ length: 12 }, (_, i) => rawMonthlyDemand(a, b, i + 1)), lo = Math.min(...v), hi = Math.max(...v), cur = game.month, H = 18;
    const bars = v.map((x, i) => { const h = hi - lo < 1e-9 ? H / 2 : 4 + ((x - lo) / (hi - lo)) * (H - 4); return `<rect x="${i * 8}" y="${H - h}" width="6" height="${h}" rx="1.5" class="${i + 1 === cur ? 'cur' : ''}"/>`; }).join('');
    return `<svg viewBox="0 0 94 ${H}" width="94" height="${H}" role="img" aria-label="1월부터 12월까지 수요 변화">${bars}</svg>`;
  }
  /** 교체 추천: 같은 노선에서 새 기종으로 바꾸면 월 이익이 얼마나 늘고 몇 달 만에 본전인지 */
  function replaceHtml(p: Plane): string {
    const opts = game.replaceOptions(p.id).slice(0, 3); if (!opts.length) return '';
    const best = opts[0];
    return `<details class="more"><summary>교체 추천 <small>${esc(typeById(best.type).name)} · 월 +${money(best.gain)} · 회수 ${Math.max(1, Math.round(best.payback!))}개월</small></summary>${opts.map((o) => `<div class="row"><div class="grow"><b>${esc(typeById(o.type).name)}</b><small>${esc(typeById(o.type).cls)} · ${typeById(o.type).seats}석(지금 ${typeById(p.type).seats}석) · 항속 ${km(typeById(o.type).range)} · 활주로 ${num(typeById(o.type).runway)}m · 새 기체 ${money(typeById(o.type).price)} · 시간당 운영비 ${typeById(o.type).hourly}(지금 ${typeById(p.type).hourly})</small><small>월 이익 +${money(o.gain)} · 순비용 ${money(o.cost)}(새 기체 − 지금 기체 ${p.leased ? '반납' : '매각'}) · 회수 ${Math.max(1, Math.round(o.payback!))}개월 · 주 ${o.weekly}회</small></div><button class="small" data-act="replace" data-id="${p.id}" data-t="${o.type}" ${no(game.state.cash < o.cost, short(o.cost))}>교체</button></div>`).join('')}<p class="hint">추정입니다(지금 수요 기준). 교체하면 지금 항공기를 팔고 새 기체를 같은 노선에 넣으며, 이름·객실 비율은 이어받습니다.</p></details>`;
  }
  /** 기종 도감: 운용해 본 기종 */
  function dexHtml(): string {
    const got = new Set(game.state.typesFlown ?? game.state.planes.map((p) => p.type));
    return `<details class="more"><summary>기종 도감 <small>${got.size}/${AIRCRAFT.length}</small></summary><div class="dex">${AIRCRAFT.map((t) => `<span class="${got.has(t.id) ? 'got' : ''}">${esc(t.name)}</span>`).join('')}</div><p class="hint">한 번이라도 가져 본 기종이 채워집니다. 다 모으면 연대기에 남습니다.</p></details>`;
  }
  function idleAdvice(planeId: number): string {
    const adv = game.assignAdvice(planeId), good = adv.filter((a) => a.profit > 0.05);
    if (!game.state.routes.some((r) => r.open)) return '<p class="hint">열린 노선이 없습니다. 현황 탭에서 노선을 먼저 여세요.</p>';
    return `<details class="more"><summary>배정 추천 노선 ${good.length ? `${good.length}곳` : '보기'}</summary>${good.length ? good.map((a) => { const r = game.route(a.routeId)!; return `<div class="row"><div class="grow"><b>${routeLabel(r.a, r.b)}</b><small>주 ${a.weekly}회 · 월 이익 +${money(a.profit)} 추정${a.slotCost > 0 ? ` · 슬롯 ${money(a.slotCost)} 추가 필요` : ''}</small></div><button class="small" data-act="assignTo" data-id="${planeId}" data-r="${a.routeId}">배정</button></div>`; }).join('') : '<p class="hint">이 항공기를 넣어 이익이 늘어나는 노선이 지금은 없습니다(항속·활주로가 안 맞거나, 노선이 이미 포화입니다). 새 노선을 열어 보세요.</p>'}</details>`;
  }
  function viewFleet(): string {
    const s = game.state;
    const planeCard = (p: Plane) => { const t = typeById(p.type), r = p.routeId ? game.route(p.routeId) : null;
      return `<div class="rowc"><div class="top"><div class="grow"><b>${p.name ? `${esc(p.name)} <small style="display:inline">${esc(t.name)}</small>` : esc(t.name)} <button class="ghost small" data-act="planeName" data-id="${p.id}">이름</button></b><small>${t.cls} · ${t.seats}석 · ${p.leased ? `<b>임대</b> 월 ${money(t.price * config.lease.rate)} · 매입가 ${money(game.leaseBuyoutPrice(p))}` : `장부가 ${money(p.book)}`} · ${p.age}개월 사용(정비비 +${Math.round((game.agingMult(p) - 1) * 100)}%)</small><div class="condbar" title="정비 상태 ${pct(p.cond)}"><i class="${p.cond < 0.45 ? 'low' : p.cond < 0.7 ? 'mid' : ''}" style="width:${Math.round(p.cond * 100)}%"></i></div><small>정비 상태 ${pct(p.cond)}${p.shop > 0 ? ` · <b class="warn">정비·수리 중 ${p.shop}일</b>` : p.cond < 0.45 ? ' · <b class="neg">고장 위험!</b>' : ''}</small></div><div class="right">${r ? routeLabel(r.a, r.b) : p.charter !== undefined ? '<span class="pos">전세 운항 중</span>' : '<span class="warn">대기 중</span>'}</div></div>${r || p.charter !== undefined ? '' : idleAdvice(p.id)}${replaceHtml(p)}<div class="btnrow"><button class="ghost" data-act="service" data-id="${p.id}" ${no(p.shop > 0 || s.cash < game.serviceCost(p), p.shop > 0 ? '지금 정비·수리 중입니다' : short(game.serviceCost(p)))}>정비 ${money(game.serviceCost(p))}</button>${p.leased ? `<button class="ghost" data-act="buyOut" data-id="${p.id}" ${no(s.cash < game.leaseBuyoutPrice(p) - (p.deposit ?? 0), short(game.leaseBuyoutPrice(p) - (p.deposit ?? 0)))}>매입 ${money(game.leaseBuyoutPrice(p) - (p.deposit ?? 0))}</button>` : ''}<button class="ghost" data-act="sell" data-id="${p.id}" ${no(p.charter !== undefined, '전세 운항 중인 항공기는 전세가 끝난 뒤 팔 수 있습니다')}>${p.leased ? '반납' : `매각 ${money(p.book * config.sale.ratio)}`}</button></div></div>`; };
    const sortKey = (t: typeof AIRCRAFT[number]) => (shopSort === 'seats' ? -t.seats : shopSort === 'range' ? -t.range : shopSort === 'eff' ? (t.seats ? t.hourly / t.seats : 1e9) : shopSort === 'cargo' ? -t.cargo : t.price);
    const shopChips = `<div class="chips">${([['price', '값 싼 순'], ['seats', '좌석 많은 순'], ['range', '항속 긴 순'], ['eff', '좌석당 운영비 낮은 순'], ['cargo', '화물 많은 순']] as const).map(([v, t]) => `<button data-act="shopSort" data-v="${v}" class="${shopSort === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    const shop = AIRCRAFT.filter((t) => game.isAvailable(t.id)).sort((a, b) => sortKey(a) - sortKey(b) || a.price - b.price).map((t) => `<div class="rowc"><div class="top"><div class="grow"><b>${esc(t.name)}</b><small>${t.cls} · ${t.seats ? `${t.seats}석` : '좌석 없음'} · 화물 ${t.cargo}t · 항속 ${km(t.range)} · 활주로 ${num(t.runway)}m 필요</small></div></div>
      <div class="btnrow"><button data-act="buy" data-id="${t.id}" ${no(s.cash < t.price, short(t.price))}>새것 ${money(t.price)}</button><button class="ghost" data-act="buyUsed" data-id="${t.id}" ${no(s.cash < t.price * config.used.price, short(t.price * config.used.price))}>중고 ${money(t.price * config.used.price)}</button><button class="ghost" data-act="lease" data-id="${t.id}" ${no(game.leasedCount >= game.leaseCap || s.cash < t.price * config.lease.rate * config.lease.deposit, game.leasedCount >= game.leaseCap ? `임대는 내 항공기 수 + ${config.lease.extra}대까지 가능합니다 (지금 ${game.leasedCount}/${game.leaseCap}대). 항공기를 더 사거나 임대기를 매입하면 한도가 늘어납니다.` : short(t.price * config.lease.rate * config.lease.deposit))}>임대 ${money(t.price * config.lease.rate)}/월</button></div></div>`).join('');
    const counts = new Map<string, number>(); for (const p of s.planes) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
    const summary = [...counts].map(([id, n]) => `${esc(typeById(id).name)} ×${n}`).join(' · ');
    const open = shopOpen ?? s.planes.length <= 3; // 기단이 커지면 구매 목록은 접어 둔다(펼친 상태는 기억)
    const fleetMain = `<div class="toolbar"><h2>기단 <small>${s.planes.length}대</small></h2><span class="livery" role="group" aria-label="도색"><small>도색</small>${config.livery.map((c) => `<button data-act="livery" data-v="${c}" aria-label="도색 ${c}" class="${(s.livery ?? '#ffffff') === c ? 'on' : ''}" style="background:${c}"></button>`).join('')}</span></div>${summary ? `<p class="hint">${summary}</p>` : ''}<details id="shop" ${open ? 'open' : ''}><summary>항공기 구매·임대</summary><p class="hint">구매한 비행기는 노선 탭에서 배정해야 돈을 벌어요.<br><b>중고</b>: 싸지만 8년 된 기체라 운영비가 더 들고 정비 상태가 70%입니다. <b>임대</b>(지금 ${game.leasedCount}/${game.leaseCap}대): 보증금(임대료 ${config.lease.deposit}개월치, 반납 때 돌려받음)만 내고 바로 쓰지만, 매달 새 기체 값의 ${(config.lease.rate * 100).toFixed(0)}%를 임대료로 내고 대출 담보가 되지 않습니다. ${config.lease.minMonths}개월 안에 반납하면 남은 개월 임대료를 위약금으로 내고, <b>매입</b>하면 내 항공기가 됩니다(사용할수록 매입가가 내려감). 임대 가능 대수는 내 항공기 수 + ${config.lease.extra}대입니다.</p>${shopChips}<div class="list">${shop}</div>${game.upcomingTypes().length ? `<h3>곧 출시</h3><div class="list">${game.upcomingTypes().map((t) => `<div class="row"><div class="grow"><b>${esc(t.name)}</b><small>${t.cls} · ${t.seats ? `${t.seats}석` : '화물기'} · 항속 ${km(t.range)} · ${money(t.price)}</small></div><div class="right"><b>${later((t.from ?? 0) - game.monthsPassed)}</b><br><small>${t.from}개월차</small></div>${game.canPreorder(t.id) ? `<button class="small" data-act="preorder" data-t="${t.id}" ${no(s.cash < t.price * config.extra.preorder.deposit, short(t.price * config.extra.preorder.deposit))}>선주문 1대(계약금 ${money(t.price * config.extra.preorder.deposit)})</button>` : ''}</div>`).join('')}</div>${s.sandbox ? `<p class="hint">선주문: 발표 뒤 출시 전까지 계약금 ${Math.round(config.extra.preorder.deposit * 100)}%를 내면 출시 때 ${Math.round(config.extra.preorder.discount * 100)}% 할인가로 인도(한 기종 ${config.extra.preorder.max}대까지).${(s.preorders ?? []).length ? ` 지금 선주문: ${(s.preorders ?? []).map((o) => `${esc(typeById(o.type).name)} ${o.n}대`).join(', ')}` : ''}</p>` : ''}` : ''}</details>${dexHtml()}<h3>보유 항공기</h3><div class="tbl" style="--cols: minmax(130px, 1.6fr) 0.7fr 0.8fr 1.2fr 1.5fr">${thead('fleet', [['type', '기종'], ['seats', '좌석'], ['age', '사용'], ['cond', '정비 상태'], ['route', '배정 노선']])}
      ${tsorted('fleet', s.planes, (p, k) => (k === 'type' ? typeById(p.type).name : k === 'seats' ? typeById(p.type).seats : k === 'age' ? p.age : k === 'cond' ? p.cond : p.routeId === null ? '' : routeText(p.routeId))).map((p) => `<button class="trow${p.id === selPlane ? ' sel' : ''}" data-act="selPlane" data-id="${p.id}"><span><b>${p.name ? esc(p.name) : esc(typeById(p.type).name)}</b>${p.name ? ` <small>${esc(typeById(p.type).name)}</small>` : ''}${p.leased ? ' <small>임대</small>' : ''}</span><span>${typeById(p.type).seats}석</span><span>${Math.floor(p.age / 12)}년 ${p.age % 12}개월</span>${mbar(p.cond)}<span>${p.routeId !== null && game.route(p.routeId) ? routeLabel(game.route(p.routeId)!.a, game.route(p.routeId)!.b) : p.shop > 0 ? '<span class="warn">정비 중</span>' : p.charter !== undefined ? '<span class="pos">전세 운항</span>' : '<span class="warn">대기 중</span>'}</span></button>`).join('')}<div class="tfoot"><span>합계 ${s.planes.length}대</span><span>${num(s.planes.reduce((a, p) => a + typeById(p.type).seats, 0))}석</span><span></span><span>평균 ${pct(s.planes.length ? s.planes.reduce((a, p) => a + p.cond, 0) / s.planes.length : 0)}</span><span>대기 ${s.planes.filter((p) => p.routeId === null).length}대</span></div></div>`;
    const sp = selPlane !== null ? s.planes.find((p) => p.id === selPlane) : undefined;
    return `<div class="split${sp ? ' sel' : ''}"><div class="pmain" data-sc="m-fleet">${fleetMain}</div><div class="pside" data-sc="s-p${sp?.id}">${sp ? `<button class="back" data-act="fleetHome">${icon('back', 14)} 기단 목록</button>${planeCard(sp)}` : `<h3 style="margin-top:4px">한눈에 보기</h3><p class="hint">왼쪽 표에서 항공기를 누르면 정비·매각·배정 추천을 여기서 합니다.</p>${(() => { const pk = (list: Plane[], title: string, val: (p: Plane) => string) => (list.length ? `<h3>${title}</h3><div class="list">${list.map((p) => `<button class="card" data-act="selPlane" data-id="${p.id}"><div class="row"><div class="grow"><b>${esc(typeById(p.type).name)}</b></div><div class="right">${val(p)}</div></div></button>`).join('')}</div>` : ''); return pk(s.planes.filter((p) => p.routeId === null && p.shop <= 0), '대기 중(배정 필요)', () => '<span class="badge need">배정 필요</span>') + pk([...s.planes].filter((p) => p.cond < 0.5).sort((a, b) => a.cond - b.cond).slice(0, 4), '정비가 필요한 항공기', (p) => `<b class="${p.cond < 0.3 ? 'neg' : 'warn'}">${pct(p.cond)}</b>`) + pk(s.planes.map((p) => ({ p, o: game.replaceOptions(p.id)[0] })).filter((x) => x.o && x.o.payback! <= 48).sort((a, b) => a.o.payback! - b.o.payback!).slice(0, 4).map((x) => x.p), '교체하면 이득인 항공기(4년 안에 본전)', (p) => { const o = game.replaceOptions(p.id)[0]; return `<small>→ ${esc(typeById(o.type).name)}</small> <b class="pos">+${money(o.gain)}/월</b>`; }); })()}`}</div></div>`;
  }

  /** 경쟁사 카드 아래: 지분·자회사 */
  /** 자회사 핵심 숫자와 12개월 추이 */
  function subStats(k: Competitor): string {
    const h = k.hist ?? [], last = h.at(-1);
    return `<div class="kpi"><div><small>항공기</small><b>${k.planes}대</b></div><div><small>노선</small><b>${k.routes.length}개</b></div><div><small>지난달 매출</small><b>${money(last?.rev ?? 0)}</b></div><div><small>지난달 이익</small><b class="${(last?.profit ?? 0) >= 0 ? 'pos' : 'neg'}">${money(last?.profit ?? 0)}</b></div></div>
      ${h.length >= 2 ? `<details class="more"><summary>최근 ${h.length}개월 추이</summary><div class="chartlabel"><small>매출</small></div>${spark(h.map((x) => x.rev), '#2f9e5b')}<div class="chartlabel"><small>이익</small></div>${spark(h.map((x) => x.profit), '#1f7ae0', { zero: true })}<div class="chartlabel"><small>항공기(${h[0].planes} → ${last!.planes}대)</small></div>${spark(h.map((x) => x.planes), '#d6803a', { min: 0 })}</details>` : ''}`;
  }
  /** 51% 자회사: 공세 대상·확장 지역·항공기 빌려주기 */
  function subControls(k: Competitor): string {
    const s = game.state, others = s.competitors.filter((x) => x.id !== k.id && !x.stake), regions = Object.keys(config.rights.regions);
    const idle = s.planes.filter((p) => p.routeId === null && p.shop <= 0 && !p.leased && p.charter === undefined && typeById(p.type).seats > 0);
    const rentNow = (k.lent ?? []).reduce((a, l) => a + typeById(l.type).price * config.lease.rate * config.subsidiary.lendRate, 0);
    return `${k.dir === 'attack' ? `<p class="hint" style="margin-bottom:2px"><b>공세 대상</b></p><div class="chips"><button data-act="subTarget" data-id="${k.id}" data-v="" class="${k.target === undefined ? 'on' : ''}">자동</button>${others.map((o) => `<button data-act="subTarget" data-id="${k.id}" data-v="${o.id}" class="${k.target === o.id ? 'on' : ''}">${esc(o.name)}${s.rivalId === o.id ? '(라이벌)' : ''}</button>`).join('')}</div>` : ''}
      <p class="hint" style="margin-bottom:2px"><b>확장 지역</b> <small>새 노선을 이 지역 도시로 먼저 연다</small></p><div class="chips"><button data-act="subRegion" data-id="${k.id}" data-v="" class="${!k.region ? 'on' : ''}">자유</button>${regions.map((r) => `<button data-act="subRegion" data-id="${k.id}" data-v="${r}" class="${k.region === r ? 'on' : ''}">${esc(game.regionName(r))}</button>`).join('')}</div>
      <p class="hint" style="margin-bottom:2px"><b>항공기 빌려주기</b> <small>노는 내 여객기를 넘기고 월 임대료(새 기체 값 × ${(config.lease.rate * config.subsidiary.lendRate * 100).toFixed(1)}%)를 받는다</small></p>
      ${(k.lent?.length ?? 0) ? `<p class="hint">빌려준 항공기 ${k.lent!.length}대 · 월 임대료 ${money(rentNow)} · 지난달 받은 돈 ${money(k.lastRent ?? 0)} <button class="ghost small" data-act="recallPlane" data-id="${k.id}">한 대 돌려받기</button></p>` : ''}
      ${idle.length ? `<div class="list">${idle.slice(0, 4).map((p) => `<div class="row"><div class="grow"><b>${p.name ? esc(p.name) : esc(typeById(p.type).name)}</b><small>${esc(typeById(p.type).name)} · 월 임대료 ${money(typeById(p.type).price * config.lease.rate * config.subsidiary.lendRate)}</small></div><button class="small" data-act="lendPlane" data-id="${k.id}" data-p="${p.id}">빌려주기</button></div>`).join('')}</div>` : '<p class="hint">지금 노는 내 여객기가 없습니다.</p>'}`;
  }
  function subBlock(k: Competitor): string {
    const s = game.state, K = config.subsidiary; if (!s.sandbox || k.major) return '';
    const st = k.stake ?? 0, sell = Math.round(game.acquirePrice(k) * st * K.priceMult * K.sellRatio * 10) / 10;
    const call = k.call ? `<p class="hint"><b class="neg">증자 요청 ${money(k.call.amount)}</b> — 자금난입니다. ${Math.max(0, k.call.expires - game.monthsPassed)}개월 안에 응하지 않으면 파산할 수 있고, 파산하면 지분을 잃고 평판이 떨어집니다.</p><button class="wide" data-act="fundSub" data-id="${k.id}" ${no(s.cash < k.call.amount, short(k.call.amount))}>증자 ${money(k.call.amount)}</button>` : '';
    if (!st) return `<div class="goal"><div><b>지분 사기(자회사)</b></div><p class="hint">인수와 달리 회사는 그대로 운영되고, 매달 이익의 일부를 <b>배당</b>으로 받습니다. 내 노선에서 손님을 덜 빼앗고 운임 전쟁·진출을 걸지 않습니다. 대신 자금난이면 증자를 요청하고, 망하면 손해입니다.</p>
      <div class="btnrow"><button class="ghost" data-act="buyStake" data-id="${k.id}" data-v="0.2" ${no(s.cash < game.stakePrice(k, 0.2), short(game.stakePrice(k, 0.2)))}>지분 20% ${money(game.stakePrice(k, 0.2))}</button><button data-act="buyStake" data-id="${k.id}" data-v="0.51" ${no(s.cash < game.stakePrice(k, 0.51), short(game.stakePrice(k, 0.51)))}>자회사 51% ${money(game.stakePrice(k, 0.51))}</button></div>
      <p class="hint">20%: 배당만(이익의 ${Math.round(K.payout.none * 100)}% × 20%). 51%: 경영권 — 운영 방향(확장·수익·공세)을 정합니다.</p></div>`;
    const dirs = st >= 0.51 ? `<div class="seg">${Object.entries(K.dirs).map(([d, v]) => `<button data-act="subDir" data-id="${k.id}" data-v="${d}" class="${k.dir === d ? 'on' : ''}">${v.name}</button>`).join('')}</div><p class="hint">${esc(K.dirs[k.dir ?? 'grow'].desc)} · 배당: 이익의 ${Math.round((K.payout[k.dir ?? 'grow'] ?? 0.4) * 100)}% × 지분 ${Math.round(st * 100)}%</p>` : `<p class="hint">배당: 이익의 ${Math.round(K.payout.none * 100)}% × 지분 20%. 51%로 올리면 운영 방향을 정할 수 있습니다.</p>`;
    return `<div class="goal"><div><b>${st >= 0.51 ? '자회사' : '지분 보유'} ${Math.round(st * 100)}%</b> <small>현금 ${money(k.cash)}</small></div><div class="kpi" style="grid-template-columns: repeat(2, minmax(0, 1fr))"><div><small>지난달 배당</small><b class="pos">${money(k.lastDiv ?? 0)}</b></div><div><small>누적 배당</small><b>${money(k.divTotal ?? 0)}</b></div></div>${subStats(k)}${call}${dirs}${st >= 0.51 ? subControls(k) : ''}
      <div class="btnrow">${st < 0.51 ? `<button data-act="buyStake" data-id="${k.id}" data-v="0.51" ${no(s.cash < game.stakePrice(k, 0.51), short(game.stakePrice(k, 0.51)))}>51%로 ${money(game.stakePrice(k, 0.51))}</button>` : ''}<button class="ghost" data-act="sellStake" data-id="${k.id}">지분 매각 ${money(sell)}</button></div></div>`;
  }
  /** 일반 경쟁사의 노선 목록 */
  function compRoutes(k: Competitor): string {
    return `<h3>${esc(k.name)}의 노선 <small>${k.routes.length}개</small></h3><div class="list">${k.routes.map((r) => `<div class="row"><div class="grow"><b>${routeLabel(r.a, r.b)}</b><small>하루 ${num(r.seatsDay)}석 · 운임 ${pct(r.fareRatio)}${r.war ? ' · <span class="neg">운임 전쟁 중</span>' : ''}</small></div></div>`).join('') || '<p class="hint">아직 노선이 없습니다.</p>'}</div>`;
  }
  /** 자회사 노선 표: 지난달 매출, 시장 몫(자회사·다른 경쟁사·우리), 공세 성과 */
  function subRoutes(k: Competitor): string {
    const col = (x: { me: boolean; id: number }) => (x.me ? 'var(--accent)' : x.id === k.id ? '#5b3fa0' : SHARE_COL[x.id % SHARE_COL.length]);
    const atk = k.routes.filter((r) => r.atk), lostAvg = atk.length ? atk.reduce((a, r) => a + Math.max(0, ...game.competitorsOn(r.a, r.b).filter((x) => x.comp.id !== k.id).map((x) => x.route.lost ?? 0)), 0) / atk.length : 0;
    const rows = k.routes.map((r) => { const sh = game.marketShares(r.a, r.b), mine = sh.find((x) => x.id === k.id)?.share ?? 0, lost = Math.max(0, ...game.competitorsOn(r.a, r.b).filter((x) => x.comp.id !== k.id).map((x) => x.route.lost ?? 0));
      return `<div class="trow" style="cursor:default"><span><b>${routeLabel(r.a, r.b)}</b>${r.atk ? ' <span class="badge">공세</span>' : ''}</span><span>${money(r.rev ?? 0)}</span><span class="scell"><span class="sbar">${sh.map((x) => `<i style="width:${(x.share * 100).toFixed(1)}%;background:${col(x)}"></i>`).join('')}</span><small>${sh.map((x) => `<span class="nw"><u style="background:${col(x)}"></u>${x.me ? '우리' : x.id === k.id ? '자회사' : esc(x.name)} ${pct(x.share)}</span>`).join(' ')}</small></span><span>${pct(mine)}${r.atk && lost > 0 ? `<br><small class="pos">상대 −${Math.round(lost * 100)}%p</small>` : ''}</span></div>`; }).join('');
    return `<h3>${esc(k.name)}의 노선 <small>${k.routes.length}개 · 추정</small></h3>${k.dir === 'attack' || atk.length ? `<p class="hint"><b>공세 성과</b>: 공세로 들어간 노선 ${atk.length}개${atk.length ? ` · 그 노선에서 상대 몫 평균 −${Math.round(lostAvg * 100)}%p` : ''}${k.target !== undefined && game.state.competitors.some((x) => x.id === k.target) ? ` · 대상 ${esc(game.state.competitors.find((x) => x.id === k.target)!.name)}` : ''}</p>` : ''}
      <div class="tbl" style="--cols: minmax(90px, 1.2fr) 60px minmax(110px, 2fr) 56px"><div class="thead"><span>노선</span><span>월 매출</span><span>시장 몫</span><span>자회사</span></div>${rows || '<p class="hint" style="padding:8px 12px">아직 노선이 없습니다.</p>'}</div>`;
  }
  function viewRivals(): string {
    const s = game.state;
      const gone = s.rivalsGone.length ? `<p class="hint">최근 퇴장: ${s.rivalsGone.slice(-3).reverse().map((x) => `${esc(x.name)}(${x.month}개월차 ${x.by ? `${esc(x.by)}에 합병` : x.acq ? '내가 인수' : '파산'})`).join(', ')}</p>` : '';
      const rk = game.ranking(), rank = `<h3>매출 순위 <small>최근 12개월 · 내 순위 ${game.rank()}위/${rk.length}곳</small></h3><div class="list">${rk.map((x, i) => `<div class="row"${x.me ? ' style="border-color:var(--accent)"' : ''}><div class="grow"><b>${i + 1}위 ${esc(x.name)}</b></div><div class="right">${money(x.revenue)}</div></div>`).join('')}</div><p class="hint">경쟁사 매출은 여객 매출만 추정한 값입니다.</p>`;
    if (!s.competitors.length) return `<h2>경쟁사</h2><p class="hint">지금은 경쟁사가 없습니다. 시간이 지나면 새 항공사가 생깁니다.</p>${gone}`;
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const mine = s.routes.filter((r) => r.open && game.planesOn(r.id).length > 0);
    const rows = s.competitors.map((k) => ({ k, rev: sum(k.revHist ?? []), grow: (k.pHist?.length ?? 0) > 1 ? k.planes - k.pHist![0] : 0, overlap: mine.filter((r) => k.routes.some((x) => (x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a))).length }));
    const sorted = tsorted('rivals', rows, (x, key) => (key === 'name' ? x.k.name : key === 'planes' ? x.k.planes : key === 'routes' ? x.k.routes.length : key === 'overlap' ? x.overlap : x.rev));
    const st = (k: typeof s.competitors[number]) => [s.alliance?.includes(k.id) ? '<b class="pos">동맹</b>' : '', s.rivalAlliance?.includes(k.id) ? '<b class="neg">스카이 동맹</b>' : '',k.stake ? `<b class="subc">${k.stake >= 0.51 ? '자회사' : '지분'} ${Math.round(k.stake * 100)}%</b>` : '', k.call ? '<b class="neg">증자 요청</b>' : '', s.rivalId === k.id ? '<b class="warn">라이벌</b>' : '', s.ally === k.id ? '<b class="pos">제휴</b>' : '', k.major ? '<b class="neg">대형</b>' : '', (k.low ?? 0) > 0 ? '<b class="neg">자금난</b>' : '', (s.threats ?? []).some((t) => t.comp === k.id) ? '<b class="warn">진출 예고</b>' : ''].filter(Boolean).join(' ');
    const gr = s.competitors.some((c) => (c.stake ?? 0) >= 0.51) ? game.groupRank() : null;
    const main = `<h2>경쟁사 <small>${s.competitors.length}곳 · 우리 매출 순위 ${game.rank()}위${gr ? ` · 그룹(우리+자회사) ${gr.rank}위/${gr.total}곳` : ''}${s.sandbox ? ` · 우리 동맹 ${(s.alliance ?? []).length}/${config.extra.alliance.max}` : ''}</small></h2>
      <div class="tbl" style="--cols: minmax(120px, 1.5fr) 1fr 0.9fr 0.6fr 0.9fr 0.8fr 1.2fr">${thead('rivals', [['name', '항공사'], ['', '유형'], ['planes', '항공기'], ['routes', '노선'], ['rev', '매출 12개월'], ['overlap', '겹치는 노선'], ['', '상태']])}
      ${sorted.map((x) => `<button class="trow${x.k.id === selComp ? ' sel' : ''}" data-act="selComp" data-id="${x.k.id}"><span><b>${esc(x.k.name)}</b></span><span><small>${x.k.style === 'low' ? '저가형' : '프리미엄형'}${game.traitOf(x.k) ? ` · ${game.traitOf(x.k)!.name}` : ''}</small></span><span>${x.k.planes}대${x.grow ? ` <small class="${x.grow > 0 ? 'pos' : 'neg'}">${x.grow > 0 ? '+' : ''}${x.grow}</small>` : ''}</span><span>${x.k.routes.length}개</span><span>${money(x.rev)}</span><span>${x.overlap ? `<b class="warn">${x.overlap}개</b>` : '0'}</span><span>${st(x.k)}</span></button>`).join('')}</div>
      ${gone}${s.routes.some((r) => r.open) ? `<p class="hint">우리 시장 점유율(경쟁사와 겹치는 노선의 좌석 점유): <b>${pct(game.marketShare)}</b>. 경쟁사 매출은 여객 매출만 추정한 값입니다.</p>` : ''}`;
    const k = selComp !== null ? s.competitors.find((x) => x.id === selComp) : undefined;
    const side = k ? `<button class="back" data-act="rivalsHome">${icon('back', 14)} 경쟁사 목록</button><div class="list"><div class="rowc"><div class="top"><div class="grow"><b>${esc(k.name)}</b><small>${k.style === 'low' ? '저가형' : '프리미엄형'} · 거점 ${esc(cityById(k.hub).name)} · 항공기 ${k.planes}대${(k.pHist?.length ?? 0) > 1 ? ` (${k.planes - k.pHist![0] >= 0 ? '+' : ''}${k.planes - k.pHist![0]} · ${k.pHist!.length - 1}개월)` : ''} · 노선 ${k.routes.length}개${s.ally === k.id ? ' · <b class="pos">제휴 중</b>' : ''}${game.traitOf(k) ? ` · <b title="${esc(game.traitOf(k)!.desc)}">${game.traitOf(k)!.name}</b>` : ''}${s.rivalId === k.id ? ' · <b class="warn">라이벌</b>' : ''}${k.major ? ' · <b class="neg">대형</b>' : (k.born ?? 0) > 0 && game.monthsPassed - (k.born ?? 0) < 6 ? ' · <b class="pos">신생</b>' : ''}${(k.low ?? 0) > 0 ? ' · <b class="neg">자금난</b>' : ''}</small></div></div><div class="btnrow"><button class="ghost" data-act="ally" data-id="${k.id}">${s.ally === k.id ? '제휴 해지' : `제휴 ${money(config.ally.fee)}/월`}</button>${s.sandbox && !k.major && !k.stake && !s.rivalAlliance?.includes(k.id) ? `<button class="ghost" data-act="${s.alliance?.includes(k.id) ? 'leaveAlliance' : 'joinAlliance'}" data-id="${k.id}">${s.alliance?.includes(k.id) ? '동맹 탈퇴' : `동맹 초대 ${money(config.extra.alliance.joinFee)}`}</button>` : ''}${k.major || !s.sandbox || s.rivalId === k.id ? '' : `<button class="ghost" data-act="setRival" data-id="${k.id}">라이벌 지정</button>`}${k.major ? '' : `<button class="ghost" data-act="acquire" data-id="${k.id}" ${no(s.cash < game.absorbPrice(k), short(game.absorbPrice(k)))}>${k.stake ? '완전 흡수' : '인수'} ${money(game.absorbPrice(k))}</button>`}</div></div>${subBlock(k)}</div>
      ${k.stake ? subRoutes(k) : compRoutes(k)}
      <p class="hint">경쟁사는 시간이 지나며 새로 생기고, 자금난이 길어지면 파산합니다. 제휴(공동 운항)하면 그 항공사가 같은 노선에서 우리 손님을 덜 빼앗고, 운임 경쟁도 걸어오지 않습니다. 한 번에 한 곳만.</p>${s.routes.some((r) => r.open) ? `<div class="row"><div class="grow"><b>우리 시장 점유율</b><small>경쟁사와 겹치는 노선에서의 좌석 점유</small></div><div class="right">${pct(game.marketShare)}</div></div>` : ''}` : `${rank}<p class="hint">왼쪽 표에서 항공사를 누르면 제휴·라이벌 지정·인수와 그 회사의 노선을 볼 수 있습니다.</p>`;
    return `<div class="split${k ? ' sel' : ''}"><div class="pmain" data-sc="m-rivals">${main}</div><div class="pside" data-sc="s-c${k?.id}">${side}</div></div>`;
  }
  /** 배당 내역: 지분을 가진 회사별 지난달·누적 배당과 최근 12개월 합계 */
  function divHtml(): string {
    const s = game.state, subs = s.competitors.filter((c) => c.stake), y = s.history.slice(-12).reduce((a, m) => a + (m.dividend ?? 0), 0);
    if (!subs.length && !y) return '';
    return `<h3>배당 내역 <small>최근 12개월 ${money(y)}</small></h3><div class="list">${subs.map((c) => `<div class="row"><div class="grow"><b>${esc(c.name)}</b><small>${c.stake! >= 0.51 ? `자회사 51% · ${esc(config.subsidiary.dirs[c.dir ?? 'grow'].name)}` : '지분 20%'} · 누적 ${money(c.divTotal ?? 0)}${c.call ? ' · <b class="neg">증자 요청</b>' : ''}</small></div><div class="right"><small>지난달</small><br><b class="${(c.lastDiv ?? 0) > 0 ? 'pos' : ''}">${money(c.lastDiv ?? 0)}</b></div></div>`).join('') || '<p class="hint">지금 지분을 가진 회사가 없습니다.</p>'}</div>`;
  }
  function funMoney(): string {
    const s = game.state; if (!s.sandbox) return '';
    const K = config.extra, l = s.loyalty ?? { level: 0, members: 0 };
    const loy = `<h3>마일리지 프로그램</h3><div class="seg">${K.loyalty.names.map((n, i) => `<button data-act="loyalty" data-v="${i}" class="${l.level === i ? 'on' : ''}">${n}</button>`).join('')}</div><p class="hint">회원 ${num(l.members)}명 · 수요 +${(game.loyaltyBoost * 100).toFixed(1)}% · 월 비용 ${money(game.loyaltyCost)}. 탑승객 일부가 회원이 되고, 회원이 많을수록 다시 타는 손님이 늘어 수요가 오릅니다(기본 최대 +6%, 풍성 최대 +12%). 혜택을 줄이면 회원 20%가 떠납니다.</p>`;
    const mg = s.mega, md = mg ? K.mega.list.find((x) => x.id === mg.id)! : null;
    const lp = s.history.at(-1)?.profit ?? 0;
    const mega = `<h3>대형 사업 <small>한 번에 하나 · 지난달 이익 ${money(lp)}</small></h3>${mg && md ? `<div class="goal"><div><b>${esc(md.name)}${mg.city ? ` · ${esc(cityById(mg.city).name)}` : ''}</b> <small>${mg.done}/${md.months}개월 · 매달 ${money(md.cost / md.months)}</small></div><div class="bar"><i style="width:${(mg.done / md.months) * 100}%"></i></div><small>${esc(md.desc)}</small><button class="ghost small" data-act="megaCancel">공사 중단(낸 돈은 돌려받지 못함)</button></div>` : `<div class="list">${K.mega.list.map((d) => { const done = (s.megaDone ?? []).includes(d.id) && d.id !== 'terminal'; return `<div class="row"><div class="grow"><b>${esc(d.name)}</b><small>${esc(d.desc)} · 총 ${money(d.cost)}(${d.months}개월 나눠 냄) · 매달 <span class="${d.cost / d.months > lp ? 'neg' : ''}">${money(d.cost / d.months)}</span>${d.cost / d.months > lp ? '(지난달 이익보다 큼)' : ''}${done ? ' · <b class="pos">완공</b>' : ''}</small></div>${done ? '' : `<button class="small" data-act="mega" data-v="${d.id}">착공</button>`}</div>`; }).join('')}</div>`}`;
    return loy + mega;
  }
  function viewMoney(): string {
    const s = game.state, h = s.history.slice(-24), mx = Math.max(1, ...h.map((m) => Math.abs(m.profit)));
    const bars = h.map((m) => `<i class="${m.profit >= 0 ? 'p' : 'n'}" style="height:${Math.max(4, (Math.abs(m.profit) / mx) * 54)}px" title="${m.month}개월: ${money(m.profit)}"></i>`).join('');
    const cur = s.cur;
    return `<div class="cols2"><div><h2>재무</h2>
      <div class="kv"><div>현금</div><div><b class="${s.cash < 0 ? 'neg' : ''}">${money(s.cash)}</b></div><div>이번 달 수익</div><div>${money(cur.revenue)}</div><div>이번 달 비용</div><div>${money(cur.cost)}</div>
        <div>월 고정비</div><div>${money(game.fixedMonthly)}</div><div>누적 이익</div><div>${money(s.cumProfit)}</div></div>
      ${divHtml()}
      <h3>월별 이익</h3>${h.length ? `<div class="chart">${bars}</div>` : '<p class="hint">첫 달이 끝나면 그래프가 나옵니다.</p>'}
      <h3>월말 정산</h3>${s.history.length ? `<div class="list">${[...s.history].reverse().slice(0, 12).map((m) => `<div class="row"><div class="grow"><b>${m.month}개월차</b><small>수익 ${money(m.revenue)}${m.dividend ? ` (배당 ${money(m.dividend)} 포함)` : ''} · 비용 ${money(m.cost + m.fixed)} · 탑승률 ${pct(m.loadFactor)}</small></div><div class="right ${m.profit >= 0 ? 'pos' : 'neg'}">${money(m.profit)}</div></div>`).join('')}</div>` : '<p class="hint">아직 정산한 달이 없습니다.</p>'}
      <p class="hint">월 이익 = 수익 − 운영비 − 감가상각 − 고정비. 현금이 ${money(config.rules.bankruptCash)} 아래로 ${config.rules.bankruptMonths}개월 이어지면 파산입니다.</p></div><div>${fold(`<h3>회사 업그레이드 <small>(한 번 사면 계속 유지)</small></h3><div class="list">${config.upgrades.list.map((u) => { const lv = game.upgradeLevel(u.id), price = game.upgradePrice(u.id); return `<div class="row"><div class="grow"><b>${esc(u.name)}</b><span class="pips">${config.upgrades.prices.map((_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span><small>단계마다 ${esc(u.desc)}</small></div>${price === null ? '<small class="pos">최고 단계</small>' : `<button data-act="upgrade" data-u="${u.id}" ${no(s.cash < price, short(price))}>${money(price)}</button>`}</div>`; }).join('')}</div>
      <h3>정비</h3><button class="wide ${s.autoMaint ? '' : 'ghost'}" data-act="autoMaint">자동 정비: <b>${s.autoMaint ? '켜짐' : '꺼짐'}</b></button>
      <p class="hint">켜면 노선에 배정된 항공기의 정비 상태가 ${Math.round(config.maint.autoBelow * 100)}% 아래로 떨어질 때 월말에 알아서 점검합니다(항공기 가격의 2%, 7일간 운항 불가). 현금이 모자라면 건너뜁니다.</p>
      <h3>연료</h3><div class="kv"><div>연료 가격</div><div><b>${game.fuelLabel}</b> (${(s.fuel * 100).toFixed(0)}%)</div><div>연료 계약</div><div>${s.hedge ? `${(s.hedge.price * 100).toFixed(0)}%로 고정 · ${s.hedge.monthsLeft}개월 남음` : '없음'}</div></div>
      <div class="btnrow">${config.fuel.hedgeTiers.map((t) => `<button data-act="hedge" data-m="${t.months}" class="${t.months === config.fuel.hedgeMonths ? '' : 'ghost'}" ${no(!!s.hedge || s.cash < t.cost, s.hedge ? '이미 연료 계약 중입니다' : short(t.cost))}>${t.months}개월 고정 ${money(t.cost)}</button>`).join('')}</div>
      <p class="hint">${s.hedge ? '' : s.fuel < 0.9 ? '지금 가격이 싼 편입니다. 길게 고정하면 이득일 수 있습니다.' : s.fuel > 1.15 ? '지금 가격이 비쌉니다. 고정하면 가격이 내려도 비싸게 냅니다. 짧게(3개월) 고정하는 것이 안전합니다.' : '가격이 보통입니다. 오를지 내릴지 알 수 없으니 급하지 않으면 기다려도 됩니다.'}</p>
      <h3>대출</h3>${s.freeze > 0 ? `<p class="hint"><b class="neg">경기 악화로 은행이 새 대출을 중단했습니다 (${s.freeze}개월 남음)</b></p>` : ''}<div class="kv"><div>대출 잔액</div><div><b>${money(s.loan)}</b></div><div>한도</div><div>${money(game.loanLimit)}</div><div>월 이율</div><div>${(game.loanRate * 100).toFixed(1)}% <small>(한도를 많이 쓸수록 비쌈)</small></div><div>월 이자</div><div>${money(s.loan * game.loanRate)}</div></div>
      <div class="btnrow half"><button data-act="borrow" ${no(s.loan + config.loan.step > game.loanLimit, `대출 한도를 넘습니다 (한도 ${money(game.loanLimit)}, 지금 잔액 ${money(s.loan)}). 항공기를 사면 한도가 늘어납니다.`)}>+${money(config.loan.step)} 대출</button><button class="ghost" data-act="repay" ${no(s.loan <= 0 || s.cash < Math.min(config.loan.step, s.loan), s.loan <= 0 ? '갚을 대출이 없습니다' : short(Math.min(config.loan.step, s.loan)))}>${money(Math.min(config.loan.step, s.loan || config.loan.step))} 상환</button></div>
      ${funMoney()}`)}</div></div>`;
  }

  function recordsHtml(): string {
    const r = game.state.records; if (!r) return '';
    const rows: [string, string, (v: number) => string][] = [['profit', '월 최고 이익', (v) => money(v)], ['pax', '월 최다 탑승객', (v) => `${num(v)}명`], ['longest', '최장 노선', (v) => km(v)], ['planes', '최대 기단', (v) => `${v}대`], ['cities', '최다 취항 도시', (v) => `${v}곳`], ['noFail', '최장 무고장', (v) => `${v}개월`]];
    return `<h4>개인 기록</h4><table class="brk">${rows.filter(([k]) => r[k]).map(([k, n, f]) => `<tr><td>${n}</td><td>${f(r[k].v)} <small>(${r[k].m}개월차)</small></td></tr>`).join('')}</table>`;
  }
  function achHtml(): string { const got = new Set(achieved(game)); return `<h3>업적 ${got.size}/${ACHIEVEMENTS.length}</h3><div class="list">${ACHIEVEMENTS.map((a) => `<div class="row"${got.has(a.id) ? '' : ' style="opacity:.45"'}><div class="grow"><b>${icon(got.has(a.id) ? 'medal' : 'lock')} ${esc(a.name)}</b><small>${esc(a.desc)}</small></div></div>`).join('')}</div>`; }
  function viewNews(): string {
    const log = [...game.state.log].reverse();
    const ev = game.state.events.map((e, i) => { const def = EVENTS.find((x) => x.id === e.def)!; return `<div class="row"><div class="grow"><b>진행 중: ${esc(def.name)}${e.city ? ` (${esc(cityById(e.city).name)})` : ''}</b><small>${e.monthsLeft}개월 남음${e.handled ? ' · 대응함' : def.option ? ` · ${esc(def.option.text)}` : ''}</small></div>${def.option && !e.handled ? `<button data-act="respond" data-id="${i}" ${no(game.state.cash < game.eventCost(def), short(game.eventCost(def)))}>${esc(def.option.label)} ${money(game.eventCost(def))}</button>` : ''}</div>`; }).join('');
    const kinds: ['all' | LogKind, string][] = [['all', '전체'], ['biz', '경영'], ['rival', '경쟁'], ['era', '시대·신기종'], ['goal', '계약·업적']];
    const shown = log.filter((l) => newsFilter === 'all' || logKind(l) === newsFilter), cut = newsAll ? shown : shown.slice(0, 40);
    const chips = `<div class="chips">${kinds.map(([v, t]) => `<button data-act="newsFilter" data-v="${v}" class="${newsFilter === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    const list = shown.length ? `<div class="list">${cut.map((l) => `<div class="row"><div class="grow">${esc(l)}</div></div>`).join('')}</div>${shown.length > cut.length ? `<button class="wide ghost" data-act="newsMore">이전 알림 ${shown.length - cut.length}개 더 보기</button>` : ''}` : (log.length ? '<p class="hint">이 종류의 알림이 없습니다.</p>' : '<p class="hint">아직 알림이 없습니다. 가끔 연료비·불황·폭설 같은 사건이 일어납니다.</p>');
    const head = `<h2>알림 <small>${log.length}개</small></h2>${chips}${list}`;
    return ev ? `<div class="cols2"><div>${head}</div><div><h3>진행 중인 사건</h3>${ev}</div></div>` : head;
  }
  
  /** 지도 오른쪽 위: 지금 시대와 예고된 다음 시대 */
  function renderEra() {
    const s = game.state, el = $('#era'), cur = game.eraNow, nxt = s.nextEra ? config.eras.list.find((x) => x.id === s.nextEra!.id) : null;
    el.hidden = !cur && !nxt;
    el.innerHTML = `${cur ? `<b>${esc(cur.name)}</b><small>${Math.max(0, s.era!.end - game.monthsPassed)}개월 남음</small>` : ''}${nxt ? `<small>예고: ${esc(nxt.name)} ${later(s.nextEra!.start - game.monthsPassed)}</small>` : ''}`;
    const mapBtn = $('#tabs button[data-tab="map"]'), n = s.contracts.filter((c) => c.status === 'offer').length + s.auctions.length; // 새 계약 제안·경매가 있으면 현황 탭에 표시
    if (n > 0 && tab !== 'map') mapBtn.dataset.badge = String(n); else delete mapBtn.dataset.badge;
  }
  function renderSum() {
    const s = game.state, open = s.routes.filter((r) => r.open && game.planesOn(r.id).length > 0), total = open.reduce((a, r) => { const d = game.routeDay(r); return a + (d.revenue - d.cost) * config.daysPerMonth; }, 0);
    const n = advise(game).length, pd = pending().length, h = s.history.at(-1);
    $('#dsum').textContent = `${pd ? `결정 ${pd} · ` : ''}${n ? `할 일 ${n} · ` : ''}노선 이익 월 ${money(total)}${h ? ` · 지난달 실제 ${money(h.profit)}` : ''}`;
  }
  function flushRender() { if (!renderLater) return; if (performance.now() - panelBusy < 900) window.setTimeout(flushRender, 300); else render(true); }
  /** auto: 시간이 흘러 저절로 다시 그리는 경우. 사용자가 패널을 스크롤·터치 중이면 잠시 미룬다(화면이 지 혼자 움직이는 느낌 방지) */
  /** 새로 생긴 결정거리(계약·이야기·전세기·입찰·증자): 지도 오른쪽 아래 구석 작은 팝업에 하나씩 줄 세운다. 실제 시간 12초 뒤 다음 것으로, 닫기는 줄 전체를 비운다 */
  const OFFER_MS = 12000, POP_HEAD: Record<string, string> = { 계약: '새 계약 제안', 이야기: '이야기', 전세기: '전세기 주문', 입찰: '입찰', 증자: '자회사 증자 요청' };
  let popSeen = new Set<string>(), popQ: string[] = [], popHead: string | null = null, offerTimer = 0;
  function popNext() { popQ.shift(); renderOffer(); }
  function popClear() { popQ = []; renderOffer(); }
  function renderOffer() {
    const el = $('#offerpop'), pd = pending().filter((p) => POP_HEAD[p.kind]), keys = new Set(pd.map((p) => p.key));
    const fresh = pd.filter((p) => !popSeen.has(p.key));
    if (fresh.length) { for (const p of fresh) { popSeen.add(p.key); popQ.push(p.key); } play('alert'); }
    popQ = popQ.filter((k) => keys.has(k)); // 이미 처리됐거나 마감된 것은 줄에서 뺀다
    if ((popQ[0] ?? null) !== popHead) { popHead = popQ[0] ?? null; clearTimeout(offerTimer); if (popHead) offerTimer = window.setTimeout(popNext, OFFER_MS); }
    const p = pd.find((x) => x.key === popHead), c = p?.cid !== undefined ? game.state.contracts.find((x) => x.id === p.cid) : undefined;
    if (!p || !$('#title').hidden) { el.hidden = true; return; }
    const html = `<div class="ophead"><b>${icon('report', 16)} ${POP_HEAD[p.kind]}</b>${popQ.length > 1 ? `<small>외 ${popQ.length - 1}건</small>` : ''}<button class="ghost" data-act="offerClose" aria-label="닫기">닫기</button></div><div class="optitle">${esc(p.title)}</div><small>${c ? `보상: ${esc(c.reward.label)}` : `${leftTxt(p.left)} 안에 결정`}</small><div class="btnrow">${c ? `<button data-act="acceptContract" data-id="${c.id}">수락</button><button class="ghost" data-act="declineContract" data-id="${c.id}">거절</button>` : ''}<button class="ghost" data-act="offerMore" data-k="${p.sec}" data-id="${p.comp ?? ''}">${c ? '자세히' : '보러 가기'}</button></div>`;
    if (el.innerHTML !== html) el.innerHTML = html;
    el.hidden = false;
  }
  function render(auto = false) {
    renderTop(); renderEra(); renderSum(); renderOffer();
    document.querySelectorAll<HTMLElement>('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'news') seenLog = game.state.log.length;
    const html = tab === 'map' ? viewMap() : tab === 'routes' ? viewRoutes() : tab === 'fleet' ? viewFleet() : tab === 'rivals' ? viewRivals() : tab === 'money' ? viewMoney() : viewNews();
    if (html !== lastHtml && auto && performance.now() - panelBusy < 900) { if (!renderLater) window.setTimeout(flushRender, 950); renderLater = true; } // 타이머로도 확실히 반영(화면 갱신 틱이 느려도)
    else if (html !== lastHtml) { renderLater = false; const y = panel.scrollTop; panel.classList.toggle('hasLive', html.includes('id="live"')); panel.classList.toggle('hasSplit', html.startsWith('<div class="split')); const sc = new Map([...panel.querySelectorAll<HTMLElement>('[data-sc]')].map((e) => [e.dataset.sc, e.scrollTop])); panel.innerHTML = html; panel.scrollTop = y; panel.querySelectorAll<HTMLElement>('[data-sc]').forEach((e) => { const v = sc.get(e.dataset.sc); if (v) e.scrollTop = v; }); lastHtml = html; panel.querySelectorAll<HTMLDetailsElement>('details').forEach((d) => { const o = detOpen.get(detKey(d)); if (o !== undefined) d.open = o; }); }
    renderEnd();
    renderHint();
  }
  let lastHtml = '', panelBusy = 0, renderLater = false;
  for (const ev of ['scroll', 'touchstart', 'touchmove', 'touchend', 'wheel']) panel.addEventListener(ev, () => { panelBusy = performance.now(); }, { passive: true });

  // ---- 첫 5분 안내: 말풍선 없이, 지도 아래 한 줄 + 눌러야 할 곳이 반짝임 ----
  /** 힌트용 첫 목적지: 시작 기종으로 갈 수 있는 가장 가까운 큰 도시(수요가 큰 곳 중 2,500km 안) */
  function hintDest(base: string): string {
    const A = cityById(base), t = typeById(game.state.planes[0]?.type ?? 'B737');
    let best: { id: string; sc: number } | null = null;
    for (const c of CITIES) { if (c.id === base || !game.cityOpen(c.id) || !canFly(t, A, c).ok || distanceKm(A, c) > 2500) continue; const sc = rawMonthlyDemand(A, c, game.month); if (!best || sc > best.sc) best = { id: c.id, sc }; }
    return best?.id ?? CITIES.find((c) => c.id !== base && game.cityOpen(c.id))?.id ?? CITIES.find((c) => c.id !== base)!.id;
  }
  function hintStep(): { text: string; city?: string; sel?: string } | null {
    const s = game.state;
    if (!hintsOn || s.status !== 'playing' || s.history.length >= 1) return null;
    const openRoutes = s.routes.filter((r) => r.open), assigned = openRoutes.some((r) => game.planesOn(r.id).length > 0);
    if (!openRoutes.length) {
      const base = s.base, dest = hintDest(base);
      if (selCity === base && tab === 'map') return { text: `② ${esc(cityById(dest).name)} 옆의 ‘열기’ 버튼을 눌러 노선을 만드세요`, sel: `button[data-act="open"][data-b="${dest}"]` };
      return { text: `① 지도에서 ${esc(eulReul(cityById(base).name))} 눌러 보세요`, city: base };
    }
    if (!assigned) return tab === 'routes' && selRoute !== null ? { text: '③ ‘배정’ 버튼으로 항공기를 이 노선에 보내세요', sel: '#panel button[data-act="assign"]' } : { text: '③ 아래 ‘노선’ 탭에서 항공기를 배정하세요', sel: '#tabs button[data-tab="routes"]' };
    if (speed === 0) return { text: '④ 위쪽 ‘1×’ 버튼을 눌러 시간을 흘려 보세요', sel: '#speeds button[data-speed="1"]' };
    return { text: '⑤ 시간이 흐르는 동안 ‘노선’ 탭의 운임 슬라이더를 움직여 보세요. 탑승률이 꽉 차면 올리고, 비면 내리세요', sel: tab === 'routes' ? '#fare' : '#tabs button[data-tab="routes"]' };
  }
  let hintScrolled = '';
  function renderHint() {
    const h = hintStep(), el = $('#hint');
    document.querySelectorAll('.pulse').forEach((e) => e.classList.remove('pulse'));
    map.setPulse(h?.city ?? null);
    el.hidden = !h;
    if (!h) return;
    $('#hint-text').textContent = h.text;
    if (h.sel) { const els = document.querySelectorAll<HTMLElement>(h.sel); els.forEach((e) => e.classList.add('pulse')); if (els[0] && panel.contains(els[0]) && h.text !== hintScrolled) { hintScrolled = h.text; els[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } } // 패널 안에 있으면 보이는 곳으로 스크롤(새 안내가 나왔을 때 한 번만: 매번 하면 사거나 고칠 때마다 화면이 운임 쪽으로 튄다)
  }
  $('#hint-off').addEventListener('click', () => { hintsOn = false; try { localStorage.setItem(HINT_KEY, 'off'); } catch { /* 저장 불가 */ } renderHint(); toast('힌트를 껐습니다. 메뉴에서 다시 켤 수 있어요'); });

  // ---- 월간 보고서: 월말마다 지도 위에 요약 카드(닫기 또는 다음 달에 갱신) ----
  let prevComp = '';
  function goAdvice(i: number): boolean { const a = advList[i]; if (!a) return false; selRoute = a.routeId ?? null; selCity = a.routeId === undefined ? a.cityId ?? null : null; tab = a.tab ?? 'map'; syncMap(); if (a.cityId) map.focusCity(a.cityId); return true; }
  function showReport() {
    const s = game.state, h = s.history.at(-1), el = $('#report');
    if (!h || s.status !== 'playing') { el.hidden = true; return; }
    const { best, worst } = bestWorst(routeMonthStats(game));
    const evs = s.log.filter((l) => l.startsWith(`${h.month}개월차`) || l.startsWith(`${h.month + 1}개월차`)).slice(-3);
    const stats = routeMonthStats(game).sort((a, b) => b.profit - a.profit).slice(0, 5), mxp = Math.max(0.01, ...stats.map((x) => Math.abs(x.profit)));
    const bars = stats.length > 1 ? `<h5>노선별 이익(상위 ${stats.length})</h5>${stats.map((x) => `<div class="rb"><span>${esc(x.label)}</span><i class="${x.profit >= 0 ? '' : 'n'}" style="width:${Math.max(3, (Math.abs(x.profit) / mxp) * 100)}%"></i><b class="${x.profit >= 0 ? 'pos' : 'neg'}">${money(x.profit)}</b></div>`).join('')}` : '';
    const yr = h.month % 12 === 0 ? s.history.slice(-12) : null; // 12개월마다 한 해 결산
    const year = yr ? `<h5>${icon('calendar', 14)}${h.month / 12}년차 결산</h5><div class="rl"><span>한 해 이익</span><span class="${yr.reduce((a, m) => a + m.profit, 0) >= 0 ? 'pos' : 'neg'}">${money(yr.reduce((a, m) => a + m.profit, 0))}</span></div><div class="rl"><span>탑승객</span><span>${num(yr.reduce((a, m) => a + m.pax, 0))}명</span></div><div class="rl"><span>기단 · 취항 도시</span><span>${s.planes.length}대 · ${game.servedCities().size}곳</span></div><div class="rl"><span>업계 순위(매출)</span><span>${game.rank()}위 / ${game.state.competitors.length + 1}곳</span></div><button class="ghost small" data-act="paper" data-y="${h.month / 12}" style="margin:6px 0">연말 신문 보기</button><div class="rl"><span>가장 좋았던 달</span><span>${[...yr].sort((a, b) => b.profit - a.profit)[0].month}개월차 ${money(Math.max(...yr.map((m) => m.profit)))}</span></div>${best ? `<div class="rl"><span>올해의 노선</span><span class="pos">${esc(best.label)}</span></div>` : ''}` : '';
    advList = advise(game);
    const todo = advList.length ? `<h5>이번 달 결정할 것</h5>${advList.slice(0, 2).map((a, i) => `<button class="ghost todo" data-act="advice" data-i="${i}"><span class="dot ${a.level}"></span>${esc(a.text)}</button>`).join('')}` : '';
    const subsR = s.competitors.filter((k) => k.stake), subLine = subsR.length ? `<div class="rl"><span>자회사·지분 ${subsR.length}곳</span><span>이익 ${money(subsR.reduce((a, k) => a + (k.hist?.at(-1)?.profit ?? 0), 0))} · 배당 ${money(subsR.reduce((a, k) => a + (k.lastDiv ?? 0), 0))}</span></div>` : '';
    const comp = s.competitors.map((k) => `${k.name} ${k.planes}대·${k.routes.length}노선`).join(', ');
    const compNote = prevComp && prevComp !== comp ? `<div class="rl"><span>경쟁사 변화</span><span>${esc(comp)}</span></div>` : '';
    prevComp = comp;
    el.hidden = false;
    if (h.month !== reportMonth) { reportMonth = h.month; reportOpen = !!yr; } // 새 보고는 한 줄로 시작(연말 결산만 펼쳐서)
    el.classList.toggle('collapsed', !reportOpen);
    el.innerHTML = `<h4><span>${icon('report')}${h.month}개월차 보고 <small class="${h.profit >= 0 ? 'pos' : 'neg'}">${money(h.profit)}</small></span><span class="rbtns"><button class="ghost" data-act="toggleReport">${reportOpen ? '접기' : '펼치기'}</button><button class="ghost" data-act="closeReport">닫기</button></span></h4>
      <div class="rl"><span>월 이익</span><span class="${h.profit >= 0 ? 'pos' : 'neg'}">${money(h.profit)}</span></div>
      <div class="rl"><span>탑승률 · 정시율</span><span>${pct(h.loadFactor)} · ${pct(game.avgOtp)}</span></div>
      <div class="rl"><span>현금</span><span>${money(h.cash)}</span></div>
      ${todo}
      <details class="more" ${yr ? 'open' : ''}><summary>자세히 보기</summary>${best ? `<div class="rl"><span>최고 노선</span><span class="pos">${esc(best.label)} ${money(best.profit)}</span></div>` : ''}
      ${worst && best && worst.routeId !== best.routeId ? `<div class="rl"><span>최저 노선</span><span class="${worst.profit >= 0 ? '' : 'neg'}">${esc(worst.label)} ${money(worst.profit)}</span></div>` : ''}
      <div class="rl"><span>경기 · 연료</span><span>${game.economyLabel} · ${game.fuelLabel}</span></div>
      ${bars}${year}${compNote}${subLine}${evs.map((e) => `<small>• ${esc(e)}</small><br>`).join('')}</details>`;
  }
  $('#report').addEventListener('click', (e) => { const t = e.target as HTMLElement; if (t.closest('[data-act="closeReport"]')) $('#report').hidden = true; if (t.closest('[data-act="toggleReport"]')) { reportOpen = !reportOpen; showReport(); return; } const ad = t.closest<HTMLElement>('[data-act="advice"]'); if (ad && goAdvice(Number(ad.dataset.i))) { $('#report').hidden = true; play('tap'); lastHtml = ''; render(); } const pb = t.closest<HTMLElement>('[data-act="paper"]'); if (pb) showPaper(Number(pb.dataset.y)); });
  $('#info-body').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]'); if (b) void infoAct(b); });

  // ---- 끝난 게임 ----
  let recorded = false;
  function records(): Record<string, Rec[]> { try { return JSON.parse(localStorage.getItem(REC_KEY) ?? '{}'); } catch { return {}; } }
  function saveRecord() {
    const s = game.state, all = records(), id = s.scenario ?? 'free';
    const list = [...(all[id] ?? []), { score: game.score, status: s.status, months: game.monthsPassed, base: s.base, diff: s.difficulty ?? 'normal', when: new Date().toISOString().slice(0, 10) } as Rec].sort((a, b) => b.score - a.score).slice(0, 5);
    all[id] = list;
    try { localStorage.setItem(REC_KEY, JSON.stringify(all)); } catch { /* 저장 불가 */ }
  }
  function renderRecords() {
    const all = records();
    $('#records').innerHTML = SCENARIOS.map((sc) => { const b = all[sc.id]?.[0]; return b ? `<div>${esc(sc.name)} 최고 <b>${num(b.score)}점</b> (${DIFF_NAME[b.diff]}, ${esc(cityById(b.base).name)}, ${b.when})</div>` : ''; }).join('') || '<div>아직 기록이 없습니다.</div>';
  }
  function renderEnd() {
    const el = $('#end'), s = game.state;
    el.hidden = s.status === 'playing';
    $('#end-continue').hidden = !(s.status === 'won' || s.status === 'timeup');
    if (s.status === 'playing') return;
    if (!recorded) play(s.status === 'bankrupt' ? 'lose' : 'win');
    const title = s.status === 'won' ? '목표를 달성했습니다!' : s.status === 'bankrupt' ? '파산했습니다' : '제한 기간이 끝났습니다';
    $('#end-title').innerHTML = `<span style="-webkit-text-fill-color:${s.status === 'won' ? '#e8a13a' : '#8a96a3'};color:${s.status === 'won' ? '#e8a13a' : '#8a96a3'}">${icon(s.status === 'won' ? 'trophy' : s.status === 'bankrupt' ? 'alert' : 'calendar', 30)}</span>${title}`; // 제목 문자열은 고정 문구라 안전
    if (!recorded) { recorded = true; if (!s.sandbox) saveRecord(); }
    const best = s.sandbox ? undefined : records()[s.scenario ?? 'free']?.[0];
    $('#end-body').textContent = `${s.sandbox ? '자유 모드' : game.scenario.name} · ${DIFF_NAME[s.difficulty ?? 'normal']} · ${game.monthsPassed}개월 · 누적 이익 ${money(s.cumProfit)} · 현금 ${money(s.cash)} · 항공기 ${s.planes.length}대 · 점수 ${num(game.score)}${best ? ` (이 시나리오 최고 ${num(best.score)})` : ''}`;
  }

  // ---- 행동(패널 안의 버튼) ----
  panel.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    if (b.dataset.why) { err(b.dataset.why); return; } // 눌러도 되지 않는 버튼은 이유를 알려 준다
    const act = b.dataset.act!, id = Number(b.dataset.id);
    const SND: Record<string, Sfx> = { open: 'takeoff', assign: 'takeoff', buy: 'buy', buyUsed: 'buy', lease: 'buy', buyOut: 'buy', buySlot: 'buy', rbuy: 'buy', auction: 'buy', acquire: 'achieve', story: 'ok', adRoute: 'buy', charter: 'takeoff', bid: 'buy', mega: 'buy', joinAlliance: 'achieve', preorder: 'buy', hubBulk: 'buy', replace: 'buy', livery: 'tap', buyStake: 'achieve', fundSub: 'buy', stance: 'ok', svc: 'buy', bulk: 'ok', buyRights: 'achieve', acceptContract: 'ok', hub: 'buy', declineContract: 'tap', hedge: 'buy', upgrade: 'achieve', borrow: 'buy', ally: 'ok', sell: 'sell', close: 'sell', repay: 'sell', service: 'ok', respond: 'ok' };
    const done = (m?: string) => { if (m) toast(m); play(SND[act] ?? 'tap'); lastHtml = ''; render(); };
    if (act === 'open') { const r = game.openRoute(b.dataset.a!, b.dataset.b!); if (!r.ok) return err(r.error); selRoute = r.routeId; selCity = null; tab = 'routes'; syncMap(); done('노선을 열었습니다. 항공기를 배정하세요.'); }
    else if (act === 'pend') { play('tap'); goPend(b.dataset.k!, b.dataset.id || undefined); }
    else if (act === 'advice') { if (!goAdvice(Number(b.dataset.i))) return; done(); }
    else if (act === 'goRoute') { selRoute = id; selCity = null; tab = 'routes'; syncMap(); done(); }
    else if (act === 'routesHome') { selRoute = null; syncMap(); done(); }
    else if (act === 'fillFare' && selRoute !== null) { fillFare(game, selRoute); done('운임을 맞췄습니다'); }
    else if (act === 'close' && selRoute !== null) { const cr = game.route(selRoute)!; if (!await ask(`${routeLabel(cr.a, cr.b)} 노선을 닫을까요? 배정된 항공기는 대기 상태가 됩니다.`)) return; game.closeRoute(selRoute); selRoute = null; syncMap(); done('노선을 닫았습니다'); }
    else if (act === 'unassign') { game.unassign(id); done(); }
    else if (act === 'weekly') { const p = game.plane(id)!; await assignOffer(id, p.routeId!, p.weekly + Number(b.dataset.d)); done(); }
    else if (act === 'assign' && selRoute !== null) { const r = game.route(selRoute)!, p = game.plane(id)!; const max = maxWeeklyRoundTrips(distanceKm(cityById(r.a), cityById(r.b)), typeById(p.type)); if (!await assignOffer(id, selRoute, max)) return; fillFare(game, selRoute); done('배정했습니다 (운임도 자동으로 맞췄어요)'); }
    else if (act === 'tsort') { const t = b.dataset.t!, k = b.dataset.k!, cur = tsort[t]; tsort[t] = { k, d: cur.k === k ? -cur.d : k === 'name' || k === 'type' || k === 'route' ? 1 : -1 }; done(); }
    else if (act === 'selPlane') { selPlane = selPlane === id ? null : id; syncMap(); done(); }
    else if (act === 'selComp') { selComp = selComp === id ? null : id; syncMap(); done(); }
    else if (act === 'fleetHome') { selPlane = null; done(); }
    else if (act === 'rivalsHome') { selComp = null; done(); }
    else if (act === 'rbuy' && selRoute !== null) {
      const how = b.dataset.how as 'new' | 'used' | 'lease', tid = b.dataset.t!, plan = game.purchasePlan(selRoute, tid, how);
      if (!plan.ok) return err(plan.error);
      const t = typeById(tid), what = how === 'lease' ? `보증금 ${money(plan.price)}` : money(plan.price);
      if (plan.slotCost > 0 && !await ask(`${t.name}(${how === 'new' ? '새것' : how === 'used' ? '중고' : '임대'}) ${what} + 슬롯 ${plan.slotNeeds.map((x) => `${cityById(x.city).name} ${x.n}개`).join(', ')} ${money(plan.slotCost)} = 합계 ${money(plan.total)}을 낼까요?`)) return;
      const had = game.planesOn(selRoute).length, res = game.buyForRoute(selRoute, tid, how);
      if (!res.ok) return err(res.error);
      if (!had) fillFare(game, selRoute);
      done(`${t.name}을(를) ${how === 'lease' ? '임대해' : '사서'} 이 노선에 배정했습니다 (주 ${res.weekly}회)`);
    }
    else if (act === 'priority' && selRoute !== null) { const r = game.setPriority(selRoute, Number(b.dataset.v)); if (!r.ok) return err(r.error); done(`공항 우선순위를 ${b.dataset.v}단계로 바꿨습니다`); }
    else if (act === 'upgrade') { const u = config.upgrades.list.find((x) => x.id === b.dataset.u)!, r = game.buyUpgrade(u.id); if (!r.ok) return err(r.error); done(`${u.name} ${r.level}단계로 올렸습니다`); }
    else if (act === 'auction') { const r = game.buyAuction(id); if (!r.ok) return err(r.error); done('경매에서 항공기를 낙찰받았습니다. 노선에 배정하세요.'); }
    else if (act === 'newsFilter') { newsFilter = b.dataset.v as typeof newsFilter; newsAll = false; done(); }
    else if (act === 'newsMore') { newsAll = true; done(); }
    else if (act === 'hub') { const kind = b.dataset.kind as 'terminal' | 'mro' | 'lounge', r = game.buyHub(b.dataset.city!, kind); if (!r.ok) return err(r.error); done(`${cityById(b.dataset.city!).name} ${config.invest[kind].name} ${r.level}단계를 완공했습니다`); }
    else if (act === 'acceptContract') { const r = game.acceptContract(id); if (!r.ok) return err(r.error); done('계약을 수락했습니다'); }
    else if (act === 'declineContract') { const r = game.declineContract(id); if (!r.ok) return err(r.error); done('계약을 거절했습니다'); }
    else if (act === 'buyRights') { const r = game.buyRights(b.dataset.region!); if (!r.ok) return err(r.error); done(`${game.regionName(b.dataset.region!)} 운수권을 얻었습니다`); }
    else if (act === 'autoFare') { game.setAutoFare(!game.state.autoFare); done(game.state.autoFare ? '자동 운임을 켰습니다' : '자동 운임을 껐습니다'); }
    else if (act === 'rename' && selRoute !== null) { const cur = game.route(selRoute)!, v = window.prompt('노선 별명 (16자까지, 비우면 지움)', cur.name ?? ''); if (v === null) return; game.setRouteName(selRoute, v); done(); }
    else if (act === 'autoMaint') { game.setAutoMaint(!game.state.autoMaint); done(game.state.autoMaint ? '자동 정비를 켰습니다' : '자동 정비를 껐습니다'); }
    else if (act === 'service') { const r = game.service(id); if (!r.ok) return err(r.error); done(`정비를 시작했습니다 (${money(r.cost)}, 7일간 운항 불가)`); }
    else if (act === 'hedge') { const r = game.hedgeFuel(Number(b.dataset.m) || undefined); if (!r.ok) return err(r.error); done('연료 계약을 맺었습니다'); }
    else if (act === 'buySlot') { const r = game.buySlot(b.dataset.city!); if (!r.ok) return err(r.error); done(`슬롯을 샀습니다 (${money(r.price)})`); }
    else if (act === 'cabin') { const r = game.setCabin(id, Number(b.dataset.share)); if (!r.ok) return err(r.error); done(); }
    else if (act === 'borrow') { const r = game.borrow(config.loan.step); if (!r.ok) return err(r.error); done(`${money(config.loan.step)}를 대출받았습니다`); }
    else if (act === 'repay') { const r = game.repay(config.loan.step); if (!r.ok) return err(r.error); done('대출을 갚았습니다'); }
    else if (act === 'sell') { const p = game.plane(id); if (!p) return; if (!await ask(p.leased ? `${typeById(p.type).name}을(를) 반납할까요? 보증금 ${money(p.deposit ?? 0)}을 돌려받고 위약금 ${money(game.leaseReturnFee(p))}을 냅니다.` : `${typeById(p.type).name}을(를) ${money(p.book * config.sale.ratio)}에 팔까요?`)) return; const r = game.sellPlane(id); if (!r.ok) return err(r.error); done(p.leased ? '임대기를 반납했습니다' : `항공기를 ${money(r.price)}에 팔았습니다`); }
    else if (act === 'buyUsed') { const r = game.buyPlane(b.dataset.id!, true); if (!r.ok) return err(r.error); done('중고 항공기를 샀습니다. 노선에 배정하세요.'); }
    else if (act === 'buyOut') { const p = game.plane(id); if (!p) return; if (!await ask(`${typeById(p.type).name}을(를) ${money(game.leaseBuyoutPrice(p))}에 사서 내 항공기로 만들까요? (보증금 ${money(p.deposit ?? 0)}은 돌려받아 뺍니다)`)) return; const r = game.buyOutLease(id); if (!r.ok) return err(r.error); done('임대기를 매입했습니다. 이제 내 항공기입니다.'); }
    else if (act === 'lease') { const r = game.leasePlane(b.dataset.id!); if (!r.ok) return err(r.error); done('항공기를 임대했습니다. 노선에 배정하세요.'); }
    else if (act === 'acquire') { const k = game.state.competitors.find((x) => x.id === id); if (!k) return; if (!await ask(`${k.name}을(를) ${money(game.absorbPrice(k))}에 ${k.stake ? '완전 흡수(남은 지분 인수)' : '인수'}할까요?\n이 항공사는 사라지고, 항공기 ${Math.min(config.acquire.maxPlanes, k.planes)}대(중고)와 ${cityById(k.hub).name} 슬롯 ${config.acquire.slots}개를 받습니다.${(k.low ?? 0) > 0 ? '\n(자금난이라 싸게 살 수 있습니다)' : ''}`)) return; const r = game.acquireCompetitor(id); if (!r.ok) return err(r.error); done(`${k.name}을(를) 인수했습니다`); }
    else if (act === 'bulk') {
      const v = b.dataset.v ?? '', open = game.state.routes.filter((r) => r.open);
      if (v === 'closeLoss') {
        const loss = open.filter((r) => game.planesOn(r.id).length && (() => { const d = game.routeDay(r); return d.revenue < d.cost; })());
        if (!loss.length) return err('적자 노선이 없습니다');
        if (!await ask(`적자 노선 ${loss.length}개를 닫을까요?\n배정된 항공기는 대기 상태가 되고, 평판이 조금 떨어집니다. ${config.reopen.months}개월 안에 다시 열면 재개 비용 ${money(config.reopen.fee)}이 듭니다.`)) return;
        for (const r of loss) game.closeRoute(r.id);
        selRoute = null; syncMap(); return done(`노선 ${loss.length}개를 닫았습니다`);
      }
      for (const r of open) {
        if (v.startsWith('fare')) { const f = v === 'fareUp' ? 1.05 : v === 'fareDown' ? 0.95 : 0; game.setFare(r.id, f ? r.fare * f : game.routeBaseFare(r)); if (r.fareBiz > 0) game.setFareBiz(r.id, f ? r.fareBiz * f : game.routeBaseFareBiz(r)); }
        else if (v.startsWith('pri')) game.setPriority(r.id, Number(v.slice(3)));
      }
      done(`노선 ${open.length}개에 적용했습니다`);
    }
    else if (act === 'assignTo') { const rid = Number(b.dataset.r), a = game.assignAdvice(id, 9).find((x) => x.routeId === rid); if (!a) return err('지금은 배정할 수 없습니다'); if (!await assignOffer(id, rid, a.weekly)) return; fillFare(game, rid); done('배정했습니다 (운임도 자동으로 맞췄어요)'); }
    else if (act === 'story') { const r = game.chooseStory(Number(b.dataset.i)); if (!r.ok) return err(r.error); done(r.text); }
    else if (act === 'setRival') { const r = game.setRival(id); if (!r.ok) return err(r.error); done('라이벌로 정했습니다'); }
    else if (act === 'adRoute') { const r = game.adRoute(id); if (!r.ok) return err(r.error); done('맞대응 광고를 시작했습니다'); }
    else if (act === 'matchFare') { const r = game.matchRivalFare(id); if (!r.ok) return err(r.error); done('상대 운임 수준으로 맞췄습니다'); }
    else if (act === 'destSort') { destSort = b.dataset.v as typeof destSort; done(); }
    else if (act === 'destNew') { destNew = !destNew; done(); }
    else if (act === 'stance') { const r = game.route(id); if (!r) return; const on = r.stance !== 'share', res = game.setStance(id, on); if (!res.ok) return err(res.error); done(on ? '점유율 우선 운임을 켰습니다' : '점유율 우선 운임을 껐습니다'); }
    else if (act === 'svc') { const res = game.setService(id, Number(b.dataset.v)); if (!res.ok) return err(res.error); done('서비스 등급을 바꿨습니다'); }
    else if (act === 'buyStake') { const k = game.state.competitors.find((x) => x.id === id); if (!k) return; const pct = Number(b.dataset.v); if (!await ask(`${k.name}의 지분 ${Math.round(pct * 100)}%를 ${money(game.stakePrice(k, pct))}에 살까요?\n회사는 그대로 운영되고 매달 배당을 받습니다.${pct >= 0.51 ? ' 경영권을 가져 운영 방향을 정할 수 있습니다.' : ''}`)) return; const r = game.buyStake(id, pct); if (!r.ok) return err(r.error); done(`${k.name} 지분 ${Math.round(pct * 100)}%를 샀습니다`); }
    else if (act === 'subDir') { const r = game.setSubDir(id, b.dataset.v as 'grow' | 'profit' | 'attack'); if (!r.ok) return err(r.error); done('운영 방향을 바꿨습니다'); }
    else if (act === 'sellStake') { const k = game.state.competitors.find((x) => x.id === id); if (!k || !await ask(`${k.name} 지분을 팔까요?`)) return; const r = game.sellStake(id); if (!r.ok) return err(r.error); done(`지분을 ${money(r.price)}에 팔았습니다`); }
    else if (act === 'fundSub') { const r = game.fundSubsidiary(id); if (!r.ok) return err(r.error); done(`${money(r.price)}을 증자했습니다`); }
    else if (act === 'planeName') { const p = game.plane(id); if (!p) return; const v = window.prompt('항공기 이름 (12자까지, 비우면 지움)', p.name ?? ''); if (v === null) return; game.setPlaneName(id, v); done(); }
    else if (act === 'livery') { const r = game.setLivery(b.dataset.v ?? ''); if (!r.ok) return err(r.error); done('도색을 바꿨습니다'); }
    else if (act === 'replace') { const p = game.plane(id), tid = b.dataset.t!, o = game.replaceOptions(id).find((x) => x.type === tid); if (!p || !o) return err('지금은 바꿀 수 없습니다'); if (!await ask(`${p.name ?? typeById(p.type).name}을(를) ${typeById(tid).name}(으)로 교체할까요?\n순비용 ${money(o.cost)}, 월 이익 +${money(o.gain)} 추정.`)) return; const r = game.replacePlane(id, tid); if (!r.ok) return err(r.error); selPlane = r.planeId; done('교체했습니다'); }
    else if (act === 'subTarget') { const v = b.dataset.v; const r = game.setSubTarget(id, v ? Number(v) : null); if (!r.ok) return err(r.error); done('공세 대상을 정했습니다'); }
    else if (act === 'subRegion') { const v = b.dataset.v; const r = game.setSubRegion(id, v || null); if (!r.ok) return err(r.error); done('확장 지역을 정했습니다'); }
    else if (act === 'lendPlane') { const r = game.lendPlane(Number(b.dataset.p), id); if (!r.ok) return err(r.error); done(`빌려주었습니다(월 임대료 ${money(r.rent)})`); }
    else if (act === 'recallPlane') { const r = game.recallPlane(id); if (!r.ok) return err(r.error); done('한 대를 돌려받았습니다(기단에서 대기 중)'); }
    else if (act === 'shopSort') { shopSort = b.dataset.v as typeof shopSort; done(); }
    else if (act === 'hubBulk') { const city = b.dataset.city!, mode = b.dataset.v as 'one' | 'max', plan = game.hubBulkPlan(city, mode); if (!await ask(`${cityById(city).name} 허브 투자 ${plan.list.length}건을 ${money(plan.total)}에 한꺼번에 살까요?\n(단계마다 월 운영비 ${money(config.investUpkeep)})`)) return; const r = game.buyHubBulk(city, mode); if (!r.ok) return err(r.error); done(`허브 투자 ${r.count}건을 완료했습니다`); }
    else if (act === 'charter') { const r = game.acceptCharter(id, Number(b.dataset.p)); if (!r.ok) return err(r.error); done('전세 운항을 시작했습니다'); }
    else if (act === 'bid') { const r = game.placeBid(id); if (!r.ok) return err(r.error); done(`${money(r.amount)}을 불렀습니다`); }
    else if (act === 'loyalty') { const r = game.setLoyalty(Number(b.dataset.v)); if (!r.ok) return err(r.error); done('마일리지 혜택을 바꿨습니다'); }
    else if (act === 'mega') { const d = config.extra.mega.list.find((x) => x.id === b.dataset.v); if (!d || !await ask(`${d.name}을(를) 착공할까요?\n총 ${money(d.cost)}을 ${d.months}개월에 나눠 냅니다. ${d.desc}.`)) return; const r = game.startMega(d.id); if (!r.ok) return err(r.error); done('착공했습니다'); }
    else if (act === 'megaCancel') { if (!await ask('공사를 중단할까요? 지금까지 낸 돈은 돌려받지 못합니다.')) return; game.cancelMega(); done('공사를 중단했습니다'); }
    else if (act === 'joinAlliance') { const r = game.joinAlliance(id); if (!r.ok) return err(r.error); done('동맹에 들어왔습니다'); }
    else if (act === 'leaveAlliance') { const r = game.leaveAlliance(id); if (!r.ok) return err(r.error); done('동맹에서 나갔습니다'); }
    else if (act === 'preorder') { const r = game.preorder(b.dataset.t!, 1); if (!r.ok) return err(r.error); done(`선주문했습니다(계약금 ${money(r.deposit)})`); }
    else if (act === 'ally') { const on = game.state.ally === id, r = game.setAlly(on ? null : id); if (!r.ok) return err(r.error); done(on ? '제휴를 해지했습니다' : '제휴를 맺었습니다'); }
    else if (act === 'respond') { const r = game.respondEvent(id); if (!r.ok) return err(r.error); done('사건에 대응했습니다'); }
    else if (act === 'buy') { const r = game.buyPlane(b.dataset.id!); if (!r.ok) return err(r.error); done('항공기를 샀습니다. 노선에 배정하세요.'); }
  });
  panel.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'fareBiz' && selRoute !== null) { game.setFareBiz(selRoute, Number(t.value)); const hs = panel.querySelectorAll('h3 b'); hs.forEach((h) => { if (h.parentElement?.textContent?.includes('비즈니스 운임')) h.textContent = fare(game.route(selRoute!)!.fareBiz); }); }
    if (t.id === 'cargoRatio' && selRoute !== null) { game.setCargoRatio(selRoute, Number(t.value)); panel.querySelectorAll('h3').forEach((h) => { if (h.textContent?.includes('화물 운임 배율')) h.querySelector('b')!.textContent = `×${game.route(selRoute!)!.cargoRatio.toFixed(2)}`; }); }
    if (t.id === 'fare' && selRoute !== null) { game.setFare(selRoute, Number(t.value)); const h3 = panel.querySelector('h3 b'); if (h3) h3.textContent = fare(game.route(selRoute)!.fare); }
  });
  panel.addEventListener('input', () => { const el = panel.querySelector('#live'); if (el && selRoute !== null) el.innerHTML = liveHtml(selRoute); });
  panel.addEventListener('change', (e) => { if (['fare', 'fareBiz', 'cargoRatio'].includes((e.target as HTMLElement).id)) { lastHtml = ''; render(); } });

  // ---- 탭·속도·메뉴 ----
  $('#tabs').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]'); if (!b) return; tab = b.dataset.tab as Tab; if (drawer === 'min') setDrawer('half'); selCity = selRoute = null; selPlane = selComp = null; syncMap(); panel.scrollTop = 0; lastHtml = ''; render(); }); // 탭을 누르면 항상 그 탭의 첫 화면
  $('#fold').addEventListener('click', () => setDrawer(drawer === 'min' ? 'half' : 'min'));
  { // 서랍 윗부분(손잡이·탭 줄의 빈 곳)을 위아래로 끌면 높이가 바뀌고, 놓으면 가까운 단계(접기·절반·크게)로 맞춘다
    const st = $('#stage'), grip = $('#dgrip'); let startY = 0, startH = 0, dragging = false;
    const begin = (e: PointerEvent) => { if ((e.target as HTMLElement).closest('button')) return; dragging = true; startY = e.clientY; startH = $('#drawer').getBoundingClientRect().height; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (!dragging) return; const H = st.getBoundingClientRect().height, h = Math.max(56, Math.min(H - 40, startH + (startY - e.clientY))); st.style.setProperty('--dh', `${h}px`); };
    const end = () => { if (!dragging) return; dragging = false; const H = st.getBoundingClientRect().height, h = $('#drawer').getBoundingClientRect().height; st.style.removeProperty('--dh'); const r = h / H; setDrawer(r < 0.25 ? 'min' : r < 0.7 ? 'half' : 'full'); lastHtml = ''; render(); };
    for (const el of [grip, $('#dsum')]) { el.addEventListener('pointerdown', begin as EventListener); el.addEventListener('pointermove', move as EventListener); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); }
  }
  $('#mapback').addEventListener('click', () => setDrawer('half'));
  $('#offerpop').addEventListener('pointerdown', () => { clearTimeout(offerTimer); offerTimer = window.setTimeout(popNext, OFFER_MS); }); // 만지면 시간을 다시 센다
  $('#offerpop').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]'); if (!b) return;
    const act = b.dataset.act, id = Number(b.dataset.id);
    if (act === 'offerClose') { popClear(); return; }
    if (act === 'offerMore') { popNext(); goPend(b.dataset.k!, b.dataset.id || undefined); return; }
    const r = act === 'acceptContract' ? game.acceptContract(id) : game.declineContract(id);
    if (!r.ok) return err(r.error);
    popNext(); toast(act === 'acceptContract' ? '계약을 수락했습니다' : '계약을 거절했습니다'); play(act === 'acceptContract' ? 'ok' : 'tap'); lastHtml = ''; render();
  });
  $('#mapwrap').addEventListener('click', (e) => { if (drawer === 'full' && !(e.target as HTMLElement).closest('button')) setDrawer('min'); }); // 크게 상태에서 지도 띠를 누르면 서랍을 접는다
  $('#dsize').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-h]'); if (b) { setDrawer(b.dataset.h as typeof drawer); play('tap'); } });
  /** 서랍 높이: 크게 펼치면 시간이 멈추고, 크게에서 내려오면 마지막으로 고른 배속으로 다시 흐른다 */
  function setDrawer(h: typeof drawer) {
    if (h === drawer) return;
    const was = drawer; drawer = h;
    $('#stage').classList.remove('d-min', 'd-half', 'd-full'); $('#stage').classList.add(`d-${h}`);
    document.querySelectorAll<HTMLElement>('#dsize button').forEach((x) => x.classList.toggle('on', x.dataset.h === h));
    if (h === 'full' && was !== 'full') { resumeAfterFull = speed > 0; if (speed > 0) lastSpeed = speed; speed = 0; } // 원래 멈춰 있었으면 내려와도 멈춘 그대로
    else if (was === 'full' && resumeAfterFull && speed === 0 && game.state.status === 'playing' && $('#title').hidden) speed = lastSpeed;
    renderTop(); renderHint(); lastHtml = ''; render();
  }
  $('#speeds').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-speed]'); if (!b) return; speed = Number(b.dataset.speed); if (speed > 0) lastSpeed = speed; renderTop(); renderHint(); });
  // 고정 화면의 아이콘 채우기: 하단 탭, 일시정지, 패널 접기
  document.querySelectorAll<HTMLElement>('#tabs button[data-tab]').forEach((b) => { b.innerHTML = icon(b.dataset.tab === 'rivals' ? 'war' : b.dataset.tab!, 18) + b.textContent; });
  document.querySelectorAll<HTMLElement>('[data-ic]').forEach((b) => { b.innerHTML = icon(b.dataset.ic!, 18); });
  const menu = $('#menu');
  let nightOn = (() => { try { return localStorage.getItem('the-air-night') !== 'off'; } catch { return true; } })();
  map.setNight(nightOn);
  /** 메뉴 글자를 저장된 설정과 맞춘다(새로 열 때 꺼 둔 설정이 '켜짐'으로 보이지 않게) */
  const menuLabels = () => { const set = (m: string, t: string, v: boolean) => { menu.querySelector(`[data-m="${m}"]`)!.textContent = `${t}: ${v ? '켜짐' : '꺼짐'}`; }; set('hints', '힌트', hintsOn); set('autopause', '사건 때 멈춤', autoPause); set('sound', '소리', soundOn()); set('night', '낮밤 표시', nightOn); set('music', '배경 음악', musicOn()); };
  addEventListener('pointerdown', () => { if (musicOn()) setMusic(true); }, { once: true }); // 음악은 첫 터치 뒤에 시작(브라우저 규칙)
  $('#menubtn').addEventListener('click', () => { menuLabels(); menu.hidden = !menu.hidden; });
  menu.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-m]'); if (!b) return;
    const m = b.dataset.m;
    if (m === 'save') { save(); toast('저장했습니다'); }
    else if (m === 'load') { if (load()) { selCity = selRoute = null; syncMap(); lastHtml = ''; toast('불러왔습니다'); } else toast('저장된 게임이 없습니다'); }
    else if (m === 'new') { openSetup(); }
    else if (m === 'hints') { hintsOn = !hintsOn; try { localStorage.setItem(HINT_KEY, hintsOn ? 'on' : 'off'); } catch { /* 저장 불가 */ } b.textContent = `힌트: ${hintsOn ? '켜짐' : '꺼짐'}`; toast(hintsOn ? '힌트를 켰습니다' : '힌트를 껐습니다'); menu.hidden = false; render(); return; }
    else if (m === 'autopause') { autoPause = !autoPause; try { localStorage.setItem('the-air-autopause', autoPause ? '1' : '0'); } catch { /* 저장 불가 */ } b.textContent = `사건 때 멈춤: ${autoPause ? '켜짐' : '꺼짐'}`; toast(autoPause ? '사건이 생기면 시간이 멈춥니다' : '사건이 생겨도 시간이 계속 흐릅니다'); menu.hidden = false; render(); return; }
    else if (m === 'sound') { setSound(!soundOn()); b.textContent = `소리: ${soundOn() ? '켜짐' : '꺼짐'}`; play('ok'); menu.hidden = false; return; }
    else if (m === 'volume') {
      const v = volumes();
      showInfo('소리 크기', `<h4>효과음 <small id="v-sfx-n">${Math.round(v.sfx * 100)}%</small></h4><input type="range" id="v-sfx" min="0" max="150" step="5" value="${Math.round(v.sfx * 100)}" style="width:100%"><h4>배경 음악 <small id="v-music-n">${Math.round(v.music * 100)}%</small></h4><input type="range" id="v-music" min="0" max="150" step="5" value="${Math.round(v.music * 100)}" style="width:100%"><p class="hint">왼쪽 끝이 무음, 100%가 기본입니다. 효과음·음악을 끄고 켜는 것은 메뉴의 스위치로 합니다.</p>`);
    }
    else if (m === 'music') { setMusic(!musicOn()); menuLabels(); menu.hidden = false; return; }
    else if (m === 'night') { nightOn = !nightOn; try { localStorage.setItem('the-air-night', nightOn ? 'on' : 'off'); } catch { /* 저장 불가 */ } map.setNight(nightOn); menuLabels(); menu.hidden = false; return; }
    else if (m === 'help') { showInfo('도움말', HELP_HTML); }
    else if (m === 'chronicle') { showChronicle(); }
    else if (m === 'timelapse') { menu.hidden = true; playTimelapse(); return; }
    else if (m === 'ach') { showInfo('업적', achHtml()); }
    else if (m === 'saves') { showSaves(); }
    else if (m === 'stats') { showStats(); }
    else if (m === 'records') { const all = records(); showInfo('기록', SCENARIOS.map((sc) => { const rs = all[sc.id] ?? []; return `<h4>${esc(sc.name)}</h4>${rs.length ? `<table>${rs.slice(0, 5).map((x, i) => `<tr><td>${i + 1}위</td><td><b>${num(x.score)}점</b></td><td>${x.status === 'won' ? '승리' : x.status === 'bankrupt' ? '파산' : '기한 종료'}</td><td>${x.months}개월</td><td>${DIFF_NAME[x.diff]} · ${esc(cityById(x.base).name)}</td><td>${esc(x.when)}</td></tr>`).join('')}</table>` : '<small>아직 기록이 없습니다.</small>'}`; }).join('')); }
    else if (m === 'title') { showTitle(); }
    menu.hidden = true; render();
  });
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
    if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); speed = speed === 0 ? 1 : 0; renderTop(); renderHint(); }
    else if (e.key === '1' || e.key === '2' || e.key === '3') { speed = e.key === '3' ? 4 : Number(e.key); lastSpeed = speed; renderTop(); renderHint(); }
    else if (e.key === 'Escape') { selCity = selRoute = null; menu.hidden = true; syncMap(); lastHtml = ''; render(); }
  });
  $('#info-body').addEventListener('input', (e) => { const t = e.target as HTMLInputElement; if (t.id === 'v-sfx') { setVolumes({ sfx: Number(t.value) / 100 }); $('#v-sfx-n').textContent = `${t.value}%`; } else if (t.id === 'v-music') { setVolumes({ music: Number(t.value) / 100 }); $('#v-music-n').textContent = `${t.value}%`; } });
  $('#info-body').addEventListener('change', (e) => { if ((e.target as HTMLElement).id === 'v-sfx') play('ok'); }); // 효과음 크기는 손을 뗄 때 들려 준다
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false })); // 사파리의 두 손가락 화면 확대를 막는다(지도는 직접 처리)
  $('#info-close').addEventListener('click', () => { $('#info').hidden = true; play('tap'); });
  $('#end-new').addEventListener('click', () => openSetup());
  $('#end-continue').addEventListener('click', () => { const r = game.continuePlay(); if (r.ok) { lastHtml = ''; render(); toast('자유 모드로 계속합니다'); } });

  function newGame(opts: GameOptions = {}) { recorded = false; prevComp = ''; $('#report').hidden = true; game = new Game((Date.now() & 0x7fffffff) || 1, undefined, opts); if (opts.sandbox) game.state.cash += startBonus(); /* 평생 업적 보너스(자유 모드만) */ seenLog = 0; seenEvents = new Set(); achSeen = new Set(); msSeen = new Set(reachedSteps(game)); selCity = selRoute = null; speed = 0; lastMonth = 0; tab = 'map'; syncMap(); lastHtml = ''; $('#title').hidden = true; $('#setup').hidden = true; map.focusCity(game.state.base); prevLog = game.state.log.length; render(); toast(`${game.state.sandbox ? '자유 모드' : game.scenario.name} 시작! 지도에서 ${eulReul(cityById(game.state.base).name)} 눌러 보세요.`); }

  // ---- 새 게임 설정(시나리오·시작 도시·난이도) ----
  let setupScen = 'sandbox', setupDiff: Difficulty = 'normal', setupBase = 'ICN', setupRights = true; // 기본은 목표 없는 자유 모드
  const SANDBOX = { id: 'sandbox', name: '자유 모드', desc: '목표와 기한 없이 마음껏 키우세요. 처음이라면 이 모드를 권합니다. (점수 기록 없음)' };
  function renderSetup() {
    const sc = scenarioById(setupScen === 'sandbox' ? 'free' : setupScen);
    $('#setup-scen').innerHTML = [SANDBOX, ...SCENARIOS].map((x) => `<button data-sc="${x.id}" class="${x.id === setupScen ? 'on' : ''}">${esc(x.name)}<small>${esc(x.desc)}</small></button>`).join('');
    const sel = $<HTMLSelectElement>('#setup-base'); const unlocked = baseUnlocked(), isLocked = (id: string) => !unlocked && LOCKED_BASES.includes(id);
    sel.innerHTML = CITIES.map((c) => `<option value="${c.id}" ${isLocked(c.id) ? 'disabled' : ''}>${esc(c.name)}${isLocked(c.id) ? ' (잠김)' : ''}</option>`).join(''); if (isLocked(setupBase)) setupBase = 'ICN';
    const n = lifetime().length; $('#setup-meta').textContent = `칭호 ${titleOf(n)} · 평생 업적 ${n}/${ACHIEVEMENTS.length} · 자유 모드 시작 자금 보너스 +$${startBonus(n)}M(업적 3개마다 +$1M, 최대 $6M)${unlocked ? '' : ` · 도전 출발지 12곳(아프리카·중남미·오세아니아)은 업적 ${UNLOCK_NEED}개를 달성하면 열립니다`}`;
    sel.value = sc.lockBase && sc.base ? sc.base : setupBase; sel.disabled = sc.lockBase; $('#setup-baselock').textContent = sc.lockBase ? '이 시나리오는 시작 도시가 정해져 있습니다.' : '어느 도시에서 시작해도 됩니다. 시장이 큰 도시일수록 슬롯과 수요가 유리합니다.';
    $('#setup-rightsrow').hidden = setupScen !== 'sandbox'; // 시나리오는 목표가 정해져 있어 제한 없이 모두 열려 있다
    document.querySelectorAll<HTMLElement>('#setup-rights button').forEach((b) => b.classList.toggle('on', (b.dataset.r === 'on') === setupRights));
    $('#setup-rightsnote').textContent = setupRights ? '처음에는 출발 도시가 속한 지역만 열려 있고, 돈과 누적 이익을 갖추면 다른 지역의 운수권을 살 수 있습니다.' : '처음부터 모든 도시에 노선을 열 수 있습니다.';
    document.querySelectorAll<HTMLElement>('#setup-diff button').forEach((b) => b.classList.toggle('on', b.dataset.d === setupDiff));
    $('#setup-diffnote').textContent = setupDiff === 'easy' ? '시작 현금 1.5배, 사건 적음, 이율 낮음(점수 ×0.7)' : setupDiff === 'hard' ? '시작 현금 0.7배, 사건 많음, 이율·고정비 높음(점수 ×1.5)' : '기본 설정(점수 ×1)';
  }
  function openSetup() { $('#setup').hidden = false; $('#end').hidden = true; renderSetup(); }
  $('#setup-scen').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sc]'); if (!b) return; setupScen = b.dataset.sc!; renderSetup(); });
  $('#setup-rights').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-r]'); if (!b) return; setupRights = b.dataset.r === 'on'; renderSetup(); });
  $('#setup-diff').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-d]'); if (!b) return; setupDiff = b.dataset.d as Difficulty; renderSetup(); });
  $('#setup-base').addEventListener('change', (e) => { setupBase = (e.target as HTMLSelectElement).value; });
  $('#setup-go').addEventListener('click', () => newGame({ scenario: setupScen === 'sandbox' ? 'free' : setupScen, sandbox: setupScen === 'sandbox', rights: setupScen === 'sandbox' && setupRights, difficulty: setupDiff, base: $<HTMLSelectElement>('#setup-base').value }));
  $('#setup-cancel').addEventListener('click', () => { $('#setup').hidden = true; render(); });

  // ---- 시작 화면 ----
  function showTitle() {
    speed = 0; $('#title').hidden = false;
    $('#t-version').textContent = `v${AIR_VERSION}`;
    $('#t-title').textContent = `칭호: ${titleOf()} · 평생 업적 ${lifetime().length}/${ACHIEVEMENTS.length}`;
    $('#t-continue').hidden = !hasSave();
    renderRecords();
  }
  $('#t-new').addEventListener('click', () => openSetup());
  $('#t-continue').addEventListener('click', () => { if (load()) { $('#title').hidden = true; selCity = selRoute = null; syncMap(); lastHtml = ''; render(); } });

  // ---- 시간 흐름 ----
  function frame(now: number) {
    const dt = Math.min(0.5, (now - last) / 1000); last = now;
    map.setPaused(speed === 0 || game.state.status !== 'playing');
    if (renderLater && performance.now() - panelBusy >= 900) render(true);
    if (speed > 0 && game.state.status === 'playing' && document.visibilityState === 'visible') {
      acc += dt * speed;
      let n = 0;
      while (acc >= SECONDS_PER_DAY && n < 8) { acc -= SECONDS_PER_DAY; game.advanceDay(); n++; }
      if (n) {
        if (game.monthsPassed !== lastMonth) { lastMonth = game.monthsPassed; save(); showReport(); play('coin'); addAch(achieved(game)); for (const a of ACHIEVEMENTS) if (!achSeen.has(a.id) && a.test(game)) { achSeen.add(a.id); toast(`업적 달성: ${a.name}`, 3500); play('achieve'); }
          if (game.state.sandbox) for (const l of LADDERS) for (const st of l.steps) { const key = `${l.id}:${st}`; if (!msSeen.has(key) && l.value(game) >= st) { msSeen.add(key); toast(`이정표 달성: ${l.name} ${l.unit === 'M' ? money(st) : `${num(st)}${l.unit}`}`, 3500); play('achieve'); } } const h = game.state.history[game.state.history.length - 1]; if (h) toast(`${h.month}개월차 정산: 이익 ${money(h.profit)}${h.month % 12 === 0 ? ' · 연말 신문이 나왔습니다(보고서의 \'연말 신문 보기\')' : ''}`, h.month % 12 === 0 ? 5000 : 2600); }
        const lg = game.state.log;
        if (lg.length > prevLog) { // 새 알림: 눈에 띄게 알리고(알림 띠·탭 표시), 설정에 따라 시간을 멈춘다
          const msg = lg[lg.length - 1]; toast(msg, 6000); play('alert');
          if (autoPause && game.state.status === 'playing') { speed = 0; renderTop(); }
        }
        prevLog = lg.length;
        render(true);
        if (game.state.status !== 'playing') speed = 0;
      }
    }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') { speed = 0; renderTop(); } });

  prevLog = game.state.log.length;
  (window as unknown as { __air: unknown }).__air = { get game() { return game; }, render, report: showReport, setSpeed: (s: number) => { speed = s; renderTop(); }, screenOf: (id: string) => map.screenOf(id), anim: () => map.anim(), mapView: () => map.view(), soundPeaks: renderPeaks };
  showTitle();
  render();
  requestAnimationFrame(frame);
}
