import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

if (typeof packageJson.version !== 'string' || !packageJson.version) {
  throw new Error('package.json 缺少有效版本号');
}

export const APP_VERSION = packageJson.version;
