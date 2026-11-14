import citiesJson from './cities.json';
import aircraftJson from './aircraft.json';
import eventsJson from './events.json';
import scenariosJson from './scenarios.json';
import type { City, AircraftType, EventDef, Scenario } from '../sim/types';

export const CITIES = citiesJson as unknown as City[];
export const AIRCRAFT = aircraftJson as unknown as AircraftType[];
export const EVENTS = eventsJson as unknown as EventDef[];
export const SCENARIOS = scenariosJson as unknown as Scenario[];
export const scenarioById = (id: string): Scenario => SCENARIOS.find((x) => x.id === id) ?? SCENARIOS[0];
export const cityById = (id: string): City => { const c = CITIES.find((x) => x.id === id); if (!c) throw new Error(`없는 도시: ${id}`); return c; };
/** 자체 개발 기종(대형 사업으로 개발해야 살 수 있음, 구매 목록·도감에는 개발한 뒤에만) */
// 자체 기종은 시중 최고 기종보다 좌석당 운항비 30~45% 낮고, 더 빠르고 멀리 가며 값도 싸다(대형 사업 보상이라 일부러 압도적으로)
export const OWN_TYPES: AircraftType[] = [
  { id: 'KX200', name: 'KX-200', cls: '자체 개발 단거리(고효율)', seats: 220, speed: 900, range: 7500, runway: 1700, price: 55, hourly: 3.1, cargo: 6, own: true },
  { id: 'KX300', name: 'KX-300', cls: '자체 개발 중거리 광동체', seats: 330, speed: 930, range: 13000, runway: 2300, price: 100, hourly: 5.6, cargo: 16, own: true },
  { id: 'KX400', name: 'KX-400', cls: '자체 개발 장거리 광동체', seats: 450, speed: 950, range: 18000, runway: 2800, price: 160, hourly: 7.2, cargo: 28, own: true },
];
/** 자체 기종 이름: 게임마다 다르게 지을 수 있어 처음 이름을 따로 둔다. shortcut: 기종 정보가 모듈 하나를 공유한다 — 두 게임을 동시에 띄우게 되면 이름을 게임 상태에서 찾도록 바꾼다 */
export const OWN_DEFAULT_NAMES = Object.fromEntries(OWN_TYPES.map((t) => [t.id, t.name]));
export const applyOwnNames = (names?: Record<string, string>) => { for (const t of OWN_TYPES) t.name = names?.[t.id] ?? OWN_DEFAULT_NAMES[t.id]; };
export const typeById = (id: string): AircraftType => { const t = AIRCRAFT.find((x) => x.id === id) ?? OWN_TYPES.find((x) => x.id === id); if (!t) throw new Error(`없는 기종: ${id}`); return t; };
