import type { Config } from '../../types/index.js';

import { createClusterClient, type ClusterRedis } from './clusterClient.js';
import { createStandaloneClient, type StandaloneRedis } from './standaloneClient.js';

export type RedisWire = {
  connect: () => Promise<void>;
  healthCheck: () => Promise<'connected' | 'degraded'>;
  teardown: () => Promise<void>;
  pipeline: () => unknown;
  get: (key: string) => Promise<string | null>;
};

function localStub(): RedisWire {
  return {
    async connect() {},
    async healthCheck() {
      return 'connected';
    },
    async teardown() {},
    pipeline() {
      return {
        exec: async () => [],
      };
    },
    async get() {
      return null;
    },
  };
}

export function createRedisConnector(config: Config): RedisWire {
  if (config.REDIS_MODE === 'local') {
    return localStub();
  }

  let impl: StandaloneRedis | ClusterRedis;
  if (config.REDIS_TOPOLOGY === 'cluster') {
    impl = createClusterClient(config);
  } else {
    impl = createStandaloneClient(config);
  }

  return {
    connect: () => impl.connect(),
    healthCheck: () => impl.healthCheck(),
    teardown: () => impl.teardown(),
    pipeline: () => impl.pipeline(),
    get: (key) => impl.get(key),
  };
}
