// 고정 타임스텝 루프. 배속은 "프레임당 처리할 tick 수"로 구현한다.
export class TickLoop {
  private acc = 0;
  private lastSpeed = 0;
  private winTicks = 0;
  private winTime = 0;
  /** 최근 실제 배속(1초 단위로 측정). 목표보다 낮으면 따라가지 못하는 중. 배속이 바뀌면 목표값에서 다시 시작 */
  actualSpeed = 0;
  /** 다음 tick까지 얼마나 왔는지(0~1). 화면 보간용. 정지 중에는 1 */
  get alpha(): number {
    return this.lastSpeed > 0 ? this.acc : 1;
  }
  constructor(
    private tickRate: number,
    private maxTicksPerFrame: number,
    private step: () => void,
  ) {}

  /** realDt: 지난 프레임의 실제 경과 초. speed: 0(정지)/1/2/4. 처리한 tick 수를 반환 */
  advance(realDt: number, speed: number): number {
    if (speed !== this.lastSpeed) {
      this.lastSpeed = speed;
      this.actualSpeed = speed;
      this.winTicks = 0;
      this.winTime = 0;
      this.acc = 0;
    }
    if (speed <= 0) return 0;
    this.acc += realDt * speed * this.tickRate;
    let n = Math.floor(this.acc);
    this.acc -= n;
    if (n > this.maxTicksPerFrame) n = this.maxTicksPerFrame; // 밀린 tick은 버린다
    for (let i = 0; i < n; i++) this.step();
    this.winTicks += n;
    this.winTime += realDt;
    if (this.winTime >= 1) {
      this.actualSpeed = this.winTicks / this.tickRate / this.winTime;
      this.winTicks = 0;
      this.winTime = 0;
    }
    return n;
  }
}
