# Deployment (stub)

This document outlines production concerns; it is not an implementation guide.

## Read replicas

The base repository connects to a single PostgreSQL primary via `DB_HOST`. A read-replica connection slot is reserved for future work (see `docs/decisions.md` D-09).

## PgBouncer

Use transaction pooling in front of Postgres. Configure `max_client_conn` and `default_pool_size` per workload. Generate `userlist.txt` from your secrets manager; do not commit real credentials.

## Redis

- **Standalone:** set `REDIS_TOPOLOGY=standalone` and `REDIS_HOST`.
- **Cluster:** set `REDIS_TOPOLOGY=cluster` and `REDIS_CLUSTER_NODES` JSON array.

## Load balancer

Terminate TLS at the edge. Point health checks at `GET /health` on the application port. Keep `GET /metrics` on `METRICS_PORT` off the public internet.

## Environment

Copy `.env.example` to `.env` or inject equivalent variables via your orchestrator. Never log raw `DB_PASSWORD` or `REDIS_PASSWORD`.
