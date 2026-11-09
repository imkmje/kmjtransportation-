import type { OneWay } from './network';
import type { Signals } from './signals';
import { RestrictKind, SignalMode, BuildingKind, BuildingSize, Network, NetworkData, PlanError, Pt, RoadKind, SignKind } from './network';
import type { Config } from '../config';

// 도로망 + 실행 취소/다시 실행. 전체 상태 스냅샷 방식(도로망이 작은 동안은 가장 단순하고 안전)
export class Editor {
  readonly network: Network;
  private history: string[] = [];
  private index = 0;

  constructor(private cfg: Pick<Config, 'geometry' | 'roads' | 'editor' | 'buildings' | 'speedChoicesKmh' | 'zones'>) {
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

  // 건물·구역은 실행 취소 대상이 아니다(취소·다시 실행은 도로·표지·속도만 되돌린다). 그래서 기록을 남기지 않는다
  addBuilding(kind: BuildingKind, size: BuildingSize, x: number, y: number, source: 'player' | 'map' | 'auto' = 'player', deletable = true, variant = 0, density: 0 | 1 | 2 = 0): ReturnType<Network['addBuilding']> {
    return this.network.addBuilding(kind, size, x, y, source, deletable, variant, density);
  }

  removeBuilding(id: number): ReturnType<Network['removeBuilding']> {
    return this.network.removeBuilding(id);
  }

  upgrade(segId: number): ReturnType<Network['upgradeRoad']> {
    const r = this.network.upgradeRoad(segId);
    if (r.ok) this.commit();
    return r;
  }

  setOneWay(segId: number, v: OneWay | null): ReturnType<Network['setOneWay']> {
    const r = this.network.setOneWay(segId, v);
    if (r.ok) this.commit();
    return r;
  }

  setRestrict(segId: number, nodeId: number, kind: RestrictKind | null): ReturnType<Network['setRestrict']> {
    const r = this.network.setRestrict(segId, nodeId, kind);
    if (r.ok) this.commit();
    return r;
  }

  setSignalProgram(nodeId: number, p: { greens?: number[]; offset?: number }): ReturnType<Network['setSignalProgram']> {
    const r = this.network.setSignalProgram(nodeId, p);
    if (r.ok) this.commit();
    return r;
  }

  /** 녹색파: segId 도로를 fromNode에서 반대쪽 교차로 방향으로 달리는 차량이 연달아 녹색을 받도록 맞춘다 */
  greenWave(segId: number, fromNode: number, signals: Signals): ReturnType<Signals['greenWave']> {
    const r = signals.greenWave(segId, fromNode);
    if (r.ok) this.commit();
    return r;
  }

  setSignal(nodeId: number, on: boolean, mode: SignalMode = 'fixed', green = 0): ReturnType<Network['setSignal']> {
    const r = this.network.setSignal(nodeId, on, mode, green);
    if (r.ok) this.commit();
    return r;
  }

  setSpeedLimit(segId: number, kmh: number | null): ReturnType<Network['setSpeedLimit']> {
    const r = this.network.setSpeedLimit(segId, kmh);
    if (r.ok) this.commit();
    return r;
  }

  demolish(segId: number): boolean {
    const ok = this.network.removeSegment(segId); // 외부 연결 도로(locked)는 false
    if (ok) this.commit();
    return ok;
  }

  /** 저장 슬롯·파일 불러오기. 불러오기도 실행 취소로 되돌릴 수 있다 */
  loadText(text: string): void {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error('도로망 파일이 아닙니다'); }
    this.loadData(Network.parse(raw, this.cfg));
  }

  loadData(data: NetworkData): void {
    this.network.load(data);
    this.commit();
  }

  exportText(): string {
    return this.snapshot();
  }

  /** 지금 상태를 처음 상태로 삼아 취소·다시 실행 기록을 비운다 */
  resetHistory(): void {
    this.history = [this.snapshot()];
    this.index = 0;
  }

  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index < this.history.length - 1; }

  /** 도로 쪽만 기록으로 되돌리고, 건물·구역은 지금 것을 그대로 둔다 */
  private restore(text: string): void {
    const live = this.network.toJSON();
    this.network.load({ ...(JSON.parse(text) as NetworkData), buildings: live.buildings, nextBuildingId: live.nextBuildingId, zones: live.zones });
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    this.index--;
    this.restore(this.history[this.index]);
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    this.index++;
    this.restore(this.history[this.index]);
    return true;
  }
}
