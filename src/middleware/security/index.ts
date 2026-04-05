import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

import type { Config } from '../../types/index.js';

const plugin: FastifyPluginAsync<{ config: Config }> = async (fastify, opts) => {
  const { config } = opts;
  const origins = config.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

  await fastify.register(helmet);

  await fastify.register(cors, {
    origin(origin, cb) {
      if (!origin) {
        cb(null, false);
        return;
      }
      if (origins.includes(origin)) {
        cb(null, origin);
        return;
      }
      cb(null, false);
    },
  });
};

export const securityPlugin = fp(plugin, {
  fastify: '5.x',
  name: 'security-plugin',
});
