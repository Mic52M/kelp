// Redis-backed scan delivery (issue #7), via BullMQ.
//
// Design: the `scans` DB row stays the single source of truth for status and
// results. Redis is only the delivery/back-pressure layer — a job carries just a
// `{ scanId }`, and the consumer re-reads the row and claims it atomically
// (claimScanById), so a duplicate or replayed delivery can never double-run a
// scan. If REDIS_URL is unset (local dev), every function here degrades to a
// no-op and the DB poll loop / Next after() path drives scans instead.
//
// We never import ioredis directly: BullMQ bundles its own copy, so we hand it
// plain connection options (parsed from REDIS_URL) and let it construct the
// client. This avoids a dual-ioredis type/version clash.

import type { Queue as QueueType, Worker as WorkerType, RedisOptions } from "bullmq";

const QUEUE_NAME = "kelp-scans";

// Lazily-constructed singleton so merely importing @kelp/worker never opens a
// Redis connection (the web app imports this module for enqueue only).
let queue: QueueType | null = null;

function redisUrl(): string | null {
  return process.env.REDIS_URL || null;
}

/** Parse REDIS_URL into BullMQ connection options. `maxRetriesPerRequest: null`
 *  is required by BullMQ's blocking commands. `rediss://` enables TLS. */
function connectionOptions(): RedisOptions | null {
  const url = redisUrl();
  if (!url) return null;
  const u = new URL(url);
  const opts: RedisOptions = {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    maxRetriesPerRequest: null,
  };
  if (u.username) opts.username = decodeURIComponent(u.username);
  if (u.password) opts.password = decodeURIComponent(u.password);
  if (u.protocol === "rediss:") opts.tls = {};
  return opts;
}

async function getQueue(): Promise<QueueType | null> {
  const connection = connectionOptions();
  if (!connection) return null;
  if (!queue) {
    const { Queue } = await import("bullmq");
    queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return queue;
}

/**
 * Push a scan job. Returns true if delivered to Redis, false if Redis isn't
 * configured (caller then relies on the DB poll path). `jobId = scanId` makes
 * delivery idempotent — re-enqueuing the same scan de-dupes.
 */
export async function enqueueScanJob(scanId: string): Promise<boolean> {
  const q = await getQueue();
  if (!q) return false;
  await q.add("scan", { scanId }, { jobId: scanId });
  return true;
}

/**
 * Start the BullMQ consumer. Returns the Worker (for graceful shutdown) or null
 * if Redis isn't configured. Each job claims its scan row and executes it.
 */
export async function startScanWorker(): Promise<WorkerType | null> {
  const connection = connectionOptions();
  if (!connection) return null;
  const { Worker } = await import("bullmq");
  const concurrency = Number(process.env.SCAN_CONCURRENCY ?? "2");
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { processScanById } = await import("./scan-processor.js");
      await processScanById((job.data as { scanId: string }).scanId);
    },
    { connection, concurrency },
  );
  worker.on("failed", (job, err) =>
    console.error(`scan job ${job?.id ?? "?"} failed:`, err?.message),
  );
  return worker;
}

/** Close Redis resources for a clean shutdown. */
export async function closeScanQueue(): Promise<void> {
  if (queue) await queue.close();
  queue = null;
}

export function redisEnabled(): boolean {
  return redisUrl() !== null;
}
