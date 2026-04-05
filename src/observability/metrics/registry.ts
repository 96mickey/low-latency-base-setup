/**
 * Shared Prometheus registry: default process metrics + app metrics registered in `definitions.ts`.
 */

import { Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({ register: registry });
