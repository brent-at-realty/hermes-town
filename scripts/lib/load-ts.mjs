// Bundle a few pure TypeScript modules (no Phaser, no DOM) into a node module with esbuild, so a browser verification
// script can read the same constants the production code uses instead of copying them.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

export async function loadTs(entry, root) {
  const result = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = path.join(process.env.TMPDIR ?? '/tmp', `hermes-town-ts-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(file, result.outputFiles[0].text);
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
}
