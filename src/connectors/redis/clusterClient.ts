import { Cluster } from 'ioredis';

import type { Config } from '../../types/index.js';

export type ClusterRedis = {
  client: Cluster;
  connect: () => Promise<void>;
  healthCheck: () => Promise<'connected' | 'degraded'>;
  teardown: () => Promise<void>;
  pipeline: () => ReturnType<Cluster['pipeline']>;
  get: (key: string) => Promise<string | null>;
};

export function createClusterClient(config: Config): ClusterRedis {
  const nodes = config.REDIS_CLUSTER_NODES ?? [];
  const client = new Cluster(nodes, {
    redisOptions: {
      password: config.REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
    },
    clusterRetryStrategy(times: number) {
      return Math.min(times * 200, 5000);
    },
  });

  return {
    client,
    async connect() {
      await client.connect();
    },
    async healthCheck() {
      try {
        await client.ping();
        return 'connected';
      } catch {
        return 'degraded';
      }
    },
    async teardown() {
      client.disconnect();
    },
    pipeline() {
      return client.pipeline();
    },
    async get(key: string) {
      return client.get(key);
    },
  };
}
