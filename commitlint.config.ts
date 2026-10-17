import { gitmojiPlugin } from '@silvercord/commitlint';

export default {
  plugins: [gitmojiPlugin],
  rules: {
    'silvercord-header': [2, 'always'],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
    'body-max-line-length': [1, 'always', 80],
  },
};
