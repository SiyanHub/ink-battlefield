import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const base = new URL(process.argv[2] || 'https://ink-battlefield.vercel.app/');
const root = resolve(process.argv[3] || 'dist');
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))).flat();
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = await Promise.all((await files(root)).map(async file => {
  const path = relative(root, file).replaceAll('\\', '/');
  const response = await fetch(new URL(path === 'index.html' ? '/' : path, base), {signal: AbortSignal.timeout(30000)});
  const localHash = hash(await readFile(file));
  const remoteHash = hash(Buffer.from(await response.arrayBuffer()));
  return {path, status: response.status, matches: response.ok && localHash === remoteHash, localHash, remoteHash};
}));
console.log(JSON.stringify({url: base.href, checkedAt: new Date().toISOString(), files: checks.length, passed: checks.every(c => c.matches), checks}, null, 2));
if (checks.some(c => !c.matches)) process.exitCode = 1;
