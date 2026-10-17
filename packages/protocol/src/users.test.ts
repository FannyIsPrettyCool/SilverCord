import { describe, expect, it } from 'vitest';
import { loginTotpRequestSchema, passwordSchema, registerRequestSchema } from './auth.ts';
import { displayNameSchema, usernameSchema } from './users.ts';

describe('usernameSchema', () => {
  it.each([
    ['Fanny', 'fanny'],
    ['  ab_c.d ', 'ab_c.d'],
    ['a1', 'a1'],
  ])('normalizes %j', (input, expected) => {
    expect(usernameSchema.parse(input)).toBe(expected);
  });

  it.each(['a', '.ab', 'ab.', 'a..b', 'a b', 'ünï', 'admin', 'Everyone', 'x'.repeat(33)])(
    'rejects %j',
    (input) => {
      expect(usernameSchema.safeParse(input).success).toBe(false);
    },
  );
});

describe('displayNameSchema', () => {
  it('rejects invisible formatting characters', () => {
    expect(displayNameSchema.safeParse('ad‮min').success).toBe(false);
    expect(displayNameSchema.safeParse('Fanny ✨').success).toBe(true);
  });
});

describe('auth schemas', () => {
  it('normalizes passwords to NFKC', () => {
    expect(passwordSchema.parse('ｐａｓｓｗｏｒｄ１２３')).toBe('password123');
  });

  it('requires age confirmation', () => {
    const base = {
      email: 'A@B.example',
      username: 'abc',
      password: 'correct horse',
      locale: 'fr',
      deviceName: 'Desktop',
    };
    expect(registerRequestSchema.safeParse(base).success).toBe(false);
    const parsed = registerRequestSchema.parse({ ...base, ageConfirmed: true });
    expect(parsed.email).toBe('a@b.example');
  });

  it('accepts either a code or a recovery code', () => {
    expect(loginTotpRequestSchema.parse({ ticket: 't', code: '123456' })).toEqual({
      ticket: 't',
      code: '123456',
    });
    expect(loginTotpRequestSchema.parse({ ticket: 't', recoveryCode: 'ABCDE-12345' })).toEqual({
      ticket: 't',
      recoveryCode: 'abcde12345',
    });
    expect(loginTotpRequestSchema.safeParse({ ticket: 't', code: '12345' }).success).toBe(false);
  });
});
