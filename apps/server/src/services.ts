import type { AppContext } from './context.ts';
import { createEventOutbox } from './events/outbox.ts';
import { createChannelsService } from './modules/channels/channels-service.ts';
import { createMediaService } from './modules/media/media-service.ts';
import { createLocalStorage } from './modules/media/storage.ts';
import { createMessagesService } from './modules/messages/messages-service.ts';
import { createPresenceLeases } from './modules/presence/presence-leases.ts';
import { createPresenceService } from './modules/presence/presence-service.ts';
import { createTypingService } from './modules/presence/typing-service.ts';
import { createRelationshipsService } from './modules/relationships/relationships-service.ts';
import { createUsersService } from './modules/users/users-service.ts';

export interface ServiceOptions {
  readonly log: { warn(object: object, message: string): void };
  /** Queues media processing; the API passes its BullMQ producer. */
  readonly enqueueMedia: (uploadId: bigint) => Promise<void>;
}

/** The chat domain graph, shared by the API process and the background worker. */
export function createChatServices(context: AppContext, options: ServiceOptions) {
  const { env, nextId, events, valkey } = context;
  const db = context.database.db;
  const users = createUsersService();
  const outbox = createEventOutbox(nextId);
  const relationships = createRelationshipsService({ users, nextId, outbox });
  const channels = createChannelsService({
    users,
    relationships,
    outbox,
    nextId,
    groupMaxMembers: env.GROUP_DM_MAX_MEMBERS,
    // Resolved at call time: media is built below and depends on channels.
    onDelete: (tx, channelId) => media.channelDeleted(tx, channelId),
  });
  const storage = createLocalStorage(env.MEDIA_STORAGE_DIR);
  const media = createMediaService({
    db,
    storage,
    channels,
    relationships,
    nextId,
    enqueue: options.enqueueMedia,
    limits: {
      maxFileBytes: env.MEDIA_MAX_FILE_BYTES,
      userQuotaBytes: env.MEDIA_USER_QUOTA_BYTES,
      instanceQuotaBytes: env.MEDIA_INSTANCE_QUOTA_BYTES,
      concurrentUploads: env.MEDIA_CONCURRENT_UPLOADS,
      uploadTtlSeconds: env.MEDIA_UPLOAD_TTL_SECONDS,
    },
  });
  const messages = createMessagesService({
    users,
    relationships,
    channels,
    outbox,
    media: media.media,
    nextId,
  });
  const presence = createPresenceService({
    db,
    leases: createPresenceLeases(valkey),
    relationships,
    events,
    log: options.log,
    timings: context.presence,
  });
  const typing = createTypingService({
    db,
    valkey,
    channels,
    relationships,
    events,
    log: options.log,
  });
  return { db, users, outbox, relationships, channels, storage, media, messages, presence, typing };
}
export type ChatServices = ReturnType<typeof createChatServices>;
