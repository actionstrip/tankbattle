import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boot } from '@colyseus/testing';
import type { ColyseusTestServer } from '@colyseus/testing';
import { ROOMS } from '@fortress/shared';
import type { FortressRoom } from '../../src/fortress/FortressRoom';
import { server } from '../../src/app.config';

describe('FortressRoom 대기실', () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => { colyseus = await boot(server, 2580); });
  afterAll(async () => { await colyseus.shutdown(); });
  afterEach(async () => { await colyseus.cleanup(); });

  async function makeRoom(teamSize: 1 | 2 = 1) {
    const room = await colyseus.createRoom<FortressRoom>(ROOMS.FORTRESS, { teamSize, title: '  테스트 방  ' });
    return room;
  }

  it('들어온 순서대로 팀을 나누고 첫 사람이 방장', async () => {
    const room = await makeRoom();
    const a = await colyseus.connectTo(room, { name: '가나다' });
    const b = await colyseus.connectTo(room, { name: '' });
    await room.waitForNextPatch();

    expect(room.state.title).toBe('테스트 방');
    expect(room.state.hostId).toBe(a.sessionId);
    expect(room.state.players.get(a.sessionId)!.team).toBe('blue');
    expect(room.state.players.get(b.sessionId)!.team).toBe('red');
    expect(room.state.players.get(b.sessionId)!.name).toBe('플레이어2');
    expect(room.maxClients).toBe(2);
  });

  it('자리가 없는 팀으로는 못 옮긴다', async () => {
    const room = await makeRoom();
    const a = await colyseus.connectTo(room);
    await colyseus.connectTo(room);
    a.send('setTeam', { team: 'red' });
    await room.waitForNextPatch();
    expect(room.state.players.get(a.sessionId)!.team).toBe('blue');
  });

  it('모두 준비해야 방장이 시작할 수 있다', async () => {
    const room = await makeRoom();
    const host = await colyseus.connectTo(room);
    const guest = await colyseus.connectTo(room);

    expect(await guest.request('start')).toEqual({ ok: false, reason: '방장만 시작할 수 있어요' });
    expect((await host.request('start')).ok).toBe(false);

    guest.send('setReady', { ready: true });
    await room.waitForNextMessage();
    expect(await host.request('start')).toEqual({ ok: true });
    expect(room.state.phase).toBe('playing');
    expect(room.metadata.phase).toBe('playing');
    expect(room.metadata.title).toBe('테스트 방'); // setMetadata가 덮어써도 기존 값 유지
    expect(room.locked).toBe(true);
  });

  it('방장이 나가면 다음 사람이 방장', async () => {
    const room = await makeRoom(2);
    const a = await colyseus.connectTo(room);
    const b = await colyseus.connectTo(room);
    await a.leave();
    await room.waitForNextPatch();
    expect(room.state.players.has(a.sessionId)).toBe(false);
    expect(room.state.hostId).toBe(b.sessionId);
  });

  it('잘못된 메시지를 보내면 연결을 끊는다 (zod 검증)', async () => {
    const room = await makeRoom();
    const a = await colyseus.connectTo(room);
    const left = new Promise<number>((resolve) => a.onLeave((code) => resolve(code)));
    // 타입상으로는 막혀 있는 값을 일부러 보낸다 (조작된 클라이언트 흉내)
    a.send('setTeam', { team: 'green' as 'blue' });
    expect(await left).toBe(4002);
  });
});
