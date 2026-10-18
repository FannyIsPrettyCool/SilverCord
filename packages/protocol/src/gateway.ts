import { z } from 'zod';
import { durableEventSchemas, transientEventSchemas } from './events.ts';
import { currentUserSchema } from './users.ts';

/** Gateway protocol v1 (docs/spec/gateway.md). Numeric values are part of the wire format. */
export const GatewayOp = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 3,
  SUBSCRIBE: 4,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;
export type GatewayOp = (typeof GatewayOp)[keyof typeof GatewayOp];

export const GatewayClose = {
  UNKNOWN_ERROR: 4000,
  UNKNOWN_OPCODE: 4001,
  DECODE_ERROR: 4002,
  NOT_AUTHENTICATED: 4003,
  AUTHENTICATION_FAILED: 4004,
  ALREADY_AUTHENTICATED: 4005,
  RATE_LIMITED: 4008,
  SESSION_TIMED_OUT: 4009,
} as const;
export type GatewayClose = (typeof GatewayClose)[keyof typeof GatewayClose];

export const GATEWAY_PATH = '/gateway/v1';
export const GATEWAY_MAX_INBOUND_BYTES = 16 * 1024;

const clientInfoSchema = z.object({
  name: z.string().max(32),
  version: z.string().max(32),
  os: z.string().max(32),
});

export const identifyPayloadSchema = z.object({
  token: z.string().min(1).max(4096),
  client: clientInfoSchema,
});

export const resumePayloadSchema = z.object({
  token: z.string().min(1).max(4096),
  sessionId: z.string().min(1).max(64),
  seq: z.number().int().nonnegative(),
});

/** Frames a client may send. Anything else is a decode error or an unknown opcode. */
export const clientFrameSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal(GatewayOp.HEARTBEAT),
    d: z.object({ seq: z.number().int().nonnegative().nullable() }),
  }),
  z.object({ op: z.literal(GatewayOp.IDENTIFY), d: identifyPayloadSchema }),
  z.object({ op: z.literal(GatewayOp.RESUME), d: resumePayloadSchema }),
]);
export type ClientFrame = z.infer<typeof clientFrameSchema>;

export const helloPayloadSchema = z.object({ heartbeatIntervalMs: z.number().int().positive() });

export const readyEventSchema = z.object({
  sessionId: z.string(),
  user: currentUserSchema,
  heartbeatIntervalMs: z.number().int().positive(),
});
export const resumedEventSchema = z.object({ replayed: z.number().int().nonnegative() });

/** Dispatch event name → payload schema. Extended phase by phase. */
export const dispatchEventSchemas = {
  READY: readyEventSchema,
  RESUMED: resumedEventSchema,
  USER_UPDATE: currentUserSchema,
  ...durableEventSchemas,
  ...transientEventSchemas,
} as const;
export type DispatchEventName = keyof typeof dispatchEventSchemas;
export type DispatchEventData<T extends DispatchEventName> = z.infer<
  (typeof dispatchEventSchemas)[T]
>;

export type ServerFrame =
  | { op: typeof GatewayOp.HELLO; d: z.infer<typeof helloPayloadSchema> }
  | { op: typeof GatewayOp.HEARTBEAT_ACK; d: Record<string, never> }
  | { op: typeof GatewayOp.RECONNECT; d: Record<string, never> }
  | { op: typeof GatewayOp.INVALID_SESSION; d: { resumable: boolean } }
  | {
      [T in DispatchEventName]: {
        op: typeof GatewayOp.DISPATCH;
        t: T;
        s: number;
        d: DispatchEventData<T>;
      };
    }[DispatchEventName];

const dispatchFrameSchema = z.object({
  op: z.literal(GatewayOp.DISPATCH),
  t: z.string(),
  s: z.number().int().positive(),
  d: z.unknown(),
});

/** Client-side parsing of server frames; dispatch payloads are validated per event name. */
export const serverFrameSchema = z.discriminatedUnion('op', [
  dispatchFrameSchema,
  z.object({ op: z.literal(GatewayOp.HELLO), d: helloPayloadSchema }),
  z.object({ op: z.literal(GatewayOp.HEARTBEAT_ACK), d: z.object({}) }),
  z.object({ op: z.literal(GatewayOp.RECONNECT), d: z.object({}) }),
  z.object({ op: z.literal(GatewayOp.INVALID_SESSION), d: z.object({ resumable: z.boolean() }) }),
]);
