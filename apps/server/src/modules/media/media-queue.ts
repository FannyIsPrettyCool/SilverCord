import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { MediaProcessor } from './media-processor.ts';

export const MEDIA_QUEUE = 'media';
const RECONCILE_MS = 60_000;
const SWEEP_MS = 5 * 60_000;

/** BullMQ blocking connections must not cap retries per request. */
const connect = (url: string) => new Redis(url, { maxRetriesPerRequest: null });

/** Producer side, used by the API on upload completion. */
export function createMediaQueue(valkeyUrl: string, prefix = 'bull') {
  const connection = connect(valkeyUrl);
  const queue = new Queue(MEDIA_QUEUE, { connection, prefix });
  return {
    prefix,
    /** Job id per upload, so duplicate enqueues collapse into one job. */
    async enqueue(uploadId: bigint) {
      await queue.add(
        'process',
        { uploadId: uploadId.toString() },
        {
          jobId: `media-${uploadId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    },
    async close() {
      await queue.close();
      connection.disconnect();
    },
  };
}
export type MediaQueue = ReturnType<typeof createMediaQueue>;

export interface MediaWorkerDependencies {
  readonly valkeyUrl: string;
  readonly processor: MediaProcessor;
  readonly queue: MediaQueue;
  /** Upload ids stuck in `processing` (e.g. lost enqueue after commit). */
  readonly pendingProcessing: () => Promise<{ id: bigint }[]>;
  readonly sweep?: () => Promise<number>;
  readonly log: { warn(object: object, message: string): void };
}

/** Consumer side: one processing job at a time, plus reconciliation and cleanup timers. */
export function startMediaWorker(deps: MediaWorkerDependencies) {
  const connection = connect(deps.valkeyUrl);
  const worker = new Worker<{ uploadId: string }>(
    MEDIA_QUEUE,
    async (job) => deps.processor.process(BigInt(job.data.uploadId)),
    { connection, concurrency: 1, prefix: deps.queue.prefix },
  );
  worker.on('failed', (_job, error) => deps.log.warn({ err: error }, 'media job failed'));
  const reconcile = async () => {
    for (const { id } of await deps.pendingProcessing()) await deps.queue.enqueue(id);
  };
  const report = (message: string) => (error: unknown) => deps.log.warn({ err: error }, message);
  void reconcile().catch(report('media reconcile failed'));
  const reconcileTimer = setInterval(
    () => void reconcile().catch(report('media reconcile failed')),
    RECONCILE_MS,
  );
  const { sweep } = deps;
  const sweepTimer = sweep
    ? setInterval(() => void sweep().catch(report('media sweep failed')), SWEEP_MS)
    : undefined;
  return {
    async close() {
      clearInterval(reconcileTimer);
      clearInterval(sweepTimer);
      await worker.close();
      connection.disconnect();
    },
  };
}
