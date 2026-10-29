import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const image = process.env.IMAGE_TAG || 'tianping-system:1.0.0';
const dist = resolve(process.env.DIST_DIR || join(root, 'dist'));
mkdirSync(dist, { recursive: true });

function run(command, args) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run('docker', ['compose', 'build']);
run('docker', ['image', 'inspect', image]);
const archive = join(dist, `tianping-system-${image.split(':').at(-1)}.tar`);
run('docker', ['save', '--output', archive, image]);
const composeTarget = join(dist, 'docker-compose.offline.yml');
run('node', ['scripts/make-offline-compose.js', composeTarget]);
if (!existsSync(archive)) throw new Error('离线镜像归档未生成');
console.log(`离线包已生成：${archive}`);
console.log(`离线编排文件：${composeTarget}`);

