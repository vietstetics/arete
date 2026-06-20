// Copies the static web app (HTML + js/ + features/ + image assets) into ./www
// so Capacitor can bundle a clean web root into the native shells — without
// dragging in node_modules, .git, native sources, etc.
import { cp, rm, mkdir, readdir } from 'node:fs/promises';

const OUT = 'www';
const COPY_DIRS = new Set(['js', 'features', 'css']);
const ASSET_EXT = /\.(html|css|png|jpe?g|svg|ico|webmanifest)$/i;
const SKIP = new Set(['node_modules', 'www', 'native', 'scripts', '.git', '.vercel', '.claude', 'ios', 'android']);
const SKIP_FILES = new Set(['package.json', 'package-lock.json', 'vercel.json', 'capacitor.config.ts']);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const entries = await readdir('.', { withFileTypes: true });
let count = 0;
for (const e of entries) {
  if (SKIP.has(e.name)) continue;
  if (e.isDirectory()) {
    if (COPY_DIRS.has(e.name)) { await cp(e.name, `${OUT}/${e.name}`, { recursive: true }); count++; }
  } else if (ASSET_EXT.test(e.name) && !SKIP_FILES.has(e.name)) {
    await cp(e.name, `${OUT}/${e.name}`); count++;
  }
}
console.log(`build:web — copied ${count} entries into ./${OUT}`);
