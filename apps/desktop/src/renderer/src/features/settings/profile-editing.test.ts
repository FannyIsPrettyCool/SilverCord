import type { OwnProfile, ProfileImage } from '@silvercord/protocol';
import { DEFAULT_PROFILE_PRIVACY } from '@silvercord/protocol';
import { describe, expect, it } from 'vitest';
import { avatarPath } from '../presence/Avatar.tsx';
import { expiryFor } from '../profiles/CustomStatusDialog.tsx';
import { clampView, cropOf } from './CropDialog.tsx';
import { patchOf } from './ProfileSettings.tsx';

const natural = { width: 1000, height: 500 };
const square = { width: 360, height: 360 };

describe('crop geometry', () => {
  it('keeps the image covering the frame', () => {
    expect(clampView({ zoom: 1, x: 50, y: -400 }, natural, square)).toEqual({
      zoom: 1,
      x: 0,
      y: 0,
    });
    // Base scale is 0.72, so the 720px-wide image can move left by at most 360px.
    expect(clampView({ zoom: 1, x: -900, y: 0 }, natural, square).x).toBe(-360);
    expect(clampView({ zoom: 9, x: 0, y: 0 }, natural, square).zoom).toBe(4);
  });

  it('maps the visible frame to source pixels', () => {
    expect(cropOf({ zoom: 1, x: -180, y: 0 }, natural, square)).toEqual({
      x: 250,
      y: 0,
      width: 500,
      height: 500,
    });
    expect(cropOf({ zoom: 2, x: 0, y: 0 }, natural, square)).toEqual({
      x: 0,
      y: 0,
      width: 250,
      height: 250,
    });
  });
});

describe('custom status expiry', () => {
  const now = new Date('2026-10-18T10:00:00.000Z');
  it('adds durations and ends today at local midnight', () => {
    expect(expiryFor('30m', now)).toBe('2026-10-18T10:30:00.000Z');
    expect(expiryFor('never', now)).toBeNull();
    const today = new Date(expiryFor('today', now) ?? '');
    expect(today.getDate()).toBe(new Date(now).getDate());
    expect(today.getHours()).toBe(23);
  });
});

const image = (animated: boolean): ProfileImage => ({
  uploadId: '1',
  display: '/media/1/display/a',
  thumbnail: '/media/1/thumbnail/a',
  still: animated ? '/media/1/still/a' : null,
  animated,
  width: 512,
  height: 512,
  dominantColor: null,
});

describe('avatar variants', () => {
  it('rests animated avatars on their still frame and sizes by the box', () => {
    expect(avatarPath(image(true), 40, false)).toBe('/media/1/still/a');
    expect(avatarPath(image(true), 40, true)).toBe('/media/1/thumbnail/a');
    expect(avatarPath(image(false), 200, false)).toBe('/media/1/display/a');
  });
});

const profile: OwnProfile = {
  userId: '1',
  username: 'aurora',
  displayName: 'Aurora',
  bio: null,
  pronouns: 'she/her',
  accentColor: null,
  bannerColor: null,
  themeColors: null,
  avatar: null,
  banner: null,
  customStatus: null,
  privacy: DEFAULT_PROFILE_PRIVACY,
  version: 4,
  memberSince: '2026-01-01T00:00:00.000Z',
};
const draft = {
  displayName: 'Aurora',
  pronouns: 'she/her',
  bio: '',
  accentColor: null,
  bannerColor: null,
  themeColors: null,
  avatar: undefined,
  banner: undefined,
} as const;

describe('profile patch', () => {
  it('sends nothing when unchanged and only changed fields otherwise', () => {
    expect(patchOf(profile, draft)).toBeNull();
    expect(patchOf(profile, { ...draft, pronouns: '  ', bio: ' hi ' })).toEqual({
      version: 4,
      pronouns: null,
      bio: 'hi',
    });
    expect(patchOf(profile, { ...draft, avatar: { id: null, image: null } })).toEqual({
      version: 4,
      avatarUploadId: null,
    });
  });
});
