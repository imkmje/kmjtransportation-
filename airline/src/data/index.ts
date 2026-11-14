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
export const OWN_TYPES: AircraftType[] = [
  { id: 'KX200', name: 'KX-200', cls: '자체 개발 단거리(고효율)', seats: 200, speed: 850, range: 5200, runway: 1800, price: 60, hourly: 4.0, cargo: 4, own: true },
  { id: 'KX300', name: 'KX-300', cls: '자체 개발 중거리 광동체', seats: 300, speed: 880, range: 9800, runway: 2400, price: 115, hourly: 7.0, cargo: 12, own: true },
  { id: 'KX400', name: 'KX-400', cls: '자체 개발 장거리 광동체', seats: 400, speed: 910, range: 14800, runway: 3000, price: 175, hourly: 9.8, cargo: 22, own: true },
];
/** 자체 기종 이름: 게임마다 다르게 지을 수 있어 처음 이름을 따로 둔다. shortcut: 기종 정보가 모듈 하나를 공유한다 — 두 게임을 동시에 띄우게 되면 이름을 게임 상태에서 찾도록 바꾼다 */
export const OWN_DEFAULT_NAMES = Object.fromEntries(OWN_TYPES.map((t) => [t.id, t.name]));
export const applyOwnNames = (names?: Record<string, string>) => { for (const t of OWN_TYPES) t.name = names?.[t.id] ?? OWN_DEFAULT_NAMES[t.id]; };
export const typeById = (id: string): AircraftType => { const t = AIRCRAFT.find((x) => x.id === id) ?? OWN_TYPES.find((x) => x.id === id); if (!t) throw new Error(`없는 기종: ${id}`); return t; };
