import { describe, expect, it } from 'vitest';
import {
  relationshipListQuerySchema,
  relationshipMetadataSchema,
  relationshipRequestSchema,
  socialPrivacyPatchSchema,
} from './relationships.ts';
import { publicUserSchema } from './users.ts';

describe('relationship boundary contracts', () => {
  it('keeps public cards limited to public identity', () => {
    const card = { id: '1', username: 'aurora', displayName: 'Aurora' };
    expect(publicUserSchema.parse(card)).toEqual(card);
    expect(publicUserSchema.safeParse({ ...card, email: 'private@example.test' }).success).toBe(
      false,
    );
    expect(publicUserSchema.safeParse({ ...card, isInstanceAdmin: true }).success).toBe(false);
  });
  it('normalizes exact usernames and rejects unknown request fields', () => {
    expect(relationshipRequestSchema.parse({ username: ' AURORA ' })).toEqual({
      username: 'aurora',
    });
    expect(relationshipRequestSchema.safeParse({ username: 'aurora', ownerId: '2' }).success).toBe(
      false,
    );
    expect(relationshipRequestSchema.safeParse({ username: 'a*' }).success).toBe(false);
  });
  it('bounds pagination with exclusive, mutually exclusive cursors', () => {
    expect(relationshipListQuerySchema.parse({ kind: 'friends' }).limit).toBe(50);
    for (const input of [
      { kind: 'friends', before: '3', after: '1' },
      { kind: 'blocked', limit: 101 },
      { kind: 'friends', prefix: 'a' },
    ])
      expect(relationshipListQuerySchema.safeParse(input).success).toBe(false);
  });
  it('bounds private annotations and permits explicit clearing', () => {
    expect(relationshipMetadataSchema.parse({ nickname: ' Aurora ', note: '' })).toEqual({
      nickname: 'Aurora',
      note: '',
    });
    expect(relationshipMetadataSchema.parse({ nickname: null, note: null })).toEqual({
      nickname: null,
      note: null,
    });
    for (const input of [
      { nickname: '', note: null },
      { nickname: 'a'.repeat(33), note: null },
      { nickname: null, note: 'a'.repeat(1001) },
      { nickname: null, note: '\0' },
      { nickname: null, note: null, targetId: '3' },
    ])
      expect(relationshipMetadataSchema.safeParse(input).success).toBe(false);
  });
  it('requires an explicit privacy change and rejects future policy names', () => {
    expect(socialPrivacyPatchSchema.safeParse({}).success).toBe(false);
    expect(socialPrivacyPatchSchema.parse({ friendRequests: 'nobody' })).toEqual({
      friendRequests: 'nobody',
    });
    expect(socialPrivacyPatchSchema.safeParse({ directMessages: 'everyone' }).success).toBe(false);
    expect(
      socialPrivacyPatchSchema.safeParse({ friendRequests: 'nobody', userId: '2' }).success,
    ).toBe(false);
  });
});
