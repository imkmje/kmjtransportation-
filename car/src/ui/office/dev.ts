// 개발용: dev-office.html에서 사무실 장면을 조작해 본다(게임에는 안 들어감).
import { createOffice, type OfficeStaff, type OfficeView, type OfficeEvent, type Role, type Stat } from './office';
import { silhouetteSvg } from '../../render/silhouette';
import { lookOf } from '../art';

const stage = document.getElementById('stage')!;
const ctl = document.getElementById('ctl')!;
const office = createOffice(stage);

const FAMILY = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임'];
const GIVEN = ['하늘', '도윤', '서연', '민준', '지우', '하린', '예준', '수아', '시우', '지호'];
const ROLES: Role[] = ['designer', 'engineer', 'engineer', 'tester', 'sales'];
const pool: OfficeStaff[] = Array.from({ length: 24 }, (_, i) => ({
  id: `s${i + 1}`, name: FAMILY[i % 10] + GIVEN[(i * 3) % 10], role: ROLES[i % ROLES.length], condition: 0.8, working: true,
}));
const st = { level: 1 as OfficeView['level'], count: 4, phase: 'design' as OfficeView['phase'], budget: 'normal' as OfficeView['budget'], tired: 0, idle: 0, car: true, size: 'tablet' };
let defects = 2, progress = 0.35;
const SIZES: Record<string, [number, number]> = { tablet: [700, 940], phone: [360, 300], wide: [900, 600] };
const car = silhouetteSvg(lookOf({ body: 'sedanM', powertrain: 'gas', tier: 2, color: '#ff5a1f', wheels: 1, year: 2020 }), { color: '#ff5a1f' });

function view(): OfficeView {
  const staff = pool.slice(0, st.count).map((s, i) => ({ ...s, condition: i < Math.round(st.count * st.tired) ? 0.2 : 0.8, working: i >= Math.round(st.count * st.idle) }));
  return { level: st.level, staff, phase: st.phase, budget: st.budget, projectName: '모닝스타 1세대', carSvg: st.car ? car : undefined, progress, defects };
}
function apply() {
  const [w, h] = SIZES[st.size];
  stage.style.width = w + 'px'; stage.style.height = h + 'px';
  office.update(view());
  ctl.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach((b) => b.setAttribute('aria-pressed', String(String((st as Record<string, unknown>)[b.dataset.k!]) === b.dataset.v)));
  (document.getElementById('cnt') as HTMLOutputElement).value = String(st.count);
}
const seg = (label: string, k: string, opts: [string, string][]) =>
  `<div class="row"><b>${label}</b>${opts.map(([v, t]) => `<button data-k="${k}" data-v="${v}">${t}</button>`).join('')}</div>`;
ctl.innerHTML =
  seg('등급', 'level', [['1', '1 창고'], ['2', '2 소형'], ['3', '3 본사'], ['4', '4 연구'], ['5', '5 글로벌']]) +
  `<div class="row"><b>인원</b><input id="count" type="range" min="0" max="20" value="4"><output id="cnt">4</output>
   <button id="full">정원만큼</button></div>` +
  seg('단계', 'phase', [['rest', '쉬는 중'], ['design', '설계 중'], ['test', '시험 중']]) +
  seg('예산', 'budget', [['low', '절약'], ['normal', '보통'], ['high', '과감']]) +
  seg('지침 비율', 'tired', [['0', '0'], ['0.25', '1/4'], ['0.5', '1/2'], ['1', '전부']]) +
  seg('미배치', 'idle', [['0', '0'], ['0.25', '1/4'], ['0.5', '1/2']]) +
  seg('무대', 'size', [['tablet', '태블릿 700×940'], ['phone', '폰 360×300'], ['wide', '넓은 칸 900×600']]) +
  `<div class="row"><button id="score">점수 이벤트 한 주 발생</button><button id="found">결함 발견</button><button id="fixed">결함 제거</button>
   <button id="say">말풍선</button><button id="launch">출시 대사</button><button id="act">멈춤/재개</button></div>`;

ctl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-k]');
  if (!b) return;
  const k = b.dataset.k!, v = b.dataset.v!;
  (st as Record<string, unknown>)[k] = ['level', 'tired', 'idle'].includes(k) ? Number(v) : v;
  if (k === 'level') st.count = [0, 4, 8, 12, 16, 20][st.level];
  (document.getElementById('count') as HTMLInputElement).value = String(st.count);
  apply();
});
document.getElementById('count')!.addEventListener('input', (e) => { st.count = Number((e.target as HTMLInputElement).value); apply(); });
document.getElementById('full')!.onclick = () => { st.count = [0, 4, 8, 12, 16, 20][st.level]; (document.getElementById('count') as HTMLInputElement).value = String(st.count); apply(); };
const STATS: Record<Role, Stat[]> = { designer: ['디자인', '실용'], engineer: ['성능', '연비', '실용'], tester: ['품질'], sales: ['실용'] };
document.getElementById('score')!.onclick = () => {
  const ev: OfficeEvent[] = [];
  for (const s of view().staff) if (s.working && st.phase !== 'rest') for (let j = 0; j < 1 + (Math.random() < 0.4 ? 1 : 0); j++)
    ev.push({ kind: 'score', staffId: s.id, stat: STATS[s.role][Math.floor(Math.random() * STATS[s.role].length)], amount: 1 + Math.floor(Math.random() * 5) });
  progress = Math.min(1, progress + 0.08);
  apply(); office.emit(ev);
};
document.getElementById('found')!.onclick = () => { defects++; apply(); office.emit([{ kind: 'defectFound' }]); };
document.getElementById('fixed')!.onclick = () => { defects = Math.max(0, defects - 1); apply(); office.emit([{ kind: 'defectFixed' }]); };
document.getElementById('say')!.onclick = () => office.emit([{ kind: 'say' }]);
document.getElementById('launch')!.onclick = () => office.emit([{ kind: 'say', mood: 'launch' }, { kind: 'say', mood: 'launch' }]);
let on = true;
document.getElementById('act')!.onclick = () => { on = !on; office.setActive(on); };
apply();
// Playwright 확인용
(window as unknown as Record<string, unknown>).__office = { st, apply, office, view };
