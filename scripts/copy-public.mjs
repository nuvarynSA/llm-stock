// Copies the static web UI into the compiled output so `node dist/demo/server.js`
// can serve it from `dist/demo/public` (where __dirname resolves at runtime).
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/demo', { recursive: true });
cpSync('src/demo/public', 'dist/demo/public', { recursive: true });
console.log('[copy-public] src/demo/public -> dist/demo/public');
