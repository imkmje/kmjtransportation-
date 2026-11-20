// 용어 설명(ⓘ·길게 누르기). 자료(data)에 info 설명이 있으면 그것을 먼저 쓰고, 없으면 여기 글을 쓴다.
// 문체: 사전 풀이처럼 담백하게. 무엇인지 → 게임에서 어떤 효과인지.
import { BODIES, OPTIONS, POWERTRAINS, SEGMENTS, TECHS } from '../data';
import { config } from '../config';

/** 게임 용어 */
export const TERMS: Record<string, string> = {
  인지도: '시장에서 차가 알려진 정도. 0~100%로 나타낸다. 인지도가 낮으면 차가 좋아도 덜 팔린다. 출시 뒤 매달 오르며, 광고·평판·영업 직원·페이스리프트가 오름을 앞당긴다.',
  평판: '회사 전체에 대한 세간의 평가. 명차를 내면 오르고, 혹평·리콜·잘 팔리는 차의 단종·구제 금융으로 떨어진다. 평판이 높으면 새 차의 인지도가 높게 시작하고, 채용 후보와 본사 승급 조건에도 영향을 준다.',
  이름값: '차종 자산. 한 차종 이름에 쌓인 신뢰로, 평론과 누적 판매로 쌓인다. 풀체인지한 다음 세대가 처음부터 더 잘 알려진다. 차체를 바꾸거나 오래 쉰 이름을 되살리면 일부만 이어진다.',
  수명: '차가 시장에서 팔리는 힘. 출시 뒤 시간이 지날수록 줄어들어 판매가 줄어든다. 페이스리프트를 하면 수명 나이가 되돌아가 판매 힘이 회복된다.',
  결함: '개발 중 생긴 설계·제조상의 문제. 시험 단계에서 매주 줄어든다. 남은 결함이 많으면 평론 점수가 깎이고 리콜 위험이 커진다.',
  리콜: '결함이 드러난 차를 회사가 거두어 고치는 일. 수리비가 나가고 평판이 떨어진다. 출시 때 남은 결함이 많을수록 일어날 확률이 높다.',
  '유예 기간': '규제가 시행되기 전에 주어지는 준비 기간. 이 기간이 끝나면 조건을 갖추지 못한 차는 출시할 수 없다.',
  '충전 인프라': '전기차 충전소가 갖춰진 정도(보급률). 보급률이 낮으면 전기차 수요가 그만큼 줄어든다. 전기차 시대가 열린 뒤 해마다 오른다.',
  '생산 라인': '공장에서 차 한 종류를 만드는 설비. 판매 중인 차종 수는 생산 라인 수를 넘을 수 없다. 공장을 증설하면 늘어난다. 페이스리프트와 판매 중인 차의 풀체인지는 같은 라인을 이어 쓴다.',
  궁합: '차체와 고객층이 서로 맞는 정도(◎ 잘 맞음, ○ 무난, △ 덜 맞음, × 안 맞음). 잘 맞는 조합일수록 많이 팔린다. 그 조합으로 차를 한 번 출시해야 알 수 있다.',
  '세계 최초': '기술이 등장하는 해보다 먼저 연구를 마치고 그 기술을 처음 쓴 차가 받는 평가. 평론가 모두 점수를 1점씩 더 준다. 기술마다 한 번뿐이다.',
  '동력 등급': '한 차에 고르는 동력의 급(보급형·표준·고급). 연구로 오른 동력 단계 가운데 어느 수준을 쓸지 정한다. 높을수록 성능이 좋고 원가가 비싸다.',
  '동력 단계': '연구로 오르는 동력 기술의 수준. 회사 전체에 적용되며, 단계가 오르면 같은 등급이라도 더 좋은 동력을 쓴다. 등급은 연구한 가장 높은 단계에서 한두 단계 낮춘 것이다.',
  페이스리프트: '세대를 바꾸지 않고 얼굴(앞뒤 모습)과 옵션을 고치는 부분 변경. 출시 18개월 뒤부터 세대당 한 번 할 수 있다. 수명과 인지도가 회복되고 디자인 점수가 조금 오른다. 평론가는 다시 평가하지 않는다.',
  풀체인지: '차종 이름을 이어받아 다음 세대를 새로 만드는 전면 변경. 출시 36개월 뒤부터 할 수 있다. 이름값과 전 세대 고객의 재구매를 이어받고, 같은 차체면 개발비가 줄어든다.',
  '개발 방향': '설계 기간에 어느 능력치에 힘을 줄지 나눈 점수. 많이 준 능력치가 더 크게 자란다.',
  '대출 이자': '빌린 돈에 매달 붙는 이자. 대출 한도의 70%를 넘게 빌리면 이율이 오른다.',
  광고: '매달 광고비를 써서 차를 알리는 일. 단계가 높을수록 인지도가 빨리 오르지만 비용이 커진다.',
};

/** 능력치 5개 */
export const STAT_INFO: Record<'P' | 'E' | 'U' | 'D' | 'Q', string> = {
  P: '성능: 가속·최고 속도·주행 감각. 성능파 평론가와 청년·마니아·부유층이 중시한다. 동력 등급·동력 단계와 개발 방향에 따라 오른다.',
  E: '연비: 연료를 얼마나 적게 쓰는가. 직장인·청년·가족과 살림꾼 평론가가 중시하며, 유가 파동 같은 사건 때 더 중요해진다.',
  U: '실용: 실내 공간·짐 공간·편의 장비. 가족·법인 고객과 살림꾼 평론가가 중시한다. 차체와 편의 옵션의 영향이 크다.',
  D: '디자인: 겉모습과 실내의 멋. 청년·부유층과 디자인파 평론가가 중시한다. 페이스리프트로 조금 올릴 수 있다.',
  Q: '품질: 마감과 내구성. 남은 결함이 많으면 깎인다. 품질 등급이 높으면 입소문이 나고, 전 세대 고객의 재구매에도 영향을 준다.',
};

/** 평론가 4명(config.critics.list의 id) */
export const CRITIC_INFO: Record<string, string> = {
  performance: '성능파: 성능(60%)과 디자인(40%)을 보는 평론가.',
  household: '살림꾼: 실용(40%)·연비(40%)·품질(20%)을 보는 평론가.',
  design: '디자인파: 디자인(70%)과 품질(30%)을 보는 평론가.',
  value: '가성비파: 전체 능력치 평균을 가격과 견주어 보는 평론가. 같은 차라도 값을 낮추면 점수가 오른다.',
};

const BODY_INFO: Record<string, string> = {
  sedanS: '소형 세단: 트렁크가 따로 있는 작은 승용차. 값이 싸고 연비가 좋다. 직장인·청년 수요가 많다.',
  hatch: '해치백: 뒷문이 위로 열려 짐칸과 실내가 이어진 작은 차. 실용성이 좋고 값이 싸다.',
  sedanM: '중형 세단: 가장 대중적인 4도어 승용차. 가족·직장인·법인 모두에게 무난하다.',
  coupe: '쿠페: 문이 둘인 낮고 날렵한 차. 디자인과 성능이 돋보이지만 실용성은 낮다.',
  sedanL: '대형 세단: 넓고 고급스러운 승용차. 값과 원가가 높고 부유층·법인 수요가 많다.',
  minivan: '미니밴: 좌석이 3열인 높은 승합형 차. 실용성이 가장 높고 가족 수요가 많다.',
  kei: '경차: 아주 작고 가벼운 차. 값과 유지비가 가장 싸고 연비가 좋다.',
  suv: 'SUV: 차체가 높고 지상고가 큰 다목적 차. 실용성과 성능을 함께 갖춰 폭넓게 팔린다.',
  pickup: '픽업: 객실 뒤에 열린 짐칸을 둔 차. 실용성이 높고 법인·마니아 수요가 있다.',
  sports: '스포츠카: 낮고 넓은 2인승 고성능 차. 성능과 디자인이 높지만 실용성이 낮고 비싸다.',
};
const PT_INFO: Record<string, string> = {
  gasoline: '가솔린: 휘발유 엔진. 처음부터 쓸 수 있고 무난하다. 연구로 동력 단계를 올리면 성능과 연비가 좋아진다.',
  diesel: '디젤: 경유 엔진. 연비와 힘(토크)이 좋지만 원가가 조금 비싸다. 배출가스 규제에 영향을 받는다.',
  hybrid: '하이브리드: 엔진과 전기 모터를 함께 쓰는 동력. 연비가 매우 좋지만 원가가 비싸다.',
  ev: '전기: 배터리와 모터로만 달리는 동력. 연비(효율)와 가속이 좋지만 배터리 값이 비싸고, 충전 인프라 보급률만큼만 팔린다.',
};
const TIER_INFO = ['보급형: 연구한 가장 높은 단계에서 두 단계 낮춘 동력. 원가가 싸고 연비가 좋다.', '표준: 한 단계 낮춘 동력. 성능과 원가의 균형.', '고급: 연구한 가장 높은 단계의 동력. 힘이 좋지만 원가가 비싸다. 차에 스포일러가 붙는다.'];
const SEG_INFO: Record<string, string> = {
  youth: '청년: 디자인과 연비를 중시하고 값에 민감한 젊은 고객층.',
  family: '가족: 실용성과 품질을 중시하는 고객층. 넓은 실내와 짐 공간을 원한다.',
  worker: '직장인: 연비와 품질을 중시하는 출퇴근 고객층. 값에 민감하다.',
  rich: '부유층: 성능·디자인·품질을 중시하고 값에는 덜 민감한 고객층.',
  fleet: '법인·택시: 회사 차와 택시로 쓰는 고객층. 실용·연비·품질을 보고 값에 민감하다. 영업 직원이 있으면 판매가 는다.',
  enthusiast: '마니아: 성능과 디자인을 무엇보다 중시하는 고객층. 수는 적지만 값보다 만족을 본다.',
};
const OPT_INFO: Record<string, string> = {
  radio: '라디오: 차 안에서 방송을 듣는 장치.', aircon: '에어컨: 실내를 시원하게 하는 냉방 장치.',
  powerSteering: '파워 스티어링: 유압이나 전기의 힘으로 핸들을 가볍게 돌리게 하는 장치.', autoTrans: '자동 변속기: 기어를 스스로 바꾸는 변속기. 운전이 쉬워진다.',
  leather: '가죽 시트: 가죽으로 싼 고급 좌석.', heatedSeats: '열선 시트: 좌석에 전열선을 넣어 데우는 장치.',
  sunroof: '선루프: 지붕에 낸 여닫는 유리창.', abs: 'ABS: 급제동 때 바퀴가 잠기지 않게 브레이크를 조절하는 장치.',
  airbag: '에어백: 충돌 때 부풀어 탑승자를 보호하는 주머니.', awd: '사륜구동: 네 바퀴 모두에 힘을 보내는 구동 방식. 험로와 눈길에 강하다.',
  navigation: '내비게이션: 지도와 위치 정보로 길을 안내하는 장치.', rearCamera: '후방 카메라: 후진할 때 차 뒤를 화면에 보여 주는 카메라.',
  smartKey: '스마트 키: 열쇠를 지니고만 있어도 문을 열고 시동을 거는 장치.', adas: '주행 보조: 차선 유지·앞차 따라가기 등 운전을 돕는 장치(ADAS).',
  bigScreen: '대형 화면: 계기판과 중앙 화면을 크게 키운 실내 표시 장치.', autonomy2: '자율주행 2단계: 조건에 따라 조향과 가감속을 함께 맡는 부분 자율주행.',
};

const infoField = (x: unknown): string | undefined => { const v = (x as { info?: unknown } | undefined)?.info; return typeof v === 'string' && v ? v : undefined; };
const eff = (o: { U?: number; D?: number; Q?: number }) => (['U', 'D', 'Q'] as const).filter((k) => o[k]).map((k) => `${({ U: '실용', D: '디자인', Q: '품질' })[k]} +${o[k]}`).join(', ');

/** 설명 키 → { 제목, 글 }. 키: term:이름 · stat:P · critic:id · body:id · seg:id · pt:id · tier:번호 · opt:id · tech:id */
export function infoOf(key: string): { title: string; text: string } | null {
  const i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1);
  const split = (t: string, title: string) => { const m = t.match(/^([^:]{1,24}):\s*/); return { title: m ? m[1] : title, text: m ? t.slice(m[0].length) : t }; };
  switch (kind) {
    case 'term': return TERMS[id] ? { title: id === '이름값' ? '이름값(차종 자산)' : id, text: TERMS[id] } : null;
    case 'stat': return STAT_INFO[id as 'P'] ? split(STAT_INFO[id as 'P'], id) : null;
    case 'critic': { const c = config.critics.list.find((x) => x.id === id); return c && CRITIC_INFO[id] ? split(CRITIC_INFO[id], c.name) : null; }
    case 'body': { const b = BODIES.find((x) => x.id === id); return b ? { title: b.name, text: infoField(b) ?? split(BODY_INFO[id] ?? '', b.name).text } : null; }
    case 'seg': { const g = SEGMENTS.find((x) => x.id === id); return g ? { title: g.name, text: infoField(g) ?? split(SEG_INFO[id] ?? '', g.name).text } : null; }
    case 'pt': { const p = POWERTRAINS.find((x) => x.id === id); return p ? { title: p.name, text: infoField(p) ?? split(PT_INFO[id] ?? '', p.name).text } : null; }
    case 'tier': { const t = TIER_INFO[Number(id) - 1]; return t ? split(t, '') : null; }
    case 'opt': { const o = OPTIONS.find((x) => x.id === id); if (!o) return null; const e = eff(o); return { title: o.name, text: (infoField(o) ?? split(OPT_INFO[id] ?? '', o.name).text) + (e ? ` 게임에서는 ${e}.` : '') }; }
    case 'tech': { const t = TECHS.find((x) => x.id === id); return t ? { title: t.name, text: infoField(t) ?? t.desc } : null; }
  }
  return null;
}
