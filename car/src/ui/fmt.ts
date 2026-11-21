// 화면 글자 꾸미기. 금액 단위는 만원(sim과 같음), 1억 이상은 억으로 줄여 보인다.
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const num = (n: number): string => Math.round(n).toLocaleString('ko-KR');
/** 금액: 1조 이상 "1조 2,345억", 1억(1만 만원) 이상 "1,023.2억", 아니면 "4,500만원" */
export const money = (v: number, sign = false): string => {
  const s = sign && v > 0 ? '+' : v < 0 ? '−' : '', a = Math.abs(v);
  if (Math.round(a) === 0) return '0원'; // 0.9.0 "0만원" 대신 다른 금액과 같은 표기(광고 '안 함' 칸의 "0원")
  if (a >= 1e8) { const jo = Math.floor(a / 1e8), eok = Math.round((a % 1e8) / 1e4); return `${s}${num(jo)}조${eok ? ` ${num(eok)}억` : ''}`; }
  return a >= 10000 ? `${s}${(a / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억` : `${s}${num(a)}만원`;
};
/** 큰 수량: 1만 이상이면 "3.3만" (좁은 칸용) */
export const qty = (n: number): string => (Math.abs(n) >= 10000 ? `${(n / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만` : num(n));
/** sim 문장 속 "1,234,567만원"을 money 표기로 */
export const moneyText = (t: string): string => t.replace(/(\d[\d,]*)만원/g, (_, n: string) => money(Number(n.replace(/,/g, ''))));
/** 0~10 점수 한 자리 */
export const score = (v: number): string => v.toFixed(1);
export const STAT_NAME = { P: '성능', E: '연비', U: '실용', D: '디자인', Q: '품질' } as const;
export const ROLE_NAME = { designer: '디자이너', engineer: '엔지니어', tester: '테스터', sales: '영업' } as const;
export const ROLE_SKILL = { designer: '디자인', engineer: '기술', tester: '꼼꼼함', sales: '영업력' } as const;
export const MARKETING = ['안 함', '조금', '보통', '많이'];
export const BUDGET = { low: { name: '절약', sub: '점수 적음 · 비용 절반' }, normal: { name: '보통', sub: '기본' }, high: { name: '과감', sub: '점수 많음 · 비용 2배' } } as const;
export const TIER_SUB = ['연비 우수 · 원가 낮음', '성능과 원가의 균형', '고출력 · 원가 높음'];
/** 조사 고르기(sim과 같은 함수): josa('해치백', '을/를') → '을' */
export { josa } from '../sim/josa';
