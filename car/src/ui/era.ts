// G2 시대별 화면 분위기: 10년 단위로 :root에 era-1970 … era-2020 클래스를 붙인다(1970년 이전은 1970, 2020년 이후는 2020).
// 색은 era.css의 새 변수(--era-*)만 바꾼다. 기존 색 토큰은 건드리지 않는다. 3D 무대는 Stage.setEra가 조명·원판 색을 맞춘다.
import './era.css';

export const decadeOf = (year: number): number => Math.max(1970, Math.min(2020, Math.floor(year / 10) * 10));
let cur = 0;
/** 지금 연도로 화면 분위기를 맞춘다(같은 10년이면 클래스는 그대로, 무대는 매번 목표만 다시 정한다) */
export function applyEra(year: number, stage?: { setEra(year: number): void } | null): void {
  stage?.setEra(year);
  const d = decadeOf(year);
  if (d === cur) return;
  const el = document.documentElement;
  if (cur) el.classList.remove(`era-${cur}`);
  el.classList.add(`era-${d}`);
  cur = d;
}
