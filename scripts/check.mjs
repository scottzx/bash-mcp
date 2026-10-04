import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
for (const dir of ['src', 'bin', 'scripts']) {
  for (const file of await readdir(new URL(`../${dir}/`, import.meta.url))) {
    if (!file.endsWith('.mjs')) continue;
    const result = spawnSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
