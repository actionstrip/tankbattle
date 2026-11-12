// 한 판의 진행 (서버 판정). Room과 분리해 두어 테스트·재사용이 쉽다.
// 탱크·지형의 실제 계산은 @fortress/shared 의 같은 코드를 쓴다.
import {
  FFA_COLORS, RULES, Rng, TankBody, clamp, createStageMask, fireVolley, randomizeSpawns, settleTanks, sideOf,
} from '@fortress/shared';
import type { Player, PlayerDef, Team, TerrainMask, TerrainOp, VolleyResult } from '@fortress/shared';

export interface Seat {
  sessionId: string;
  name: string;
  team: Team;
  /** 개인전 색 자리 (FFA_COLORS 번호) */
  slot?: number;
}

export class Match {
  readonly rng: Rng;
  readonly terrain: TerrainMask;
  readonly tanks: TankBody[];
  /** 탱크 번호 → 조종하는 sessionId ('' = 나감) */
  readonly owners: string[];
  /** 처음부터의 지형 변경 (재접속 시 보냄) */
  readonly terrainLog: TerrainOp[] = [];

  turn = -1;
  turnCount = 0;
  wind = 0;
  timeLeft = 0;
  /** 차례인 탱크의 이동 방향 (-1, 0, 1). 키를 누르고 있는 동안 유지 */
  moveDir = 0;

  /**
   * seats는 들어온 순서로 정렬되어 있어야 한다.
   * 팀전: 턴 순서는 블루1·레드1·블루2·레드2. 개인전(ffa): 판마다 무작위 순서, 사람마다 편·색이 다르다.
   */
  constructor(seed: number, seats: Seat[], ffa = false) {
    this.rng = new Rng(seed);
    this.terrain = createStageMask();

    let ordered: Seat[];
    let players: Player[];
    if (ffa) {
      // 차례 순서는 판마다 무작위 (먼저 들어온 사람이 늘 선공이 되지 않게). 색은 자리(slot) 그대로
      ordered = this.rng.shuffle([...seats]);
      players = ordered.map((seat, i) => {
        const slot = seat.slot ?? i;
        const c = FFA_COLORS[slot % FFA_COLORS.length];
        return {
          name: seat.name, team: seat.team, side: `p${slot}`, color: c.color, sprite: c.sprite,
          spawnX: 0, facing: 1, ai: false,
        };
      });
    } else {
      const blue = seats.filter((s) => s.team === 'blue');
      const red = seats.filter((s) => s.team === 'red');
      ordered = [];
      for (let i = 0; i < Math.max(blue.length, red.length); i++) {
        if (blue[i]) ordered.push(blue[i]);
        if (red[i]) ordered.push(red[i]);
      }
      // 색·스프라이트 등은 기존 설정에서 같은 팀 순번대로 가져온다.
      const defs = ordered.length > 2 ? RULES.TEAM_PLAYERS : RULES.PLAYERS;
      players = ordered.map((seat, i) => {
        const base: PlayerDef = defs.filter((d) => d.team === seat.team)[Math.floor(i / 2)] ?? defs[i % defs.length];
        return { ...base, name: seat.name, ai: false };
      });
    }
    randomizeSpawns(players, this.terrain, this.rng);
    this.tanks = players.map((p) => new TankBody(this.terrain, p));
    this.owners = ordered.map((s) => s.sessionId);
  }

  get active(): TankBody | null { return this.tanks[this.turn] ?? null; }

  indexOf(sessionId: string): number { return this.owners.indexOf(sessionId); }

  /** 살아 있는 탱크가 남은 편 (팀전 = 팀, 개인전 = 사람) */
  aliveSides(): string[] {
    return [...new Set(this.tanks.filter((t) => !t.dead).map((t) => sideOf(t.player)))];
  }

  /** 다음 살아 있는 탱크로 턴을 넘긴다 */
  nextTurn(): void {
    const n = this.tanks.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.turn + k) % n;
      if (!this.tanks[i].dead) { this.turn = i; break; }
    }
    this.turnCount++;
    this.active!.fuel = RULES.TANK.FUEL;
    this.wind = this.rng.int(-RULES.PHYSICS.WIND_MAX, RULES.PHYSICS.WIND_MAX);
    this.timeLeft = RULES.TURN_SECONDS;
    this.moveDir = 0;
  }

  /** 매 틱: 차례인 탱크 이동, 모든 탱크 낙하 */
  tick(dt: number, aiming: boolean): void {
    const a = this.active;
    if (aiming && a && this.moveDir) a.move(this.moveDir, dt);
    for (const t of this.tanks) t.step(dt);
  }

  setElevation(elevation: number): void {
    const a = this.active;
    if (a) a.elevation = clamp(elevation, RULES.TANK.ELEV_MIN, RULES.TANK.ELEV_MAX);
  }

  /** 쏠 수 있는 무기인지 */
  canUse(weapon: number): boolean {
    const a = this.active;
    return !!a && weapon >= 0 && weapon < RULES.WEAPONS.length && a.stock[weapon] > 0;
  }

  /** 발사 판정. 땅·탱크가 실제로 바뀐다. 낙하까지 끝낸 뒤 걸린 시간(초)도 돌려준다 */
  fire(weapon: number, power: number, elevation: number, facing: number): { volley: VolleyResult; seconds: number } {
    const a = this.active!;
    this.moveDir = 0;
    a.facing = facing < 0 ? -1 : 1;
    this.setElevation(elevation);
    // 판정은 차체가 다 기운 상태 기준 (클라이언트도 조준할 때 이 값에 수렴한다)
    a.slope = a.targetSlope;
    const volley = fireVolley(a, this.tanks, this.terrain, weapon, clamp(power, 0, 100), this.wind, this.rng);
    for (const imp of volley.impacts) {
      if (imp.carve) this.terrainLog.push({ kind: 'carve', carve: imp.carve });
      if (imp.dig) this.terrainLog.push({ kind: 'erase', ops: imp.dig });
    }
    const flight = volley.steps * RULES.PHYSICS.STEP;
    const settle = settleTanks(this.tanks);
    return { volley, seconds: flight + settle };
  }

  /** 나간 사람의 탱크는 기권 처리 */
  forfeit(sessionId: string): void {
    const i = this.indexOf(sessionId);
    if (i < 0) return;
    this.owners[i] = '';
    this.tanks[i].die();
  }
}
