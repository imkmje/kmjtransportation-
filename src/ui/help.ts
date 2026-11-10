/** 단축키 도움말 창. 같은 분류(도로·구역·시설·교통·보기)로 묶어 보여 준다. ? 키나 [단축키 도움말] 버튼으로 연다 */
const SECTIONS: { title: string; rows: [string, string][] }[] = [
  { title: '도로', rows: [['2 / 4 / 6', '왕복 2·4·6차로 (드래그)'], ['3 / 5', '비대칭 3·5차로 (그리는 방향이 넓음)'], ['Shift + 2/4/6', '일방통행 1·2·3차로 도로'], ['Q', '곡선 모드 켜기/끄기 (세 번 클릭)'], ['T', '입체(고가) 모드: 다른 도로 위로 지나가는 도로'], ['R', '회전교차로 (교차로 클릭)'], ['W', '일방통행 (클릭할 때마다 방향 바뀜)'], ['U', '도로 넓히기'], ['Shift + U', '도로 좁히기']] },
  { title: '구역', rows: [['H / J / K', '주거 저밀 / 중밀 / 고밀'], ['C', '상업'], ['O', '사무'], ['I', '산업'], ['Z', '혼합 용도(상가주택)'], ['E', '구역 지우기']] },
  { title: '시설', rows: [['P', '학교 놓기']] },
  { title: '교통', rows: [['S / Y', '정지 / 양보 표지'], ['G', '신호등 (고정식 → 감응식 → 끔)'], ['N', '좌회전 금지'], ['B', '진입 금지'], ['L', '속도 제한']] },
  { title: '그 밖에', rows: [['X', '철거'], ['V', '차량 투입 (테스트)'], ['M', '정체 히트맵'], ['D', '디버그 표시'], ['F', '사고·날씨 켜기/끄기'], ['Space', '일시정지'], ['+ / −', '배속 올리기 / 내리기'], ['Ctrl + Z / Y', '실행 취소 / 다시 실행'], ['Esc', '도구 해제·취소'], ['?', '이 도움말']] },
  { title: '마우스·터치', rows: [['마우스', '가운데 드래그 = 이동, 오른쪽 드래그 = 회전·기울기, 휠 = 확대'], ['터치', '한 손가락 = 이동, 두 손가락 벌리기 = 확대, 비틀기 = 회전, 같이 위아래 = 기울기, 좌우 = 이동'], ['클릭(도구 없음)', '도로·교차로를 누르면 정보 창']] },
];

export function createHelp(root: HTMLElement) {
  root.hidden = true;
  root.innerHTML = `<div class="card"><h3>단축키 <button id="help-close" title="닫기 (Esc)">✕</button></h3><div class="cols">${SECTIONS.map((s) => `<section><h4>${s.title}</h4>${s.rows.map(([k, v]) => `<div class="r"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</section>`).join('')}</div></div>`;
  const toggle = () => { root.hidden = !root.hidden; };
  root.querySelector<HTMLElement>('#help-close')!.onclick = () => { root.hidden = true; };
  root.addEventListener('click', (e) => { if (e.target === root) root.hidden = true; });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) { root.hidden = true; e.stopImmediatePropagation(); } }, true);
  return { toggle };
}
