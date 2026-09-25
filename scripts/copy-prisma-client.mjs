import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/generated', import.meta.url));
const dest = fileURLToPath(new URL('../dist/generated', import.meta.url));

if (!existsSync(src)) {
  throw new Error(`Prisma client not found at ${src} — run "prisma generate" first`);
}

cpSync(src, dest, { recursive: true });
