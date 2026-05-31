import { access, cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WEB_DIR = join(REPO_ROOT, 'web');
const OUT_DIR = join(REPO_ROOT, 'dist', 'menu-cache');

async function main() {
  try {
    await access(WEB_DIR);
  } catch {
    console.log('No web directory found; skipping static site.');
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  await cp(WEB_DIR, OUT_DIR, {
    recursive: true,
    force: true,
    errorOnExist: false
  });

  console.log(`Copied static site to ${OUT_DIR}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
