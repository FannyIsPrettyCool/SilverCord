import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { BRAND } from '../../packages/protocol/src/brand.ts';
import { aurora } from '../../packages/ui/src/themes/aurora.ts';
import { themeToCssVariables } from '../../packages/ui/src/tokens/css-variables.ts';

const root = import.meta.dirname;
const out = join(root, 'dist');
const uiRequire = createRequire(new URL('../../packages/ui/package.json', import.meta.url));
const font = uiRequire.resolve(
  '@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2',
);
const desktop = JSON.parse(await readFile(join(root, '../desktop/package.json'), 'utf8')) as {
  version: string;
};
if (!/^\d+\.\d+\.\d+$/.test(desktop.version)) throw new Error('Invalid desktop release');
const file = `${BRAND.name}-${desktop.version}-windows-x64.exe`;
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
await mkdir(join(out, 'assets'), { recursive: true });
await mkdir(join(out, 'fr'), { recursive: true });
const tokens = Object.entries(themeToCssVariables(aurora))
  .map(([name, value]) => `${name}:${value}`)
  .join(';');
const css = `:root{${tokens}}\n${await readFile(join(root, 'src/style.css'), 'utf8')}`;
const stylesheet = `style-${createHash('sha256').update(css).digest('hex').slice(0, 12)}.css`;
await writeFile(join(out, 'assets', stylesheet), css);
await cp(font, join(out, 'assets/figtree.woff2'));
await cp(join(dirname(font), '../LICENSE'), join(out, 'assets/figtree-LICENSE.txt'));
await cp(join(root, '../desktop/resources/icon.svg'), join(out, 'assets/icon.svg'));
const template = await readFile(join(root, 'src/index.html'), 'utf8');
for (const language of ['en', 'fr'] as const) {
  const copy = JSON.parse(await readFile(join(root, `src/${language}.json`), 'utf8')) as Record<
    string,
    string
  >;
  const values = {
    ...copy,
    language,
    brand: BRAND.name,
    version: desktop.version,
    stylesheet,
    download: `/downloads/${file}`,
  };
  const html = template
    .replace('<html lang="en">', `<html lang="${language}">`)
    .replace(/\{\{([a-zA-Z]+)\}\}/g, (_match, key: string) => {
      const value = values[key as keyof typeof values];
      if (value === undefined) throw new Error(`Missing ${language} translation: ${key}`);
      return escapeHtml(value);
    });
  await writeFile(join(out, language === 'en' ? 'index.html' : 'fr/index.html'), html);
}
await writeFile(
  join(out, 'release.json'),
  `${JSON.stringify({ version: desktop.version, file })}\n`,
);
