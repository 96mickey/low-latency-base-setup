import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

import { generateUuid } from '../../utils/uuid.js';

const MAX_CORR_LEN = 200;

function sanitizeCorrelationId(raw: string | undefined): string {
  if (raw === undefined || raw.length === 0) {
    return generateUuid();
  }
  if (raw.length > MAX_CORR_LEN) {
    return generateUuid();
  }
  if (!/^[\x20-\x7E]+$/.test(raw)) {
    return generateUuid();
  }
  return raw;
}

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request) => {
    const header = request.headers['x-correlation-id'];
    const fromClient = typeof header === 'string' ? header : undefined;
    request.correlationId = sanitizeCorrelationId(fromClient);
  });

  fastify.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Correlation-Id', request.correlationId);
    return payload;
  });
};

export const correlationIdPlugin = fp(plugin, {
  fastify: '5.x',
  name: 'correlation-id-plugin',
});
