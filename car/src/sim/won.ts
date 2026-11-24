// 3.6.0 sim 문장의 금액 표기(3.1.1 자회사 문장의 표기를 모든 sim 문장에 씀): 1조 이상은 "3조 5,000억원", 1억 이상은 "1,234.5억원", 아니면 "4,500만원". 단위는 만원, 자릿수 표기는 기기 언어와 무관하게 ko-KR
export const won = (x: number): string => {
  const v = Math.abs(x), sg = x < 0 ? '−' : '', k = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d });
  if (v >= 1e8) { const e = Math.round(v / 1e4), jo = Math.floor(e / 1e4), eok = e % 1e4; return `${sg}${k(jo)}조${eok ? ` ${k(eok)}억` : ''}원`; }
  return `${sg}${v >= 10000 ? `${k(v / 10000, 1)}억원` : `${k(Math.round(v))}만원`}`;
};
