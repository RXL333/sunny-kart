import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [owner, repository] = (process.env.GITHUB_REPOSITORY || '').split('/');
const defaultBase = repository && repository.toLowerCase() !== `${owner}.github.io`.toLowerCase()
  ? `/${repository}/`
  : '/';
const base = process.env.VITE_BASE_PATH?.trim() || defaultBase;
if (!base.startsWith('/') || !base.endsWith('/') || base.includes('..') || base.includes('\\') || base.includes('//')) {
  throw new Error('VITE_BASE_PATH must be an absolute URL path ending in /, for example /sunny-kart/.');
}
const serverURL = process.env.VITE_SERVER_URL?.trim() || '';
if (serverURL) {
  const url = new URL(serverURL);
  if (!['https:', 'wss:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('VITE_SERVER_URL for GitHub Pages must be a public HTTPS or WSS endpoint without credentials.');
  }
}

console.log(`Building GitHub Pages at ${base}`);
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), 'build'], {
  cwd: root,
  env: { ...process.env, VITE_BASE_PATH: base, VITE_SERVER_URL: serverURL },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
await writeFile(new URL('../dist/.nojekyll', import.meta.url), '');
