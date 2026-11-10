/** 게임 전용 아이콘: 이모지 대신 직접 그린 선 아이콘(24×24, 선 굵기 2, 글자색을 따른다). 기기마다 모양이 달라지지 않는다 */
const P: Record<string, string> = {
  alert: '<path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4.5M12 17.4v.1"/>',
  medal: '<circle cx="12" cy="9" r="5"/><path d="M9 13.4 7.5 21l4.5-2.4 4.5 2.4-1.5-7.6"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  report: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 9h6M9 13h6M9 17h3"/>',
  war: '<path d="M13 2.5 5 13.5h6L10 21.5l9-11.5h-6.4L13 2.5z"/>',
  calendar: '<rect x="4" y="5" width="16" height="15.5" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7M10 17h4"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13" stroke-width="3"/>',
  expand: '<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>',
  check: '<path d="M5 12.5 9.5 17 19 7.5"/>',
  up: '<path d="M12 19V6M6 11.5l6-6 6 6"/>',
  down: '<path d="M12 5v13M6 12.5l6 6 6-6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  star: '<path d="M12 3.2l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17.1 6.6 20l1-6.1-4.4-4.3 6.1-.9L12 3.2z" fill="currentColor"/>',
  map: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3.2 3.2 14.8 0 18M12 3c-3.2 3.2-3.2 14.8 0 18"/>',
  routes: '<circle cx="5" cy="17.5" r="2"/><circle cx="19" cy="6.5" r="2"/><path d="M6.4 15.9C8.5 9.5 13 7.4 17 6.8"/>',
  fleet: '<path d="M12 3c1.1 0 1.8 1.2 1.8 2.8V9l7.2 4.6v2.2l-7.2-2.3v4.3l2.4 1.9V21L12 20l-4.2 1v-1.3l2.4-1.9v-4.3L3 15.8v-2.2L10.2 9V5.8C10.2 4.2 10.9 3 12 3z"/>',
  money: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5v11M15 9.6c-.6-1-1.7-1.6-3-1.6-1.7 0-3 .9-3 2.1 0 2.8 6 1.2 6 4 0 1.200-1.300 2.100-3 2.100-1.400 0-2.600-.600-3.100-1.600"/>',
  news: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.500 2.500h-15L6 16zM10 21h4"/>',
};
export type IconName = keyof typeof P;
export const icon = (name: string, size = 16): string => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;
