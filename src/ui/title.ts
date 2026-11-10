import changelog from '../../CHANGELOG.md?raw';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const inline = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

/** CHANGELOG.md의 버전 항목(## X.Y.Z — 제목)만 뽑아 HTML로 바꾼다. 문서가 단일 출처라 화면용 내역을 따로 쓰지 않는다 */
function history(): string {
  const out: string[] = [];
  let open = false, first = true, list = false;
  for (const line of changelog.split('\n')) {
    const v = /^## (\d+\.\d+\.\d+) — (.+?)(?: \((\d{4}-\d{2}-\d{2}).*\))?$/.exec(line);
    if (v) {
      if (list) { out.push('</ul>'); list = false; }
      if (open) out.push('</details>');
      out.push(`<details${first ? ' open' : ''}><summary><b>v${v[1]}</b> ${inline(v[2])} <span>${v[3] ?? ''}</span></summary>`);
      open = true; first = false;
      continue;
    }
    if (!open) continue;
    if (/^## /.test(line)) { if (list) out.push('</ul>'); out.push('</details>'); open = false; list = false; continue; } // 최신 상태 등
    const h = /^### (.+)/.exec(line);
    if (h) { if (list) { out.push('</ul>'); list = false; } out.push(`<h5>${esc(h[1])}</h5>`); continue; }
    const li = /^- (.+)/.exec(line);
    if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (line.trim() && !list) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  if (open) out.push('</details>');
  return out.join('');
}

/** 시작 화면. 열려 있는 동안 게임은 멈춰 있고(onOpen), 닫으면 이어진다(onClose) */
export function createTitle(root: HTMLElement, version: string, hasAutosave: () => Promise<boolean>, onOpen: () => void, onClose: (loadAuto: boolean) => void) {
  root.innerHTML = `
    <div class="card">
      <h1>교통 시뮬레이션</h1>
      <p class="sub">도로를 깔고, 구역을 칠하고, 막히는 곳을 찾아 고치는 3D 교통 게임 · <b>v${version}</b></p>
      <div class="btns"><button id="t-start">시작하기</button><button id="t-auto" hidden>자동 저장 불러오기</button></div>
      <details class="histwrap"><summary>업데이트 내역</summary><div class="hist">${history()}</div></details>
    </div>`;
  const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const close = (auto: boolean) => { root.hidden = true; onClose(auto); };
  q('#t-start').onclick = () => close(false);
  q('#t-auto').onclick = () => close(true);
  return {
    async show() {
      root.hidden = false;
      onOpen();
      q('#t-auto').hidden = !(await hasAutosave().catch(() => false));
    },
  };
}
