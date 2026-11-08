import { Network, NetworkData, PlanError, Pt, RoadKind, SignKind } from './network';
import type { Config } from '../config';

// 도로망 + 실행 취소/다시 실행. 전체 상태 스냅샷 방식(도로망이 작은 동안은 가장 단순하고 안전)
export class Editor {
  readonly network: Network;
  private history: string[] = [];
  private index = 0;

  constructor(private cfg: Pick<Config, 'geometry' | 'roads' | 'editor'>) {
    this.network = new Network(cfg);
    this.history.push(this.snapshot());
  }

  private snapshot(): string {
    return JSON.stringify(this.network.toJSON());
  }

  private commit(): void {
    this.history.length = this.index + 1; // 다시 실행 기록 버림
    this.history.push(this.snapshot());
    if (this.history.length > this.cfg.editor.historyLimit) this.history.shift();
    this.index = this.history.length - 1;
  }

  build(p1: Pt, p2: Pt, kind: RoadKind): { ok: true; ids: number[]; length: number } | { ok: false; error: PlanError } {
    const r = this.network.buildRoad(p1, p2, kind);
    if (r.ok) this.commit();
    return r;
  }

  setSign(segId: number, nodeId: number, kind: SignKind | null): ReturnType<Network['setSign']> {
    const r = this.network.setSign(segId, nodeId, kind);
    if (r.ok) this.commit();
    return r;
  }

  demolish(segId: number): boolean {
    const ok = this.network.removeSegment(segId);
    if (ok) this.commit();
    return ok;
  }

  /** 저장 슬롯·파일 불러오기. 불러오기도 실행 취소로 되돌릴 수 있다 */
  loadText(text: string): void {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error('도로망 파일이 아닙니다'); }
    this.network.load(Network.parse(raw, this.cfg));
    this.commit();
  }

  exportText(): string {
    return this.snapshot();
  }

  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index < this.history.length - 1; }

  undo(): boolean {
    if (!this.canUndo) return false;
    this.index--;
    this.network.load(JSON.parse(this.history[this.index]) as NetworkData);
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    this.index++;
    this.network.load(JSON.parse(this.history[this.index]) as NetworkData);
    return true;
  }
}
