import { pino } from 'pino';
import { loadEnv } from './config/env.ts';
import { closeAppContext, createAppContext } from './context.ts';
import { createMediaProcessor } from './modules/media/media-processor.ts';
import { createMediaQueue, startMediaWorker } from './modules/media/media-queue.ts';
import { createChatServices } from './services.ts';

/** Background worker: media processing, upload reconciliation and cleanup (ADR-0009). */
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const context = await createAppContext(env);
const queue = createMediaQueue(env.VALKEY_URL, env.MEDIA_QUEUE_PREFIX);
const services = createChatServices(context, { log, enqueueMedia: queue.enqueue });
const worker = startMediaWorker({
  valkeyUrl: env.VALKEY_URL,
  queue,
  log,
  processor: createMediaProcessor({
    db: services.db,
    storage: services.storage,
    jobsDir: env.MEDIA_JOBS_DIR,
    decoder: env.MEDIA_DECODER,
    events: context.events,
    log,
  }),
  pendingProcessing: () => services.media.pendingProcessing(),
  sweep: () => services.media.sweep(),
});
log.info({ decoder: env.MEDIA_DECODER }, 'media worker started');

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await worker.close();
  await queue.close();
  await closeAppContext(context);
  process.exit(0);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
