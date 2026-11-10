import citiesJson from './cities.json';
import aircraftJson from './aircraft.json';
import eventsJson from './events.json';
import type { City, AircraftType, EventDef } from '../sim/types';

export const CITIES = citiesJson as unknown as City[];
export const AIRCRAFT = aircraftJson as unknown as AircraftType[];
export const EVENTS = eventsJson as unknown as EventDef[];
export const cityById = (id: string): City => { const c = CITIES.find((x) => x.id === id); if (!c) throw new Error(`없는 도시: ${id}`); return c; };
export const typeById = (id: string): AircraftType => { const t = AIRCRAFT.find((x) => x.id === id); if (!t) throw new Error(`없는 기종: ${id}`); return t; };
