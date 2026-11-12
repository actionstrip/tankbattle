// 시드 난수 (mulberry32). 같은 시드면 브라우저·Node 어디서나 같은 수열이 나온다.
// 게임 결과에 영향을 주는 난수(바람·시작 위치·구덩이 모양·CPU 오차)는 모두 이것을 쓴다.

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** 현재 내부 상태 (저장해 두었다가 같은 지점부터 이어 갈 때) */
  get state(): number { return this.s; }
  set state(v: number) { this.s = v >>> 0; }

  /** [0, 1) */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max] 정수 (양 끝 포함) */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1) + min);
  }

  /** [min, max) 실수 */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** 제자리에서 섞고 같은 배열을 돌려준다 */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

/** 새 게임용 시드 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
