// 여러 프로세스로 돌 때 방 정보를 공유하는 저장소(presence/driver) 설정.
//
// @colyseus/tools 의 listen()은 "옵션 객체"를 넘길 때만 Colyseus Cloud용 Redis를 자동으로 붙인다.
// 우리는 defineServer()로 만든 서버를 넘기므로, 같은 규칙을 여기서 직접 적용한다.
// (tools/build/index.mjs 의 getColyseusCloudConfig 와 같은 조건)
//
// - 로컬(내 PC, 프로세스 1개): 아무것도 안 함 → 메모리 기본값
// - Colyseus Cloud: CPU가 여러 개거나 REDIS_URI 가 있으면 Redis 사용
// - 직접 운영하며 프로세스를 늘릴 때: REDIS_URI 만 지정하면 Redis 사용
import os from 'node:os';
import type { ServerOptions } from 'colyseus';

export async function scalingOptions(): Promise<Pick<ServerOptions, 'presence' | 'driver' | 'publicAddress'>> {
  const cloud = process.env.COLYSEUS_CLOUD !== undefined;
  const redisUri = process.env.REDIS_URI;
  const useRedis = redisUri !== undefined || (cloud && os.cpus().length > 1);
  if (!useRedis) return {};

  const [{ RedisPresence }, { RedisDriver }] = await Promise.all([
    import('@colyseus/redis-presence'),
    import('@colyseus/redis-driver'),
  ]);
  // Cloud는 프로세스마다 주소가 다르다 (클라이언트가 방이 있는 프로세스로 바로 붙도록).
  // Cloud에서 listen()은 포트를 2567 + 프로세스 번호로 정한다.
  const cloudPort = 2567 + Number(process.env.NODE_APP_INSTANCE || 0);
  return {
    presence: new RedisPresence(redisUri),
    driver: new RedisDriver(redisUri),
    publicAddress: cloud ? `${process.env.SUBDOMAIN}.${process.env.SERVER_NAME}/${cloudPort}` : undefined,
  };
}
