export const money = (m: number): string => `${m < 0 ? '-' : ''}$${Math.abs(m).toFixed(Math.abs(m) >= 100 ? 0 : 1)}M`; // M = 백만 달러
export const fare = (v: number): string => `$${Math.round(v).toLocaleString('en-US')}`;
export const num = (v: number): string => Math.round(v).toLocaleString('en-US');
export const pct = (v: number): string => `${Math.round(v * 100)}%`;
export const km = (v: number): string => `${Math.round(v).toLocaleString('en-US')} km`;
export const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
/** 받침 유무에 따라 을/를을 붙인다(이름 뒤) */
export const eulReul = (w: string): string => { const c = w.charCodeAt(w.length - 1); return w + (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? '을' : '를'); };
