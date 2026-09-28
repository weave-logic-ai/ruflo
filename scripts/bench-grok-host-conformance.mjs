#!/usr/bin/env node
/** Grok host conformance. The bench itself is scripts/bench-host-conformance.mjs. */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extra = process.argv.slice(2);
if (!extra.includes('--host')) extra.unshift('--host', 'grok');
if (!extra.includes('--report-name')) extra.unshift('--report-name', 'grok-host-conformance');
const r = spawnSync(process.execPath, [join(here, 'bench-host-conformance.mjs'), ...extra], {
  stdio: 'inherit',
});
process.exit(r.status == null ? 1 : r.status);
