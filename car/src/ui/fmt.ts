// 화면 글자 꾸미기. 금액 단위는 만원(sim과 같음), 1억 이상은 억으로 줄여 보인다.
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const num = (n: number): string => Math.round(n).toLocaleString('ko-KR');
/** 금액: 1억(1만 만원) 이상이면 "12.3억", 아니면 "4,500만원" */
export const money = (v: number, sign = false): string => {
  const s = sign && v > 0 ? '+' : v < 0 ? '−' : '', a = Math.abs(v);
  return a >= 10000 ? `${s}${(a / 10000).toFixed(1).replace(/\.0$/, '')}억` : `${s}${num(a)}만원`;
};
/** 0~10 점수 한 자리 */
export const score = (v: number): string => v.toFixed(1);
export const STAT_NAME = { P: '성능', E: '연비', U: '실용', D: '디자인', Q: '품질' } as const;
export const ROLE_NAME = { designer: '디자이너', engineer: '엔지니어', tester: '테스터', sales: '영업' } as const;
export const ROLE_SKILL = { designer: '디자인', engineer: '기술', tester: '꼼꼼함', sales: '영업력' } as const;
export const MARKETING = ['안 함', '조금', '보통', '많이'];
export const BUDGET = { low: { name: '절약', sub: '점수 조금 적게 · 비용 절반' }, normal: { name: '보통', sub: '기본' }, high: { name: '과감', sub: '점수 많이 · 비용 2배' } } as const;
export const TIER_SUB = ['연비가 좋고 값이 쌈', '균형', '힘이 좋음 · 원가 비쌈'];
/** 조사 고르기(sim과 같은 함수): josa('해치백', '을/를') → '을' */
export { josa } from '../sim/josa';
