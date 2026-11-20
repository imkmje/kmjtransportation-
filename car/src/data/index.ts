import bodiesJson from './bodies.json';
import powertrainsJson from './powertrains.json';
import optionsJson from './options.json';
import segmentsJson from './segments.json';
import compatJson from './compat.json';
import marketJson from './market.json';
import rivalsJson from './rivals.json';
import namesJson from './names.json';
import type { BodyDef, PowertrainDef, OptionDef, SegmentDef, RegionMarket, RivalDef } from '../sim/types';

export const BODIES = bodiesJson as unknown as BodyDef[];
export const POWERTRAINS = powertrainsJson as unknown as PowertrainDef[];
export const OPTIONS = optionsJson as unknown as OptionDef[];
export const SEGMENTS = segmentsJson as unknown as SegmentDef[];
/** 차체 × 고객층 궁합(◎ 1.2 / ○ 1.0 / △ 0.8 / × 0.6) */
export const COMPAT = compatJson as Record<string, Record<string, number>>;
export const MARKET = marketJson as unknown as Record<string, RegionMarket>;
export const RIVALS = rivalsJson as unknown as RivalDef[];
export const NAMES = namesJson as { defaultCompany: string; staff: string[]; cars: string[]; family: string[]; given: string[] }; // family·given: 채용 후보 이름(성 + 이름)

const find = <T extends { id: string }>(list: T[], id: string, what: string): T => { const x = list.find((v) => v.id === id); if (!x) throw new Error(`없는 ${what}: ${id}`); return x; };
export const bodyById = (id: string) => find(BODIES, id, '차체');
export const powertrainById = (id: string) => find(POWERTRAINS, id, '동력');
export const optionById = (id: string) => find(OPTIONS, id, '옵션');
export const segmentById = (id: string) => find(SEGMENTS, id, '고객층');
