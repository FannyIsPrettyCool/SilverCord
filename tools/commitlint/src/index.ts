import { checkHeader } from './check-header.ts';

export { checkHeader } from './check-header.ts';
export { GITMOJI, SCOPES } from './gitmoji.ts';

type RuleOutcome = [boolean, string?];

/** commitlint plugin exposing the `silvercord-header` rule. */
export const gitmojiPlugin = {
  rules: {
    'silvercord-header': (parsed: { header?: string | null }): RuleOutcome => {
      const result = checkHeader(parsed.header ?? '');
      return result.ok ? [true] : [false, result.reason];
    },
  },
};
