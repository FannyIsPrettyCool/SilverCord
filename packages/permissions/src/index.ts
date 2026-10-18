/**
 * Pure permission engine (bigint bitfield), docs/spec/permissions.md. Dependency-free: the
 * server uses it authoritatively, the client for UI hints.
 */
export * from './bits.ts';
export * from './compute.ts';
export * from './hierarchy.ts';
