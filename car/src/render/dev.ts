// 개발용 렌더 확인 페이지 스크립트(car/dev-render.html). URL 값으로 시작 상태를 정할 수 있다: ?body=suv&era=1970&color=%23c8202f&pt=ev&sporty=1&wheel=2&rot=0
import type { BodyId, CarLook } from './look';
import { BODY } from './shapes';
import { Stage } from './stage';
import { buildCar, createCarMaterials, disposeCar } from './carBuilder';
import { silhouetteSvg } from './silhouette';

const $ = (id: string) => document.getElementById(id)!;
const q = new URLSearchParams(location.search);
const PAINT = ['#c8202f', '#f26a1b', '#1f5c4a', '#1f4fd1', '#eef0f2', '#3a3f47', '#14213d', '#c9b38a'];
const look: CarLook = {
  bodyId: (q.get('body') as BodyId) || 'sedanM',
  powertrain: (q.get('pt') as CarLook['powertrain']) || 'gas',
  color: q.get('color') || PAINT[0],
  wheel: (Number(q.get('wheel') ?? 1) as CarLook['wheel']),
  sporty: q.get('sporty') === '1',
  era: (Number(q.get('era') || 2020) as CarLook['era']),
};
let rot = q.get('rot') !== '0';
const stage = Stage.supported() ? new Stage($('cv') as HTMLCanvasElement, $('stage')) : null;
(window as unknown as { stage: Stage | null }).stage = stage;

// buildCar 1회 시간(재질은 한 벌로 고정, 첫 회는 워밍업)
function measure() {
  const M = createCarMaterials(look.color), t: number[] = [];
  for (let i = 0; i < 11; i++) { const t0 = performance.now(); const g = buildCar(look, M); t.push(performance.now() - t0); disposeCar(g); }
  for (const m of Object.values(M)) m.dispose();
  t.shift(); t.sort((a, b) => a - b);
  return t[t.length >> 1];
}

function render() {
  if (stage) { stage.setCar(look); stage.setAutoRotate(rot); }
  else { $('cv').hidden = true; $('fb').hidden = false; $('fb').innerHTML = silhouetteSvg(look, { color: look.color }); }
  const pick = (id: string, items: [string, string][], cur: string, set: (v: string) => void, rebuild = true) => {
    $(id).innerHTML = items.map(([k, label]) => `<button data-k="${k}" aria-pressed="${k === cur}">${label}</button>`).join('');
    $(id).onclick = e => { const k = (e.target as HTMLElement).closest('button')?.dataset.k; if (!k) return; set(k); if (rebuild) render(); else for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.k === k)); };
  };
  pick('bodies', (Object.keys(BODY) as BodyId[]).map(k => [k, silhouetteSvg({ ...look, bodyId: k }) + k]), look.bodyId, v => { look.bodyId = v as BodyId; });
  pick('eras', [['1970', '1970'], ['2020', '2020']], String(look.era), v => { look.era = Number(v) as CarLook['era']; });
  pick('pts', [['gas', '가솔린'], ['ev', '전기']], look.powertrain, v => { look.powertrain = v as CarLook['powertrain']; });
  pick('colors', PAINT.map(c => [c, `<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${c}"></span>`]), look.color, v => { look.color = v; stage?.setColor(v); }, false);
  $('sporty').setAttribute('aria-pressed', String(!!look.sporty));
  $('wheel').textContent = `휠 ${look.wheel}`;
  $('rot').setAttribute('aria-pressed', String(rot));
  const ms = measure();
  (window as unknown as { buildMs: number }).buildMs = ms;
  $('info').textContent = `buildCar ${ms.toFixed(1)}ms (중앙값 10회)`;
}
$('sporty').onclick = () => { look.sporty = !look.sporty; render(); };
$('wheel').onclick = () => { look.wheel = ((look.wheel + 1) % 3) as CarLook['wheel']; render(); };
$('rot').onclick = () => { rot = !rot; render(); };
$('snap').onclick = () => { if (stage) window.open()?.document.write(`<img src="${stage.snapshot()}">`); };
render();
