// Minimal scan-job queue abstraction. The interface is what the worker depends
// on; the in-memory implementation is for local dev and tests. In production
// this is backed by Redis/BullMQ (REDIS_URL) so long scans survive restarts and
// scale across worker instances.

import type { VulnClass } from "@kelp/core";

export interface ScanJob {
  id: string;
  orgId: string;
  projectId: string;
  repoFullName: string | null;
  supabaseRef: string | null;
  classes: VulnClass[];
  trigger: "initial" | "manual" | "webhook_push" | "scheduled";
}

export interface ScanQueue {
  enqueue(job: ScanJob): Promise<void>;
  /** pull the next job, or null if the queue is empty. */
  dequeue(): Promise<ScanJob | null>;
  size(): number;
}

export class InMemoryQueue implements ScanQueue {
  private jobs: ScanJob[] = [];
  async enqueue(job: ScanJob): Promise<void> {
    this.jobs.push(job);
  }
  async dequeue(): Promise<ScanJob | null> {
    return this.jobs.shift() ?? null;
  }
  size(): number {
    return this.jobs.length;
  }
}
