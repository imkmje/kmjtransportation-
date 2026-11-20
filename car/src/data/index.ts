import bodiesJson from './bodies.json';
import powertrainsJson from './powertrains.json';
import optionsJson from './options.json';
import segmentsJson from './segments.json';
import compatJson from './compat.json';
import marketJson from './market.json';
import rivalsJson from './rivals.json';
import namesJson from './names.json';
import techJson from './tech.json';
import eventsJson from './events.json';
import type { BodyDef, PowertrainDef, OptionDef, SegmentDef, RegionMarket, RivalDef, TechDef, EraEventDef, RandomEventDef } from '../sim/types';

export const BODIES = bodiesJson as unknown as BodyDef[];
export const POWERTRAINS = powertrainsJson as unknown as PowertrainDef[];
export const OPTIONS = optionsJson as unknown as OptionDef[];
export const SEGMENTS = segmentsJson as unknown as SegmentDef[];
/** 차체 × 고객층 궁합(◎ 1.2 / ○ 1.0 / △ 0.8 / × 0.6) */
export const COMPAT = compatJson as Record<string, Record<string, number>>;
export const MARKET = marketJson as unknown as Record<string, RegionMarket>;
export const RIVALS = rivalsJson as unknown as RivalDef[];
/** 연구 기술(10장), 등장 연도 순 */
export const TECHS = techJson as unknown as TechDef[];
/** 시대 사건(11.1 고정 13개, 11.2 무작위 8종) */
export const ERA_EVENTS = eventsJson.era as unknown as EraEventDef[];
export const RANDOM_EVENTS = eventsJson.random as unknown as RandomEventDef[];
export const NAMES = namesJson as { defaultCompany: string; staff: string[]; cars: string[]; family: string[]; given: string[] }; // family·given: 채용 후보 이름(성 + 이름)

const find = <T extends { id: string }>(list: T[], id: string, what: string): T => { const x = list.find((v) => v.id === id); if (!x) throw new Error(`없는 ${what}: ${id}`); return x; };
export const bodyById = (id: string) => find(BODIES, id, '차체');
export const powertrainById = (id: string) => find(POWERTRAINS, id, '동력');
export const optionById = (id: string) => find(OPTIONS, id, '옵션');
export const segmentById = (id: string) => find(SEGMENTS, id, '고객층');
export const techById = (id: string) => find(TECHS, id, '기술');
