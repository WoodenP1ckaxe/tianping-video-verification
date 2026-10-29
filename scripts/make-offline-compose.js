import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const target = resolve(process.argv[2] || join(root, 'dist', 'docker-compose.offline.yml'));
const source = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
const offline = source.replace(
  /\n    build:\n      context: \.\n      dockerfile: Dockerfile/,
  '',
);
writeFileSync(target, offline, 'utf8');
console.log(target);

