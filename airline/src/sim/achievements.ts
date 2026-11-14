import { config } from '../config';
import { AIRCRAFT, CITIES, cityById, typeById } from '../data';
import type { Game } from './game';
import { distanceKm } from './model';

/** 업적: 저장 파일에 따로 넣지 않고 게임 상태에서 매번 계산한다(저장·불러오기 후에도 같은 결과) */
export interface Achievement { id: string; name: string; desc: string; test: (g: Game) => boolean }

const servedRoutes = (g: Game) => g.state.routes.filter((r) => r.open && g.planesOn(r.id).length > 0);

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'giant', name: '거인을 쓰러뜨리다', desc: '글로벌 스카이와의 최후의 대결에서 이긴다(자유 모드)', test: (g) => !!g.state.duelWon },
  { id: 'chal2', name: '고난의 길', desc: '자유 모드 도전 조건 2개 이상으로 5년을 버틴다', test: (g) => (g.state.challenges?.length ?? 0) >= 2 && g.monthsPassed >= 60 && g.state.status === 'playing' },
  ...Object.entries(config.extra.dynasty.list).map(([id, d]) => ({ id: `dyn_${id}`, name: `왕조: ${d.name}`, desc: `왕조 목표 '${d.name}'을(를) 기한 안에 이룬다(자유 모드)`, test: (g: Game) => !!g.state.dynastyDone?.includes(id) })),
  { id: 'first', name: '첫 비행', desc: '항공기가 달리는 노선이 생긴다', test: (g) => servedRoutes(g).length >= 1 },
  { id: 'routes5', name: '노선 개척자', desc: '운항 노선 5개', test: (g) => servedRoutes(g).length >= 5 },
  { id: 'hub', name: '진짜 허브', desc: '한 도시에 노선 5개 이상', test: (g) => CITIES.some((c) => g.linksAt(c.id) >= 5) },
  { id: 'fleet5', name: '작은 선단', desc: '항공기 5대 보유', test: (g) => g.state.planes.length >= 5 },
  { id: 'fleet10', name: '큰 선단', desc: '항공기 10대 보유', test: (g) => g.state.planes.length >= 10 },
  { id: 'cities10', name: '세계로', desc: '10개 도시에 취항', test: (g) => g.servedCities().size >= 10 },
  { id: 'longhaul', name: '대륙 횡단', desc: '8,000km 넘는 노선 운항', test: (g) => servedRoutes(g).some((r) => distanceKm(cityById(r.a), cityById(r.b)) > 8000) },
  { id: 'profit10', name: '흑자 달', desc: '한 달 이익 $10M 이상', test: (g) => g.state.history.some((h) => h.profit >= 10) },
  { id: 'cum50', name: '자리 잡다', desc: '누적 이익 $50M', test: (g) => g.state.cumProfit >= 50 },
  { id: 'biz', name: '비즈니스 서비스', desc: '비즈니스석을 단 항공기가 취항', test: (g) => servedRoutes(g).some((r) => g.planesOn(r.id).some((p) => p.bizShare > 0)) },
  { id: 'cargo', name: '화물 사업', desc: '화물기를 보유', test: (g) => g.state.planes.some((p) => p.type === 'F77') },
  { id: 'punctual', name: '칼 같은 정시', desc: '노선 3개 이상에서 정시율 98% 이상', test: (g) => servedRoutes(g).length >= 3 && g.avgOtp >= 0.98 },
  { id: 'rank1', name: '업계 1위', desc: '경쟁사가 2곳 이상일 때 최근 12개월 매출 1위', test: (g) => g.monthsPassed >= 12 && g.state.competitors.length >= 2 && g.rank() === 1 },
  { id: 'newgen', name: '신형기 도입', desc: '새로 출시된 기종을 보유', test: (g) => g.state.planes.some((p) => (typeById(p.type).from ?? 0) > 0) },
  { id: 'regions', name: '세계 운수권', desc: '모든 지역의 운수권을 가진다', test: (g) => !!g.state.rights && g.state.rights.length === Object.keys(config.rights.regions).length },
  { id: 'contract1', name: '첫 계약', desc: '계약 제안을 달성한다', test: (g) => g.state.contractsDone >= 1 },
  { id: 'contract5', name: '믿을 만한 파트너', desc: '계약 제안을 5건 달성한다', test: (g) => g.state.contractsDone >= 5 },
  { id: 'steady', name: '꾸준함', desc: '12개월을 파산 없이 운영', test: (g) => g.monthsPassed >= 12 && g.state.status !== 'bankrupt' },
];

export const achieved = (g: Game): string[] => ACHIEVEMENTS.filter((a) => a.test(g)).map((a) => a.id);

/** 이정표(자유 모드용): 단계가 있는 목표. 저장 파일에 넣지 않고 게임 상태에서 계산한다 */
export interface Ladder { id: string; name: string; unit: string; steps: number[]; value: (g: Game) => number }
export const LADDERS: Ladder[] = [
  { id: 'profit', name: '누적 이익', unit: 'M', steps: [25, 50, 100, 200, 400, 800, 1500, 3000, 6000, 12000], value: (g) => g.state.cumProfit },
  { id: 'cities', name: '취항 도시', unit: '곳', steps: [3, 6, 10, 15, 20, 30, CITIES.length], value: (g) => g.servedCities().size },
  { id: 'fleet', name: '보유 항공기', unit: '대', steps: [3, 5, 10, 15, 25, 40, 60, 100], value: (g) => g.state.planes.length },
  { id: 'pax', name: '지난달 탑승객', unit: '명', steps: [5000, 10000, 25000, 50000, 100000, 200000, 400000, 800000], value: (g) => g.state.history.at(-1)?.pax ?? 0 },
  { id: 'totalpax', name: '누적 탑승객', unit: '명', steps: [100000, 500000, 1000000, 5000000, 10000000, 50000000, 100000000], value: (g) => g.state.history.reduce((a, h) => a + h.pax, 0) },
  { id: 'years', name: '운영 연수', unit: '년', steps: [3, 5, 10, 15, 20, 30], value: (g) => Math.floor(g.monthsPassed / 12) },
  { id: 'types', name: '기종 도감', unit: '종', steps: [3, 6, 10, 15, AIRCRAFT.length], value: (g) => g.state.typesFlown?.length ?? 0 },
  { id: 'acq', name: '인수한 경쟁사', unit: '곳', steps: [1, 2, 3, 5], value: (g) => g.state.acquired ?? 0 },
  { id: 'rights', name: '운수권 지역', unit: '곳', steps: [2, 4, 6, 8], value: (g) => g.state.rights?.length ?? 0 },
];
/** 지금까지 넘은 이정표 키("ladder:step") */
export const reachedSteps = (g: Game): string[] => LADDERS.flatMap((l) => { const v = l.value(g); return l.steps.filter((s) => v >= s).map((s) => `${l.id}:${s}`); });
/** 사다리마다 다음 이정표(끝까지 갔으면 next가 null) */
export const nextSteps = (g: Game) => LADDERS.map((l) => { const v = l.value(g), next = l.steps.find((s) => v < s) ?? null, prev = [...l.steps].reverse().find((s) => v >= s) ?? 0; return { ladder: l, value: v, next, prev }; });
