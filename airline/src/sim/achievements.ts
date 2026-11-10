import { CITIES, cityById } from '../data';
import type { Game } from './game';
import { distanceKm } from './model';

/** 업적: 저장 파일에 따로 넣지 않고 게임 상태에서 매번 계산한다(저장·불러오기 후에도 같은 결과) */
export interface Achievement { id: string; name: string; desc: string; test: (g: Game) => boolean }

const servedRoutes = (g: Game) => g.state.routes.filter((r) => r.open && g.planesOn(r.id).length > 0);

export const ACHIEVEMENTS: Achievement[] = [
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
  { id: 'steady', name: '꾸준함', desc: '12개월을 파산 없이 운영', test: (g) => g.monthsPassed >= 12 && g.state.status !== 'bankrupt' },
];

export const achieved = (g: Game): string[] => ACHIEVEMENTS.filter((a) => a.test(g)).map((a) => a.id);
