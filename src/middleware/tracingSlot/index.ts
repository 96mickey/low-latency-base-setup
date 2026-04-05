import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async () => {
    /* OpenTelemetry placeholder — zero overhead */
  });
};

export const tracingSlotPlugin = fp(plugin, {
  fastify: '5.x',
  name: 'tracing-slot-plugin',
});
