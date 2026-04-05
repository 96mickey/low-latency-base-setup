/**
 * Reserved hook point for distributed tracing (e.g. OpenTelemetry). Intentionally empty for now.
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async () => {
    /* OTel hook goes here */
  });
};

export const tracingSlotPlugin = fp(plugin, {
  fastify: '5.x',
  name: 'tracing-slot-plugin',
});
