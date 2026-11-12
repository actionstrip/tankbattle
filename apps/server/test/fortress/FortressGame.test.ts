import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boot } from '@colyseus/testing';
import type { ColyseusTestServer } from '@colyseus/testing';
import { ROOMS, RULES } from '@fortress/shared';
import type { ShotMessage } from '@fortress/shared';
import type { FortressRoom } from '../../src/fortress/FortressRoom';
import { server } from '../../src/app.config';

/** 조건이 맞을 때까지 패치를 기다린다 */
async function until(room: FortressRoom, cond: () => boolean, maxPatches = 400): Promise<void> {
  for (let i = 0; i < maxPatches && !cond(); i++) await room.waitForNextPatch();
  expect(cond()).toBe(true);
}

describe('FortressRoom 게임 진행', () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => { colyseus = await boot(server, 2581); });
  afterAll(async () => { await colyseus.shutdown(); });
  afterEach(async () => { await colyseus.cleanup(); });

  /** 1:1 방을 만들고 시작해 첫 턴(조준)까지 진행 */
  async function startDuel() {
    const room = await colyseus.createRoom<FortressRoom>(ROOMS.FORTRESS, { teamSize: 1, timeScale: 0.01 });
    const a = await colyseus.connectTo(room, { name: 'A' });
    const b = await colyseus.connectTo(room, { name: 'B' });
    b.send('setReady', { ready: true });
    await room.waitForNextMessage();
    expect(await a.request('start')).toEqual({ ok: true });
    await until(room, () => room.state.turnPhase === 'aiming');
    return { room, a, b };
  }

  it('시작하면 탱크가 배치되고 블루부터 차례가 온다', async () => {
    const { room, a } = await startDuel();
    expect(room.state.tanks.length).toBe(2);
    expect(room.state.turn).toBe(0);
    expect(room.state.tanks[0].owner).toBe(a.sessionId);
    expect(room.state.tanks[0].team).toBe('blue');
    expect(room.state.tanks[0].stock.toArray()).toEqual([-1, 2, 2]);
    expect(Math.abs(room.state.wind)).toBeLessThanOrEqual(RULES.PHYSICS.WIND_MAX);
    // 처음부터 서로 다른 발판에 있다
    expect(room.state.tanks[0].x).not.toBe(room.state.tanks[1].x);
  });

  it('차례가 아닌 사람의 이동·발사는 무시한다', async () => {
    const { room, b } = await startDuel();
    const x0 = room.state.tanks[1].x;
    b.send('move', { dir: 1 });
    b.send('fire', { weapon: 0, power: 50, elevation: 45, facing: 1 });
    for (let i = 0; i < 10; i++) await room.waitForNextPatch();
    expect(room.state.tanks[1].x).toBe(x0);
    expect(room.state.turnPhase).toBe('aiming');
  });

  it('이동하면 연료가 줄고 위치가 바뀐다', async () => {
    const { room, a } = await startDuel();
    const t = room.state.tanks[0];
    const x0 = t.x;
    a.send('move', { dir: t.facing });
    await until(room, () => t.fuel < RULES.TANK.FUEL - 5);
    a.send('move', { dir: 0 });
    expect(t.x).not.toBe(x0);
  });

  it('발사하면 모두에게 판정 결과를 보내고 상대 차례로 넘어간다', async () => {
    const { room, a, b } = await startDuel();
    const gotA = a.waitForMessage('shot') as Promise<ShotMessage>;
    const gotB = b.waitForMessage('shot') as Promise<ShotMessage>;
    a.send('fire', { weapon: 1, power: 60, elevation: 50, facing: room.state.tanks[0].facing });
    const [shotA, shotB] = await Promise.all([gotA, gotB]);

    expect(shotA).toEqual(shotB);
    expect(shotA.shooter).toBe(0);
    expect(shotA.weapon).toBe(1);
    expect(shotA.muzzles).toHaveLength(1);
    expect(shotA.impacts).toHaveLength(1);
    expect(room.state.tanks[0].stock[1]).toBe(1); // 강력탄 1발 사용

    await until(room, () => room.state.turn === 1 && room.state.turnPhase === 'aiming');
    // 지형 기록 요청: 착탄했으면 구덩이가 남아 있다
    const log = await b.request('terrainLog');
    expect(log.length).toBe(shotA.impacts.filter((i) => i.carve).length + shotA.impacts.filter((i) => i.dig).length);
  });

  it('3연발은 포탄 3개를 판정한다', async () => {
    const { room, a } = await startDuel();
    const got = a.waitForMessage('shot') as Promise<ShotMessage>;
    a.send('fire', { weapon: 2, power: 70, elevation: 45, facing: room.state.tanks[0].facing });
    const shot = await got;
    expect(shot.muzzles).toHaveLength(3);
    expect(shot.impacts).toHaveLength(3);
  });

  it('시간이 다 되면 쏘지 않아도 차례가 넘어간다', async () => {
    const { room } = await startDuel();
    // 테스트에서는 남은 시간을 직접 줄인다
    (room as unknown as { match: { timeLeft: number } }).match.timeLeft = -2;
    await until(room, () => room.state.turn === 1 && room.state.turnPhase === 'aiming');
  });

  it('게임 중 나가면 기권 → 남은 팀 승리 → 방장이 대기실로 되돌린다', async () => {
    const { room, a, b } = await startDuel();
    await b.leave();
    await until(room, () => room.state.phase === 'ended');
    expect(room.state.winner).toBe('blue');
    a.send('backToLobby', {});
    await until(room, () => room.state.phase === 'lobby');
    expect(room.state.tanks.length).toBe(0);
  });

  // ---- 개인전 ----

  it('개인전: 준비 없이 2명 이상이면 방장이 시작, 사람마다 다른 편·색', async () => {
    const room = await colyseus.createRoom<FortressRoom>(ROOMS.FORTRESS, { ffa: true, timeScale: 0.01 });
    expect(room.maxClients).toBe(8);
    expect(room.metadata.ffa).toBe(true);
    const a = await colyseus.connectTo(room, { name: 'A' });
    expect(await a.request('start')).toEqual({ ok: false, reason: '2명 이상 모여야 시작할 수 있어요' });
    const b = await colyseus.connectTo(room, { name: 'B' });
    const c = await colyseus.connectTo(room, { name: 'C' });
    // 팀 바꾸기는 무시
    b.send('setTeam', { team: 'red' });
    await room.waitForNextPatch();
    expect([a, b, c].map((x) => room.state.players.get(x.sessionId)!.slot)).toEqual([0, 1, 2]);

    expect(await a.request('start')).toEqual({ ok: true });
    await until(room, () => room.state.turnPhase === 'aiming');
    const tanks = room.state.tanks.toArray();
    expect(tanks.map((t) => t.owner)).toEqual([a.sessionId, b.sessionId, c.sessionId]);
    expect(new Set(tanks.map((t) => t.side)).size).toBe(3);
    expect(new Set(tanks.map((t) => t.color)).size).toBe(3);
  });

  it('개인전: 마지막 한 명이 남으면 그 사람이 승리', async () => {
    const room = await colyseus.createRoom<FortressRoom>(ROOMS.FORTRESS, { ffa: true, timeScale: 0.01 });
    const a = await colyseus.connectTo(room, { name: 'A' });
    const b = await colyseus.connectTo(room, { name: 'B' });
    const c = await colyseus.connectTo(room, { name: 'C' });
    expect(await a.request('start')).toEqual({ ok: true });
    await until(room, () => room.state.turnPhase === 'aiming');
    await b.leave();
    await room.waitForNextPatch();
    expect(room.state.phase).toBe('playing'); // 아직 두 명
    await c.leave();
    await until(room, () => room.state.phase === 'ended');
    expect(room.state.winner).toBe(room.state.tanks[0].side);
  });

  it('개인전: 나간 사람의 색 자리는 다음 사람이 쓴다', async () => {
    const room = await colyseus.createRoom<FortressRoom>(ROOMS.FORTRESS, { ffa: true });
    await colyseus.connectTo(room);
    const b = await colyseus.connectTo(room);
    await b.leave();
    const c = await colyseus.connectTo(room);
    await room.waitForNextPatch();
    expect(room.state.players.get(c.sessionId)!.slot).toBe(1);
  });
});
