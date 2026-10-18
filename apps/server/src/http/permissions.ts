import { ALL_PERMISSIONS, CHANNEL_SCOPE, has } from '@silvercord/permissions';
import { snowflakeSchema } from '@silvercord/protocol';
import type { FastifyInstance, RouteOptions } from 'fastify';
import { AppError } from './app-error.ts';
import { requireAuth } from './authentication.ts';

export type PermissionRequirement =
  | { readonly scope: 'none'; readonly reason: string }
  | { readonly scope: 'guild' | 'channel'; readonly bits: bigint; readonly param: string };

export type PermissionMetadata =
  | { readonly scope: 'none'; readonly reason: string }
  | { readonly scope: 'guild' | 'channel'; readonly bits: string; readonly param: string };

export interface PermissionAccess {
  readonly visible: boolean;
  readonly permissions: bigint;
}

/** Reads authoritative current state on every request; the route guard never caches it. */
export type PermissionChecker = (input: {
  readonly scope: 'guild' | 'channel';
  readonly resourceId: bigint;
  readonly userId: bigint;
}) => Promise<PermissionAccess>;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Every route must declare its authorization scope, including explicit non-guild routes. */
    permission?: PermissionRequirement;
  }
  interface FastifySchema {
    'x-permission'?: PermissionMetadata;
  }
}

export class InvalidPermissionDeclarationError extends Error {
  readonly code = 'INVALID_PERMISSION_DECLARATION';
}

function validate(route: RouteOptions): PermissionRequirement {
  const requirement = route.config?.permission;
  const invalid = () => {
    throw new InvalidPermissionDeclarationError(
      `${route.method} ${route.url} has a missing or invalid permission declaration`,
    );
  };
  if (!requirement || typeof requirement !== 'object') return invalid();
  if (requirement.scope === 'none') {
    if (typeof requirement.reason !== 'string' || !requirement.reason.trim()) return invalid();
    return Object.freeze({ scope: 'none', reason: requirement.reason });
  }
  if (
    (requirement.scope !== 'guild' && requirement.scope !== 'channel') ||
    route.config?.auth !== 'user' ||
    typeof requirement.bits !== 'bigint' ||
    requirement.bits <= 0n ||
    (requirement.bits & ~ALL_PERMISSIONS) !== 0n ||
    (requirement.scope === 'channel' && (requirement.bits & ~CHANNEL_SCOPE) !== 0n) ||
    typeof requirement.param !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_]*$/.test(requirement.param) ||
    !route.url.split('/').includes(`:${requirement.param}`)
  ) {
    return invalid();
  }
  return Object.freeze({
    scope: requirement.scope,
    bits: requirement.bits,
    param: requirement.param,
  });
}

/** Register before all routes. Authentication runs in onRequest, this check in preHandler. */
export function registerPermissions(app: FastifyInstance, checker?: PermissionChecker): void {
  app.addHook('onRoute', (route) => {
    const requirement = validate(route);
    route.config = { ...route.config, permission: requirement };
    // Decimal strings keep the document JSON-safe and expose no callbacks or internal state.
    route.schema = {
      ...route.schema,
      'x-permission':
        requirement.scope === 'none'
          ? requirement
          : { ...requirement, bits: requirement.bits.toString() },
    };
  });
  app.addHook('preHandler', async (request) => {
    if (request.is404) return;
    const requirement = request.routeOptions.config.permission;
    if (!requirement) throw new AppError('INTERNAL', 'Authorization unavailable');
    if (requirement.scope === 'none') return;
    const { userId } = requireAuth(request);
    const params = request.params as Record<string, unknown>;
    const rawId = params[requirement.param];
    const id = snowflakeSchema.safeParse(rawId);
    if (!id.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid resource id');
    }
    if (!checker) throw new AppError('INTERNAL', 'Authorization unavailable');
    const access = await checker({ scope: requirement.scope, resourceId: BigInt(id.data), userId });
    if (
      typeof access.visible !== 'boolean' ||
      typeof access.permissions !== 'bigint' ||
      access.permissions < 0n ||
      (access.permissions & ~ALL_PERMISSIONS) !== 0n
    ) {
      throw new AppError('INTERNAL', 'Authorization unavailable');
    }
    if (!access.visible) throw new AppError('NOT_FOUND', 'Resource not found');
    if (!has(access.permissions, requirement.bits)) {
      throw new AppError('FORBIDDEN', 'Permission required');
    }
  });
}
