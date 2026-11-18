// Copies the exact rule + verifier code into the public page folder, so the page runs the
// same arithmetic the engine does. Run before deploying: npm run build:public
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('public/lib', { recursive: true });
for (const f of ['rule.mjs', 'verify.mjs']) copyFileSync(`src/${f}`, `public/lib/${f}`);
console.log('public/lib is in sync with src/');
