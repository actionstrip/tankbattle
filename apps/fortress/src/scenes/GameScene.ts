import Phaser from 'phaser';
import {
  Rng, blastOf, decodeStock, digBehindTank, makeShell, planAiShot, randomSeed, randomizeSpawns, shellContact,
  shellOffsets, sideOf, splashDamage, stepShell,
} from '@fortress/shared';
import type { AiPlan, HitKind, ShellImpact, ShellState, ShotMessage, TerrainOp } from '@fortress/shared';
import { CONFIG } from '../config';
import type { GameMode, Player, Team, Weapon, WeaponKey } from '../config';
import { Hud } from '../hud';
import type { GameRoom, NetSession } from '../net/session';
import { ChatBox } from '@games/web';
import { Snow } from '../snow';
import { Sfx, Bgm } from '../sound';
import type { SfxId } from '../sound';
import { Tank } from '../tank';
import type { BarrelInfo } from '../tankSlicer';
import { Terrain } from '../terrain';
import { UI, addFixedBackground, uiPanel, uiText } from '../ui';

// waiting = (온라인) 발사를 보내고 서버 판정을 기다리는 중
type GameState = 'idle' | 'intro' | 'aiming' | 'charging' | 'waiting' | 'flying' | 'resolving' | 'gameover';

/** 날아가는 중인 포탄 (궤적 상태 + 표시 객체) */
interface Shell extends ShellState {
  weapon: Weapon;
  owner: Tank;
  sprite: Phaser.GameObjects.Image;
  glow?: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Particles.ParticleEmitter;
  /** (온라인) 서버가 정한 착탄. 이 스텝 수가 되면 그 자리에서 터진다 */
  impact?: ShellImpact;
  steps: number;
}

/** 온라인: 조준 각도를 서버에 보내는 최소 간격 (ms) */
const AIM_SEND_MS = 80;

// 무기별 폭발음
const EXPLODE_SFX: Record<WeaponKey, SfxId> = {
  normal: 'explode_normal',
  heavy: 'explode_big',
  triple: 'explode_small',
};

export class GameScene extends Phaser.Scene {
  private mode: GameMode = 'cpu';
  /** 게임 결과에 영향을 주는 난수 (바람·시작 위치·구덩이 모양·CPU 오차). 연출용 난수는 Phaser 것을 쓴다 */
  private rng!: Rng;
  private terrain!: Terrain;
  private tanks!: Tank[];
  private hud!: Hud;
  private snow!: Snow;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>; // 방향키와 같은 동작
  private weaponKeys!: Phaser.Input.Keyboard.Key[];

  private state: GameState = 'idle';
  private activeIndex = -1;
  private shells: Shell[] = [];
  private followedShell: Shell | null = null;
  private stepAcc = 0;
  private wind = 0;
  private power = 0;
  private weaponIndex = 0;
  private timeLeft: number = CONFIG.TURN_SECONDS;
  private resolveWait = 0;
  private ai: { think: number; plan: AiPlan | null } | null = null;

  private drag: { x: number; scrollX: number } | null = null;
  private cameraFree = false;
  private cameraReturn: Tank | null = null; // 둘러보던 화면이 이 탱크로 부드럽게 돌아가는 중

  // 루프 소리 상태 (updateAiming/updateAi가 매 프레임 켜고, updateLoopSounds가 반영)
  private sndMove = false;
  private sndAim = false;
  private blockedPlayed = false;

  private debug = false;
  private debugTex?: Phaser.Textures.CanvasTexture;
  private debugG?: Phaser.GameObjects.Graphics;
  private debugVersion = -1;

  // ---- 온라인 (net이 있으면 서버가 판정하고, 이 화면은 입력 전달·연출만) ----
  private net: NetSession | null = null;
  /** 서버에서 받은 턴 번호 중 화면에 반영한 마지막 값 */
  private shownTurn = 0;
  /** 연출이 끝나기 전에 도착한 발사 결과 */
  private pendingShot: ShotMessage | null = null;
  /** 지형 변경 기록 중 화면에 반영한 개수 (재접속 시 나머지를 받아 적용) */
  private appliedOps = 0;
  private sentMoveDir = 0;
  private sentAim = { value: -1, at: 0 };
  private netCleanup: (() => void)[] = [];
  private dropNotice: Phaser.GameObjects.Text | null = null;

  constructor() { super('Game'); }

  init(data: { mode?: GameMode | 'online'; net?: NetSession }): void {
    this.net = data.mode === 'online' && data.net?.room ? data.net : null;
    this.mode = this.net ? '2p' : (data.mode as GameMode) || 'cpu';
  }

  private get room(): GameRoom { return this.net!.room!; }

  /** 온라인에서 지금 차례가 내 탱크인지 */
  private get isMyTurn(): boolean {
    if (!this.net) return true;
    const s = this.room.state.tanks[this.activeIndex];
    return !!s && s.owner === this.room.sessionId;
  }

  /** 이 화면에서 직접 조작하는 차례인지 (로컬 사람 차례 또는 온라인 내 차례) */
  private get controlling(): boolean { return !this.ai && this.isMyTurn; }

  create(): void {
    addFixedBackground(this);
    this.rng = new Rng(randomSeed());
    this.terrain = new Terrain(this);
    const barrelInfo = this.registry.get('barrelInfo') as BarrelInfo;
    // 모드별 참가자
    //   cpu = 1P vs CPU, 2p = 1:1 핫시트,
    //   2v2 = 블루팀(사람 2명) vs 레드팀(CPU 2대), 2v2hot = 2:2 핫시트(4명 모두 사람)
    let players: Player[];
    if (this.net) {
      // 온라인: 서버가 정한 순서·위치 그대로
      players = this.room.state.tanks.map((t) => ({
        name: t.name, team: t.team as Team, side: t.side, color: t.color, sprite: t.sprite, spawnX: t.x, facing: t.facing, ai: false,
      }));
    } else {
      const M = CONFIG.MODES[this.mode] || CONFIG.MODES.cpu;
      players = (M.team ? CONFIG.TEAM_PLAYERS : CONFIG.PLAYERS)
        .map((p) => ({ ...p, ai: M.redAi && p.team === 'red' }));
      randomizeSpawns(players, this.terrain, this.rng);
    }
    this.tanks = players.map((p) => new Tank(this, this.terrain, p, barrelInfo));
    this.hud = new Hud(this, this.tanks, this.terrain);
    this.snow = new Snow(this);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, CONFIG.WORLD_W, CONFIG.WORLD_H);

    const keyboard = this.input.keyboard!;
    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' }) as typeof this.wasd;
    this.weaponKeys = [
      keyboard.addKey('ONE'),
      keyboard.addKey('TWO'),
      keyboard.addKey('THREE'),
    ];

    // scene.restart() 시 같은 인스턴스를 다시 쓰므로 상태를 모두 초기화한다.
    this.state = 'idle';
    this.activeIndex = -1; // startTurn이 먼저 넘기므로 첫 탱크부터 시작
    this.shells = [];
    this.followedShell = null;
    this.stepAcc = 0;
    this.wind = 0;
    this.power = 0;
    this.weaponIndex = 0;
    this.timeLeft = CONFIG.TURN_SECONDS;
    this.resolveWait = 0;
    this.ai = null;

    this.debug = new URLSearchParams(location.search).has('debug');
    if (this.debug) this.setupDebug();
    this.setupCameraDrag();

    this.sndMove = false;
    this.sndAim = false;
    this.blockedPlayed = false;
    this.events.once('shutdown', () => {
      Sfx.stopLoops();
      Bgm.stop();
      Sfx.stop('game_win');
      Sfx.stop('game_lose');
    });

    // 배경음악: bgm 폴더의 곡을 무작위 순서로 이어 재생 (씬이 끝나면 위에서 꺼진다)
    Bgm.start(800);

    if (this.net) {
      this.setupNet();
      this.setupChat();
      // 시작 연출 뒤에는 서버가 턴을 열 때까지 기다린다 (netUpdate가 이어 받음)
      this.playIntroSweep(() => { this.state = 'idle'; });
    } else {
      this.playIntroSweep(() => this.startTurn());
    }
  }

  // ---- 온라인 ----

  // 게임 중 채팅: 왼쪽 위(팀 카드 아래)에 떠 있고, Enter로 입력칸을 연다.
  private setupChat(): void {
    const log = this.net?.chat;
    if (!log) return;
    const chat = new ChatBox(log, 'floating', {
      canvas: this.game.canvas,
      gameW: CONFIG.GAME_W,
      x: 16,
      y: this.hud.cardsBottom + 28, // 편 카드 바로 아래
      w: 380,
    });
    const keyboard = this.input.keyboard!;
    const open = () => {
      // 파워를 모으는 중에 열면 Space를 뗀 것으로 처리되어 발사되므로 그때는 열지 않는다
      if (chat.isOpen || this.state === 'charging') return;
      keyboard.resetKeys(); // 누르고 있던 이동·각도 키가 눌린 채로 남지 않게
      chat.open();
    };
    keyboard.on('keydown-ENTER', open);
    this.events.once('shutdown', () => {
      keyboard.off('keydown-ENTER', open);
      chat.destroy();
    });
  }

  private setupNet(): void {
    const room = this.room;
    this.shownTurn = 0;
    this.pendingShot = null;
    this.appliedOps = 0;
    this.sentMoveDir = 0;
    this.sentAim = { value: -1, at: 0 };
    this.dropNotice = null;
    this.syncTanksFromServer(true);

    const onDrop = () => this.showDropNotice('연결이 끊겼어요. 다시 연결하는 중…');
    const onReconnect = () => {
      this.showDropNotice(null);
      void this.catchUpTerrain();
    };
    const onLeave = () => {
      if (this.scene.isActive()) this.scene.start('Lobby', { message: '게임 서버와 연결이 끊겼어요.' });
    };
    room.onDrop(onDrop);
    room.onReconnect(onReconnect);
    room.onLeave(onLeave);
    const offShot = room.onMessage('shot', (msg) => { this.pendingShot = msg; });
    this.netCleanup = [
      () => room.onDrop.remove(onDrop),
      () => room.onReconnect.remove(onReconnect),
      () => room.onLeave.remove(onLeave),
      offShot,
    ];
    this.events.once('shutdown', () => {
      for (const off of this.netCleanup) off();
      this.netCleanup = [];
    });
    // 새로고침·중간 재입장이면 이미 파인 땅이 있다
    void this.catchUpTerrain();
  }

  /** 서버의 지형 기록 중 아직 반영 안 한 것을 적용 */
  private async catchUpTerrain(): Promise<void> {
    const log = await this.room.request('terrainLog').catch(() => [] as TerrainOp[]);
    if (!this.scene.isActive()) return;
    for (let i = this.appliedOps; i < log.length; i++) this.applyTerrainOp(log[i]);
    this.appliedOps = Math.max(this.appliedOps, log.length);
  }

  private applyTerrainOp(op: TerrainOp): void {
    if (op.kind === 'carve') this.terrain.applyCarve(op.carve);
    else this.terrain.applyDig(op.ops);
  }

  private showDropNotice(text: string | null): void {
    this.dropNotice?.destroy();
    this.dropNotice = null;
    if (!text) return;
    this.dropNotice = uiText(this, CONFIG.GAME_W / 2, 140, 18, { color: UI.GOLD_CSS, stroke: 6 })
      .setText(text).setOrigin(0.5).setScrollFactor(0).setDepth(CONFIG.DEPTH.OVERLAY);
  }

  /** 서버 상태로 탱크를 맞춘다. full이면 위치·체력·탄까지 (턴 시작·게임 시작 때) */
  private syncTanksFromServer(full: boolean): void {
    this.room.state.tanks.forEach((s, i) => {
      const t = this.tanks[i];
      if (!t) return;
      if (full) {
        t.x = s.x;
        t.y = s.y;
        t.falling = false;
        t.vy = 0;
        t.hp = s.hp;
        t.fuel = s.fuel;
        t.facing = s.facing;
        t.elevation = s.elevation;
        s.stock.forEach((n, k) => { t.stock[k] = decodeStock(n); });
      }
      if (s.dead && !t.dead) t.die();
    });
  }

  /** 매 프레임: 서버 상태를 화면 진행에 반영 */
  private netUpdate(dt: number): void {
    const st = this.room.state;
    this.timeLeft = st.timeLeft;

    // 발사 결과가 왔고 쏠 준비가 됐으면 포탄을 날린다
    if (this.pendingShot && (this.state === 'aiming' || this.state === 'charging' || this.state === 'waiting')
      && this.pendingShot.turnCount === this.shownTurn) {
      const shot = this.pendingShot;
      this.pendingShot = null;
      this.playShot(shot);
      return;
    }

    // 쉬는 중(idle)이거나, 쏘지 않은 채 서버가 차례를 넘겼으면 새 턴을 연다
    // (이미 쏜 뒤라도 열어 두면 도착해 있는 발사 결과를 이어서 보여 준다)
    const newTurn = st.turnCount > this.shownTurn && (st.turnPhase === 'aiming' || st.turnPhase === 'flying');
    if (newTurn && (this.state === 'idle' || this.state === 'aiming' || this.state === 'charging')) {
      this.netStartTurn();
      return;
    }

    // 게임 끝 (포탄 연출 중이면 끝난 뒤에. 조준 중에 상대가 나가 끝난 경우도 포함)
    if (st.phase === 'ended'
      && (this.state === 'idle' || this.state === 'aiming' || this.state === 'charging' || this.state === 'waiting')) {
      this.syncTanksFromServer(true);
      this.endGame(st.winner && st.winner !== 'draw' ? st.winner : null);
      return;
    }

    // 내 차례: 이동 키를 떼고 나면 서버 위치로 부드럽게 맞춘다 (발사는 서버 위치 기준)
    if ((this.state === 'aiming' || this.state === 'charging') && this.isMyTurn && this.sentMoveDir === 0) {
      const s = st.tanks[this.activeIndex];
      const t = this.active;
      if (s && t && !t.falling) {
        const k = Math.min(1, dt * 8);
        t.x += (s.x - t.x) * k;
        t.y += (s.y - t.y) * k;
        if (Math.abs(s.x - t.x) < 0.5) t.x = s.x;
        if (Math.abs(s.y - t.y) < 0.5) t.y = s.y;
        t.fuel = Math.min(t.fuel, s.fuel);
      }
    }

    // 다른 사람 차례: 서버 위치·각도를 부드럽게 따라간다
    if ((this.state === 'aiming' || this.state === 'charging') && !this.isMyTurn) {
      const s = st.tanks[this.activeIndex];
      const t = this.active;
      if (s && t) {
        const k = Math.min(1, dt * 12);
        const moving = Math.abs(s.x - t.x) > 0.5;
        t.x += (s.x - t.x) * k;
        t.y += (s.y - t.y) * k;
        t.facing = s.facing;
        const prevElev = t.elevation;
        t.elevation += (s.elevation - t.elevation) * k;
        t.fuel = s.fuel;
        this.sndMove = moving;
        this.sndAim = Math.abs(t.elevation - prevElev) > 0.05;
      }
    }
  }

  private netStartTurn(): void {
    const st = this.room.state;
    // 연출을 못 하고 지나간 발사(시작 연출 중 등)가 있으면 지형만 서버 기록으로 맞춘다
    if (this.pendingShot && this.pendingShot.turnCount < st.turnCount) {
      this.pendingShot = null;
      void this.catchUpTerrain();
    }
    this.shownTurn = st.turnCount;
    // 이미 쏜 뒤(flying)면 서버 체력은 맞은 뒤 값이라 맞추지 않는다 (포탄 연출에서 피해가 들어감)
    if (st.turnPhase === 'aiming') this.syncTanksFromServer(true);
    this.activeIndex = st.turn;
    this.wind = st.wind;
    this.power = 0;
    this.weaponIndex = 0;
    this.sentMoveDir = 0;
    this.sentAim = { value: this.active.elevation, at: 0 };
    this.state = 'aiming';
    this.ai = null;
    const tank = this.active;
    this.hud.showBanner(this.isMyTurn ? '내 차례!' : `${tank.player.name} 차례`);
    this.focusTank(tank);
  }

  /** 서버 판정 결과대로 포탄을 날린다 (착탄 위치·피해는 서버 값) */
  private playShot(shot: ShotMessage): void {
    const tank = this.tanks[shot.shooter];
    this.activeIndex = shot.shooter;
    tank.facing = shot.facing;
    tank.elevation = shot.elevation;
    tank.lastPower = shot.power;
    tank.stock[shot.weapon] -= 1;
    this.weaponIndex = shot.weapon;
    this.power = shot.power;
    this.launchShells(tank, CONFIG.WEAPONS[shot.weapon], shot.muzzles.map((m) => makeShell(m, shot.power)), shot.impacts);
  }

  /** 착탄 연출 + 서버가 정한 땅 변화·피해 적용 */
  private applyImpact(s: Shell, imp: ShellImpact): void {
    if (imp.hit === 'out') return;
    if (imp.carve) { this.terrain.applyCarve(imp.carve); this.appliedOps++; }
    imp.damages.forEach((amount, i) => this.tanks[i].damage(amount));
    if (imp.dig) { this.terrain.applyDig(imp.dig); this.appliedOps++; }
    this.explosionEffects(imp.x, imp.y, s.weapon, imp.radius, imp.scale);
  }

  // 스테이지 시작 연출: 맵 가운데에서 시작해 턴 순서대로 탱크를 하나씩 비춘다
  // (easeOut으로 이동 → 잠깐 멈춤 → 다음 탱크). 끝나면 콜백 (startTurn이 첫 탱크로 다시 이동).
  private playIntroSweep(onDone: () => void): void {
    const INTRO = { MOVE: 900, HOLD: 600 }; // 탱크 사이 이동 시간, 탱크에서 멈춰 있는 시간 (ms)
    const cam = this.cameras.main;
    const half = CONFIG.GAME_W / 2;
    this.state = 'intro';
    cam.stopFollow();
    cam.centerOn(CONFIG.WORLD_W / 2, CONFIG.WORLD_H / 2); // 맵 가운데

    const order = this.tanks.filter((t) => !t.dead);
    const visit = (i: number) => {
      if (i >= order.length) { onDone(); return; }
      const x = Phaser.Math.Clamp(order[i].x, half, CONFIG.WORLD_W - half);
      cam.pan(x, CONFIG.WORLD_H / 2, INTRO.MOVE, 'Cubic.easeOut', true, (_c: Phaser.Cameras.Scene2D.Camera, progress: number) => {
        if (progress === 1) this.time.delayedCall(INTRO.HOLD, () => visit(i + 1));
      });
    };
    visit(0);
  }

  private get active(): Tank { return this.tanks[this.activeIndex]; }

  private get isAiTurn(): boolean { return !!this.active?.player.ai; }

  // 살아 있는 탱크가 남은 편 목록 (팀전 = 팀, 개인전 = 사람)
  private aliveSides(): string[] {
    return [...new Set(this.tanks.filter((t) => !t.dead).map((t) => sideOf(t.player)))];
  }

  // ---- 카메라 ----

  private focusTank(tank: Tank): void {
    const cam = this.cameras.main;
    const half = CONFIG.GAME_W / 2;
    const x = Phaser.Math.Clamp(tank.x, half, CONFIG.WORLD_W - half);
    this.drag = null;
    this.cameraFree = false;
    this.cameraReturn = null;
    cam.stopFollow();
    cam.pan(x, CONFIG.WORLD_H / 2, 700, 'Sine.easeInOut', true, (_c: Phaser.Cameras.Scene2D.Camera, progress: number) => {
      if (progress === 1 && this.active === tank && this.state === 'aiming') this.followTank(tank);
    });
  }

  // 방향키 또는 WASD 중 하나라도 눌려 있으면 true
  private dirDown(dir: 'up' | 'down' | 'left' | 'right'): boolean {
    return this.cursors[dir].isDown || this.wasd[dir].isDown;
  }

  // 쏘기 전(조준·충전 중)에는 화면을 끌어서 맵을 둘러볼 수 있다.
  // 내 차례뿐 아니라 온라인 상대 차례에도 (상대가 쏘면 포탄을 따라가므로 그때까지).
  private get canDragCamera(): boolean {
    return (this.state === 'aiming' || this.state === 'charging') && (this.controlling || !!this.net);
  }

  private setupCameraDrag(): void {
    const cam = this.cameras.main;
    this.drag = null;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      // 버튼(무기 슬롯 등) 위를 누른 경우에는 화면을 끌지 않는다.
      if (!this.canDragCamera || over.length > 0) return;
      this.drag = { x: p.x, scrollX: cam.scrollX };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag || !p.isDown || !this.canDragCamera) return;
      if (!this.cameraFree) {
        if (Math.abs(p.x - this.drag.x) < 4) return; // 클릭하다 살짝 흔들린 건 무시
        this.drag.x = p.x;
        // 실제로 끌기 시작할 때 따라가기·카메라 이동을 끊는다 (누르기만 하면 그대로)
        cam.panEffect?.reset();
        cam.stopFollow();
        this.cameraReturn = null;
        this.drag.scrollX = cam.scrollX;
      }
      const maxX = CONFIG.WORLD_W - CONFIG.GAME_W;
      cam.scrollX = Phaser.Math.Clamp(this.drag.scrollX - (p.x - this.drag.x), 0, maxX);
      this.cameraFree = true;
    });
    // 손을 떼도 둘러보던 화면에 그대로 머문다. 탱크를 움직이면 부드럽게 탱크로 돌아가고(startCameraReturn),
    // 발사하면 포탄을 따라간다(followShell).
    const end = () => { this.drag = null; };
    this.input.on('pointerup', end);
    this.input.on('pointerupoutside', end);
  }

  // 둘러보던 화면을 탱크 쪽으로 부드럽게 되돌리기 시작한다 (매 프레임 updateCameraReturn).
  // startFollow는 부르는 순간 화면을 대상에게 바로 옮기므로, 가까워진 뒤에 붙인다.
  private startCameraReturn(tank: Tank): void {
    this.cameraFree = false;
    this.cameraReturn = tank;
  }

  private updateCameraReturn(dt: number): void {
    const tank = this.cameraReturn;
    if (!tank) return;
    if (this.drag && this.cameraFree) { this.cameraReturn = null; return; }
    const cam = this.cameras.main;
    const maxX = CONFIG.WORLD_W - CONFIG.GAME_W;
    const target = Phaser.Math.Clamp(tank.x - CONFIG.GAME_W / 2, 0, maxX);
    const diff = target - cam.scrollX;
    if (Math.abs(diff) < 2) {
      this.cameraReturn = null;
      this.followTank(tank);
      return;
    }
    cam.scrollX += diff * (1 - Math.exp(-6 * dt)); // 멀수록 빠르게, 가까워질수록 천천히
  }

  // 둘러보던 화면을 다시 탱크로 붙인다.
  private followTank(tank: Tank): void {
    this.cameraFree = false;
    this.cameraReturn = null;
    this.cameras.main.startFollow(tank.root, false, 0.15, 0.15);
  }

  private followShell(shell: Shell | null): void {
    this.drag = null;
    this.cameraFree = false;
    this.followedShell = shell;
    this.cameraReturn = null; // 탱크로 되돌아가는 중에 쏘면 멈추고 포탄을 따라간다
    const cam = this.cameras.main;
    cam.panEffect?.reset();
    cam.stopFollow();
    if (shell) cam.startFollow(shell.sprite, false, 0.1, 0.1);
  }

  // ---- 턴 ----

  private startTurn(): void {
    // 다음 살아 있는 탱크로 넘긴다 (죽은 탱크는 건너뜀).
    const n = this.tanks.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.activeIndex + k) % n;
      if (!this.tanks[i].dead) { this.activeIndex = i; break; }
    }
    const tank = this.active;
    tank.fuel = CONFIG.TANK.FUEL;
    const max = CONFIG.PHYSICS.WIND_MAX;
    this.wind = this.rng.int(-max, max);
    this.timeLeft = CONFIG.TURN_SECONDS;
    this.power = 0;
    this.weaponIndex = 0;
    this.state = 'aiming';
    this.ai = this.isAiTurn ? { think: 0.9, plan: null } : null;
    this.hud.showBanner(`${tank.player.name} 차례`);
    this.focusTank(tank);
  }

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    this.sndMove = false;
    this.sndAim = false;
    for (const t of this.tanks) t.update(dt);

    if (this.net) {
      // 온라인: 턴 진행·종료는 서버가 정한다
      this.netUpdate(dt);
    } else if ((this.state === 'aiming' || this.state === 'charging')
      && (this.active.dead || this.aliveSides().length < 2)) {
      // 조준 중에 내 탱크가 죽거나(맵 아래로 떨어지는 등) 한 팀이 전멸하면 쏘지 않고 바로 정산한다.
      this.beginResolve();
    }

    switch (this.state) {
      case 'aiming': this.updateAiming(dt); break;
      case 'charging': this.updateCharging(dt); break;
      case 'flying': this.updateShells(dt); break;
      case 'resolving': this.updateResolving(dt); break;
      default: break;
    }

    this.updateCameraReturn(dt);
    this.updateLoopSounds();
    this.snow.update(dt, this.wind, time);
    this.hud.update({
      active: this.state === 'gameover' ? null : this.active,
      wind: this.wind,
      timeLeft: this.timeLeft,
      power: this.power,
      weaponIndex: this.weaponIndex,
      isAi: this.isAiTurn,
      // 남이 조종하는 차례(CPU·온라인 상대)에는 예상 탄도를 보여 주지 않는다
      controlled: this.controlling,
      time,
      shell: this.followedShell,
    });
    if (this.debug) this.updateDebug();
  }

  private updateAiming(dt: number): void {
    const tank = this.active;
    if (this.ai) { this.updateAi(dt); return; }
    if (!this.isMyTurn) return; // 온라인 상대 차례: netUpdate가 서버 상태를 따라간다

    if (this.net) {
      // 시간 초과는 서버가 처리한다 (0이 되면 입력만 막음)
      if (this.timeLeft <= 0) { this.sendMove(0); return; }
    } else {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.beginResolve(); return; }
    }

    let moved = false;
    const moveDir = this.dirDown('left') ? -1 : (this.dirDown('right') ? 1 : 0);
    // 온라인: 서버가 같은 코드로 움직이고, 화면은 먼저 움직여 보인다 (턴 시작 때 서버 위치로 맞춤)
    this.sendMove(moveDir);
    if (moveDir) moved = tank.move(moveDir, dt);
    // 둘러보다가 탱크를 움직이면 화면이 다시 탱크를 따라간다.
    if (moved && this.cameraFree && !this.drag) this.startCameraReturn(tank);
    // 이동음: 키를 누르고 있고 막히지 않았으면 (1px 미만이라 이번 프레임에 안 움직였어도) 계속
    this.sndMove = !!moveDir && !tank.blocked && !tank.falling;
    // 막힘음: 키를 누른 채 처음 막혔을 때 한 번만
    if (moveDir && tank.blocked) {
      if (!this.blockedPlayed) Sfx.play('tank_move_blocked');
      this.blockedPlayed = true;
    } else {
      this.blockedPlayed = false;
    }

    const T = CONFIG.TANK;
    const prevElev = tank.elevation;
    if (this.dirDown('up')) tank.elevation += T.AIM_SPEED * dt;
    if (this.dirDown('down')) tank.elevation -= T.AIM_SPEED * dt;
    tank.elevation = Phaser.Math.Clamp(tank.elevation, T.ELEV_MIN, T.ELEV_MAX);
    this.sndAim = tank.elevation !== prevElev;
    this.sendAim(tank.elevation);

    this.weaponKeys.forEach((key, i) => {
      if (Phaser.Input.Keyboard.JustDown(key)) this.selectWeapon(i);
    });

    if (Phaser.Input.Keyboard.JustDown(this.cursors.space) && !tank.falling) {
      this.sendMove(0);
      this.power = 0;
      this.state = 'charging';
    }
  }

  /** 온라인: 이동 키 상태가 바뀔 때만 보낸다 */
  private sendMove(dir: number): void {
    if (!this.net || dir === this.sentMoveDir) return;
    this.sentMoveDir = dir;
    this.room.send('move', { dir });
  }

  /** 온라인: 각도가 바뀌면 너무 자주 보내지 않게 간격을 두고 보낸다 */
  private sendAim(elevation: number): void {
    if (!this.net) return;
    const now = this.time.now;
    if (Math.abs(elevation - this.sentAim.value) < 0.05 || now - this.sentAim.at < AIM_SEND_MS) return;
    this.sentAim = { value: elevation, at: now };
    this.room.send('aim', { elevation });
  }

  private updateAi(dt: number): void {
    const tank = this.active;
    const ai = this.ai!;
    if (ai.think > 0) { ai.think -= dt; return; }
    if (tank.falling) return;

    if (!ai.plan) {
      // 가장 가까운 살아 있는 적을 노린다.
      const enemies = this.tanks.filter((t) => !t.dead && sideOf(t.player) !== sideOf(tank.player));
      const enemy = enemies.reduce((a, b) => (Math.abs(b.x - tank.x) < Math.abs(a.x - tank.x) ? b : a));
      ai.plan = planAiShot(tank, enemy, this.wind, this.terrain, this.tanks, this.rng);
      tank.facing = ai.plan.facing;
      this.weaponIndex = ai.plan.weapon;
    }

    const diff = ai.plan.elevation - tank.elevation;
    const stepDeg = CONFIG.TANK.AIM_SPEED * dt;
    if (Math.abs(diff) > stepDeg) {
      tank.elevation += Math.sign(diff) * stepDeg;
      this.sndAim = true;
      return;
    }
    tank.elevation = ai.plan.elevation;
    this.power = 0;
    this.state = 'charging';
  }

  private updateCharging(dt: number): void {
    this.power = Math.min(100, this.power + CONFIG.CHARGE_SPEED * dt);
    if (this.ai) {
      const target = this.ai.plan!.power;
      if (this.power >= target) {
        this.power = target;
        this.fire();
      }
      return;
    }
    if (!this.net) this.timeLeft -= dt;
    if (this.power >= 100 || this.cursors.space.isUp || this.timeLeft <= 0) this.fire();
  }

  private fire(): void {
    const tank = this.active;
    if (this.net) {
      // 온라인: 서버에 보내고 판정 결과('shot')를 기다린다
      this.room.send('fire', {
        weapon: this.weaponIndex, power: this.power, elevation: tank.elevation, facing: tank.facing,
      });
      this.state = 'waiting';
      return;
    }
    const weapon = CONFIG.WEAPONS[this.weaponIndex];
    tank.stock[this.weaponIndex] -= 1;
    tank.lastPower = this.power;
    const states = shellOffsets(weapon).map((o) => makeShell(tank.muzzle(tank.elevation + o), this.power));
    this.launchShells(tank, weapon, states);
  }

  /** 포탄을 화면에 띄우고 발사 연출. impacts가 있으면(온라인) 서버가 정한 스텝에 터진다 */
  private launchShells(tank: Tank, weapon: Weapon, states: ShellState[], impacts?: ShellImpact[]): void {
    this.stepAcc = 0;
    for (const [id, state] of states.entries()) {
      const size = weapon.scale || 1;
      const sprite = this.add.image(state.x, state.y, 'shell').setScale(size).setDepth(CONFIG.DEPTH.SHELL);
      // 강력탄 등: 포탄 뒤에 은은하게 깜빡이는 빛 무리
      let glow: Phaser.GameObjects.Image | undefined;
      if (weapon.glow) {
        glow = this.add.image(state.x, state.y, 'dot').setTint(weapon.glow)
          .setBlendMode(Phaser.BlendModes.ADD).setScale(1.7 * size).setAlpha(0.9)
          .setDepth(CONFIG.DEPTH.SHELL - 1);
        this.tweens.add({
          targets: glow, alpha: 0.55, scale: 1.45 * size,
          duration: 180, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
      }
      const trail = this.add.particles(0, 0, 'dot', {
        follow: sprite, frequency: 28, lifespan: 380, scale: { start: 0.32 * size, end: 0 },
        alpha: { start: 0.55, end: 0 }, tint: weapon.glow || 0xe5e7eb,
      }).setDepth(CONFIG.DEPTH.SHELL - 2);
      const impact = impacts?.find((imp) => imp.shell === id);
      this.shells.push({ ...state, weapon, owner: tank, sprite, glow, trail, impact, steps: 0 });
    }
    this.followShell(this.shells[Math.floor(this.shells.length / 2)]);
    Sfx.play(`fire_${weapon.key}`, { rate: Phaser.Math.FloatBetween(0.95, 1.05), ...this.soundAt(tank.x) });
    this.cameras.main.shake(90, 0.003);
    const m = tank.muzzle();
    this.muzzleFlash(m);
    tank.recoil(m.dirX, weapon.recoil || 1);
    this.state = 'flying';
  }

  private updateShells(dt: number): void {
    const P = CONFIG.PHYSICS;
    this.stepAcc += dt;
    while (this.stepAcc >= P.STEP && this.shells.length) {
      this.stepAcc -= P.STEP;
      for (let i = this.shells.length - 1; i >= 0; i--) {
        const s = this.shells[i];
        stepShell(s, this.wind);
        s.steps++;
        let hit: HitKind | null;
        if (s.impact) {
          // 온라인: 서버가 정한 스텝에 서버가 정한 자리에서 끝난다
          hit = s.steps >= s.impact.steps ? s.impact.hit : null;
          if (hit) Object.assign(s, { x: s.impact.x, y: s.impact.y, vx: s.impact.vx, vy: s.impact.vy });
        } else {
          hit = shellContact(s, this.terrain, this.tanks, s.owner);
        }
        if (hit) {
          this.shells.splice(i, 1);
          this.finishShell(s, hit);
        }
      }
    }
    for (const s of this.shells) {
      s.sprite.setPosition(s.x, s.y).setRotation(Math.atan2(s.vy, s.vx));
      s.glow?.setPosition(s.x, s.y);
    }
    if (!this.shells.length) {
      this.stepAcc = 0;
      this.followShell(null);
      this.beginResolve();
    }
  }

  private finishShell(s: Shell, hit: HitKind): void {
    s.sprite.destroy();
    if (s.glow) { this.tweens.killTweensOf(s.glow); s.glow.destroy(); }
    s.trail.stop();
    this.time.delayedCall(500, () => s.trail.destroy());
    if (s.impact) {
      this.applyImpact(s, s.impact);
    } else if (hit !== 'out') {
      const radius = this.explode(s.x, s.y, s.weapon, Math.hypot(s.vx, s.vy));
      // 탱크 직격: 맞은 탱크가 땅에 눌린 자국을 낸다
      if (hit === 'tank') digBehindTank(this.terrain, this.tanks, s, radius);
    }
    // 따라가던 포탄이 끝나면 아직 날고 있는 다른 포탄으로 넘어간다.
    if (this.followedShell === s) this.followShell(this.shells[0] || null);
  }

  // speed: 착탄 순간 속도. 빠를수록 구덩이가 크고 데미지가 세다.
  private explode(x: number, y: number, weapon: Weapon, speed?: number): number {
    const { scale, radius, damage } = blastOf(weapon, speed);

    this.terrain.carve(x, y, radius, this.rng);
    for (const t of this.tanks) {
      t.damage(splashDamage(t, x, y, radius, damage));
    }
    this.explosionEffects(x, y, weapon, radius, scale);
    return radius;
  }

  /** 폭발 화면 효과 + 소리 (판정 없음) */
  private explosionEffects(x: number, y: number, weapon: Weapon, radius: number, scale: number): void {
    this.explosionFx(x, y, radius);

    // 폭발음: 무기별로 고르고, 세게 맞을수록(scale 0.7~1.3) 크게, 화면에서 멀수록 작게
    const at = this.soundAt(x);
    Sfx.play(EXPLODE_SFX[weapon.key], {
      ...at,
      volume: at.volume * Phaser.Math.Clamp(0.55 + scale * 0.35, 0.7, 1),
      rate: Phaser.Math.FloatBetween(0.94, 1.06),
    });
    this.time.delayedCall(140, () => Sfx.play('dirt_debris', at));
  }

  // 화면 중심에서 x까지 거리에 따른 볼륨·좌우 패닝. 화면 안이면 거의 그대로, 멀어질수록 작아진다.
  private soundAt(x: number): { volume: number; pan: number } {
    const mid = this.cameras.main.midPoint.x;
    const d = x - mid;
    const W = CONFIG.GAME_W;
    return {
      volume: Phaser.Math.Clamp(1 - Math.max(0, Math.abs(d) - W * 0.5) / W, 0.35, 1),
      pan: Phaser.Math.Clamp(d / W, -0.6, 0.6),
    };
  }

  // 루프 소리는 매 프레임 현재 상태로 켜고 끈다 → 상태가 바뀌면 자동으로 멈춘다.
  private updateLoopSounds(): void {
    const s = this.state;
    Sfx.loop('tank_move', this.sndMove && s === 'aiming');
    Sfx.loop('barrel_aim', this.sndAim && s === 'aiming');
    // 충전음: 파워에 맞춰 피치 상승
    Sfx.loop('charge_loop', s === 'charging', { rate: 0.8 + (this.power / 100) * 0.8 });
    // 비행음: 따라가는 포탄 속도에 맞춰 피치 상승
    const sh = this.followedShell || this.shells[0];
    const speed = sh ? Math.hypot(sh.vx, sh.vy) : 0;
    Sfx.loop('shell_whistle', s === 'flying' && this.shells.length > 0, {
      rate: 0.85 + Phaser.Math.Clamp(speed / 1200, 0, 1) * 0.45,
    });
  }

  private beginResolve(): void {
    this.resolveWait = 0.7;
    this.state = 'resolving';
  }

  private updateResolving(dt: number): void {
    this.resolveWait -= dt;
    if (this.resolveWait > 0) return;
    if (this.tanks.some((t) => t.falling)) return;

    // 온라인: 다음 턴·게임 종료는 서버 신호를 기다린다 (netUpdate)
    if (this.net) { this.state = 'idle'; return; }

    const sides = this.aliveSides();
    if (sides.length < 2) this.endGame(sides[0] || null);
    else this.startTurn();
  }

  // winnerSide: 이긴 편 (팀전 'blue' | 'red', 개인전 'p<자리>') | null(무승부)
  private endGame(winnerSide: string | null): void {
    this.state = 'gameover';
    this.hud.hideTurnInfo();
    // 결과음이 잘 들리도록 배경음은 부드럽게 끈다.
    Bgm.stop(600);
    const W = CONFIG.GAME_W;
    const H = CONFIG.GAME_H;
    const D = CONFIG.DEPTH.OVERLAY;
    this.add.rectangle(0, 0, W, H, 0x0b1a2b, 0.55).setOrigin(0).setDepth(D).setScrollFactor(0);
    let message = '무승부';
    let color = 0xfbbf24;
    // 결과음: CPU 팀이 이기면 패배음, 그 외(사람 팀 승리·핫시트)는 승리음. 무승부는 소리 없음.
    // 온라인: 내 편이 지면 패배음
    const winners = winnerSide ? this.tanks.filter((t) => sideOf(t.player) === winnerSide) : [];
    if (winners.length) {
      const mine = this.net ? this.room.state.tanks.findIndex((s) => s.owner === this.room.sessionId) : -1;
      const lost = this.net
        ? !(mine >= 0 && sideOf(this.tanks[mine].player) === winnerSide)
        : winners.some((t) => t.player.ai);
      Sfx.play(lost ? 'game_lose' : 'game_win');
      const winner = winners[0];
      // 여러 대가 함께 이긴 편 = 팀
      const label = winners.length > 1 ? CONFIG.TEAMS[winner.player.team] : winner.player.name;
      message = `${label} 승리!`;
      color = winner.player.color;
    }

    // 결과 패널
    const pw = 520;
    const ph = 230;
    const px = W / 2 - pw / 2;
    const py = H / 2 - ph / 2;
    const g = this.add.graphics().setDepth(D + 1).setScrollFactor(0);
    uiPanel(g, px, py, pw, ph, { radius: 18, alpha: 0.92 });
    g.lineStyle(3, color, 1).strokeRoundedRect(px, py, pw, ph, 18);
    g.fillStyle(color, 1).fillRoundedRect(px, py, pw, 8, { tl: 18, tr: 18, bl: 0, br: 0 });

    const fixed = (t: Phaser.GameObjects.Text) => t.setDepth(D + 2).setScrollFactor(0);
    fixed(uiText(this, W / 2, py + 52, 16, { color: UI.MUTED })).setText('게임 종료').setOrigin(0.5);
    fixed(uiText(this, W / 2, py + 102, 56, { color: UI.GOLD_CSS, stroke: 8 })).setText(message).setOrigin(0.5);

    // 버튼: [R] 다시 하기(온라인: 대기실)   [T] 타이틀(온라인: 방 나가기) — 키보드와 마우스 클릭 모두 동작
    let done = false;
    const once = (fn: () => void) => () => { if (!done) { done = true; Sfx.play('ui_click'); fn(); } };
    const net = this.net;
    const restart = once(() => {
      if (net) this.scene.start('Lobby', { net });
      else this.scene.restart({ mode: this.mode });
    });
    const toTitle = once(() => {
      if (net) {
        // 스스로 나가는 것이므로 '연결 끊김' 처리가 끼어들지 않게 리스너부터 뗀다
        for (const off of this.netCleanup) off();
        this.netCleanup = [];
        void net.leave();
      }
      this.scene.start('Title');
    });
    const buttons: [string, string, () => void][] = [
      ['R', net ? '대기실로' : '다시 하기', restart],
      ['T', net ? '나가기' : '타이틀', toTitle],
    ];
    buttons.forEach(([k, label, action], i) => {
      const cx = W / 2 + (i === 0 ? -100 : 100);
      const cy = py + ph - 46;
      const bg = this.add.graphics().setDepth(D + 1.5).setScrollFactor(0);
      const draw = (hover: boolean) => {
        bg.clear();
        bg.fillStyle(hover ? 0x23405f : 0x13263a, 1).fillRoundedRect(cx - 80, cy - 20, 160, 40, 10);
        bg.lineStyle(hover ? 2 : 1.5, hover ? UI.GOLD : 0xffffff, hover ? 1 : 0.15)
          .strokeRoundedRect(cx - 80, cy - 20, 160, 40, 10);
        bg.fillStyle(UI.GOLD, 1).fillRoundedRect(cx - 68, cy - 12, 24, 24, 6);
      };
      draw(false);
      fixed(uiText(this, cx - 56, cy, 14, { color: '#0b1a2b' })).setText(k).setOrigin(0.5);
      fixed(uiText(this, cx - 34, cy, 16)).setText(label).setOrigin(0, 0.5);
      const zone = this.add.zone(cx, cy, 160, 40).setScrollFactor(0).setDepth(D + 3)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => draw(true));
      zone.on('pointerout', () => draw(false));
      zone.on('pointerup', action);
    });
    const keyboard = this.input.keyboard!;
    keyboard.once('keydown-R', restart);
    keyboard.once('keydown-T', toTitle);
  }

  // 무기 선택 (키보드 1·2·3 또는 무기 슬롯 클릭). 내 턴 조준 중에만, 남은 탄이 있을 때만.
  selectWeapon(i: number): void {
    if (this.state !== 'aiming' || !this.controlling) return;
    if (this.active.stock[i] > 0 && this.weaponIndex !== i) {
      this.weaponIndex = i;
      Sfx.play('weapon_select');
    }
  }

  // ---- 이벤트 (Tank가 호출) ----

  onTankDamaged(tank: Tank, amount: number): void {
    if (tank.hp > 0) Sfx.play('tank_hit', this.soundAt(tank.x)); // 격파 시엔 tank_destroyed만
    const label = this.add.text(tank.x, tank.y - 80, `-${amount}`, {
      fontFamily: CONFIG.FONT, fontSize: '30px', fontStyle: 'bold', color: '#fca5a5',
      stroke: '#0b1a2b', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(CONFIG.DEPTH.FX);
    this.tweens.add({
      targets: label, y: label.y - 50, alpha: 0, duration: 900, onComplete: () => label.destroy(),
    });
  }

  onTankDestroyed(tank: Tank): void {
    Sfx.play('tank_destroyed', this.soundAt(tank.x));
    this.explosionFx(tank.x, Math.min(tank.y, CONFIG.WORLD_H - 10) - 20, 70);
  }

  // ---- 연출 ----

  private burst(x: number, y: number, config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig & { lifespan: number }, count: number): void {
    const emitter = this.add.particles(x, y, 'dot', { emitting: false, ...config })
      .setDepth(CONFIG.DEPTH.FX);
    emitter.explode(count);
    this.time.delayedCall(config.lifespan + 200, () => emitter.destroy());
  }

  private explosionFx(x: number, y: number, radius: number): void {
    const ball = this.add.image(x, y, 'dot').setDepth(CONFIG.DEPTH.FX).setTint(0xffd27a)
      .setBlendMode(Phaser.BlendModes.ADD).setScale(0.3);
    this.tweens.add({
      targets: ball, scale: (radius * 2.6) / 32, alpha: 0, duration: 340,
      onComplete: () => ball.destroy(),
    });
    this.burst(x, y, {
      speed: { min: 60, max: radius * 7 }, lifespan: 620, gravityY: 420,
      scale: { start: 0.6, end: 0 }, tint: [0xffb347, 0xff6b35, 0x6b4a2f, 0x3a2a1e],
    }, 36);
    this.cameras.main.shake(180, Math.min(0.012, radius / 6000));
  }

  private muzzleFlash(m: { x: number; y: number }): void {
    const flash = this.add.image(m.x, m.y, 'dot').setDepth(CONFIG.DEPTH.FX).setTint(0xfff1a8)
      .setBlendMode(Phaser.BlendModes.ADD).setScale(1.6);
    this.tweens.add({
      targets: flash, scale: 0.2, alpha: 0, duration: 140, onComplete: () => flash.destroy(),
    });
  }

  // ---- ?debug: 충돌 마스크(자홍), 고정점(초록) ----

  private setupDebug(): void {
    if (this.textures.exists('debugmask')) this.textures.remove('debugmask');
    this.debugTex = this.textures.createCanvas('debugmask', CONFIG.WORLD_W, CONFIG.WORLD_H)!;
    this.add.image(0, 0, 'debugmask').setOrigin(0).setDepth(CONFIG.DEPTH.TERRAIN + 1).setAlpha(0.35);
    this.debugG = this.add.graphics().setDepth(CONFIG.DEPTH.WORLD_UI);
    this.debugVersion = -1;
  }

  private updateDebug(): void {
    const t = this.terrain;
    const tex = this.debugTex!;
    if (this.debugVersion !== t.version) {
      this.debugVersion = t.version;
      const ctx = tex.context;
      const img = ctx.createImageData(t.w, t.h);
      for (let i = 0; i < t.solid.length; i++) {
        if (!t.solid[i]) continue;
        img.data[i * 4] = 255;
        img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      tex.refresh();
    }
    const g = this.debugG!;
    g.clear();
    g.lineStyle(3, 0x22c55e, 1);
    for (const a of t.anchors) g.strokeCircle(a.x, a.y, a.r);
  }
}
