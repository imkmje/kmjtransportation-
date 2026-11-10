export const money = (m: number): string => `${m < 0 ? '-' : ''}$${Math.abs(m).toFixed(Math.abs(m) >= 100 ? 0 : 1)}M`; // M = 백만 달러
export const fare = (v: number): string => `$${Math.round(v).toLocaleString('en-US')}`;
export const num = (v: number): string => Math.round(v).toLocaleString('en-US');
export const pct = (v: number): string => `${Math.round(v * 100)}%`;
export const km = (v: number): string => `${Math.round(v).toLocaleString('en-US')} km`;
export const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
