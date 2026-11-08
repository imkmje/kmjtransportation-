// 저장 슬롯(IndexedDB)과 파일 내보내기/가져오기. localStorage는 용량이 작아 쓰지 않는다.
const DB = 'kmj-transportation';
const STORE = 'slots';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('저장소를 열 수 없습니다'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(new Error('저장소 작업에 실패했습니다')); };
  });
}

export const saveSlot = (slot: number, text: string) => run('readwrite', (s) => s.put(text, slot));
export const loadSlot = (slot: number) => run<string | undefined>('readonly', (s) => s.get(slot));

export function downloadText(filename: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
