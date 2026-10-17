import { describe, expect, it } from 'vitest';
import { checkHeader } from './check-header.ts';

describe('checkHeader', () => {
  it.each([
    '🎉 repo: initialize pnpm monorepo with turborepo and biome',
    '🗃️ db: add messages table with snowflake ids and channel index',
    '⚡️ ui: cap concurrent refractive elements via frame governor',
    '⚡ ui: accept gitmoji without variation selector',
    '🧑‍💻 repo: add dev scripts',
    '🔖 repo: release v0.4.0 voice and video',
  ])('accepts %s', (header) => {
    expect(checkHeader(header)).toEqual({ ok: true });
  });

  it.each([
    ['feat(repo): conventional style', 'header must match'],
    [':sparkles: repo: shortcode', 'shortcode'],
    ['🚧 repo: work in progress', 'not an allowed gitmoji'],
    ['🦄 repo: unknown emoji', 'not an allowed gitmoji'],
    ['✨ frontend: unknown scope', 'scope "frontend"'],
    ['✨ Repo: uppercase scope', 'header must match'],
    ['✨ repo: Add thing', 'lowercase'],
    ['✨ repo: add thing.', 'period'],
    [`✨ repo: ${'a'.repeat(73)}`, 'longer than 72'],
    ['✨ repo:no space', 'header must match'],
    ['✨✨ repo: two emoji', 'not an allowed gitmoji'],
  ])('rejects %s', (header, reason) => {
    const result = checkHeader(header);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reason);
  });
});
