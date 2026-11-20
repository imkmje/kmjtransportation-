// 조사 고르기(순수 함수): 앞말의 마지막 글자 받침에 따라 "을/를" 같은 짝 중 하나를 돌려준다. 화면(ui)도 이것을 쓴다.
export type JosaPair = '을/를' | '이/가' | '은/는' | '과/와' | '으로/로' | '이라/라';

/** 마지막 글자의 받침: 0 = 없음, 8 = ㄹ, 그 밖 = 있음. 숫자·영문은 읽는 소리로(1 일, 3 삼, L 엘, M 엠 …) */
function batchim(word: string): number {
  const t = word.replace(/[\s」』")\]）.·!?]+$/, ''), ch = t[t.length - 1] ?? '', c = ch.charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28;
  if (/[036]/.test(ch)) return 1; // 영·삼·육
  if (/[178lr]/i.test(ch)) return 8; // 일·칠·팔·엘·알
  if (/[mn]/i.test(ch)) return 1; // 엠·엔
  return 0;
}

/** josa('해치백', '을/를') → '을'. 앞쪽이 받침 있을 때, 뒤쪽이 받침 없을 때 쓰는 말 */
export function josa(word: string, pair: JosaPair): string {
  const [yes, no] = pair.split('/'), b = batchim(word);
  if (pair === '으로/로') return b && b !== 8 ? yes : no;
  return b ? yes : no;
}
