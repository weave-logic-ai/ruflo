/**
 * Grok Build host init (ADR-320).
 *
 * Mirrors `init --codex`: writes project-scoped `.grok/` surface + team bus scripts
 * so any repo can run Ruflo Agent Teams under Grok without Claude SendMessage.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface GrokInitOptions {
  targetDir: string;
  force?: boolean;
  /** Also write docs/grok/README.md operator guide */
  docs?: boolean;
}

export interface GrokInitResult {
  success: boolean;
  filesCreated: string[];
  filesSkipped: string[];
  errors: string[];
}

function packageRoot(): string {
  // dist/src/init/grok-generator.js → package root is ../../..
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Prefer built layout: dist/src/init → ../../../
  // Source/tsx layout: src/init → ../../
  const candidates = [
    path.resolve(here, '../../..'), // dist/src/init → package root
    path.resolve(here, '../..'), // src/init → package root
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'templates', 'grok', 'config.toml'))) {
      return c;
    }
  }
  return candidates[0];
}

function templatesRoot(): string {
  return path.join(packageRoot(), 'templates', 'grok');
}

function copyFile(
  src: string,
  dest: string,
  force: boolean,
  created: string[],
  skipped: string[],
  errors: string[],
): void {
  try {
    if (fs.existsSync(dest) && !force) {
      skipped.push(dest);
      return;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    // Preserve executable bit for .mjs scripts when source is executable
    try {
      const mode = fs.statSync(src).mode;
      fs.chmodSync(dest, mode);
    } catch {
      /* ignore */
    }
    created.push(dest);
  } catch (e) {
    errors.push(`${dest}: ${(e as Error).message}`);
  }
}

function walkCopy(
  srcDir: string,
  destDir: string,
  force: boolean,
  created: string[],
  skipped: string[],
  errors: string[],
  filter?: (rel: string) => boolean,
): void {
  if (!fs.existsSync(srcDir)) {
    errors.push(`Template directory missing: ${srcDir}`);
    return;
  }
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const ent of entries) {
    const src = path.join(srcDir, ent.name);
    const dest = path.join(destDir, ent.name);
    const rel = path.relative(templatesRoot(), src);
    if (filter && !filter(rel)) continue;
    if (ent.isDirectory()) {
      walkCopy(src, dest, force, created, skipped, errors, filter);
    } else {
      copyFile(src, dest, force, created, skipped, errors);
    }
  }
}

/**
 * Expand {{HOME}} / $HOME path placeholders in template config so Brain MCP
 * paths are machine-ready. Does not enable Brain — only rewrites placeholders.
 * Uses {{HOME}} preferentially so prose comments mentioning $HOME stay intact.
 */
function materializeGrokConfig(dest: string): void {
  if (!fs.existsSync(dest)) return;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return;
  let text = fs.readFileSync(dest, 'utf-8');
  const before = text;
  // Path-prefix only so prose like "expands {{HOME}} placeholders" stays intact
  text = text.replaceAll('{{HOME}}/', `${home}/`);
  // Path-quoted $HOME only (e.g. "$HOME/.cache/…")
  text = text.replace(/(["'])\$HOME\//g, `$1${home}/`);
  if (text !== before) {
    fs.writeFileSync(dest, text, 'utf-8');
  }
}

/**
 * Initialize Grok host surface in targetDir.
 */
export function executeGrokInit(options: GrokInitOptions): GrokInitResult {
  const { targetDir, force = false, docs = true } = options;
  const filesCreated: string[] = [];
  const filesSkipped: string[] = [];
  const errors: string[] = [];
  const tpl = templatesRoot();

  if (!fs.existsSync(path.join(tpl, 'config.toml'))) {
    return {
      success: false,
      filesCreated,
      filesSkipped,
      errors: [
        `Grok templates not found at ${tpl}. Reinstall @claude-flow/cli or run from a monorepo checkout that includes templates/grok.`,
      ],
    };
  }

  // .grok/config.toml
  const configDest = path.join(targetDir, '.grok', 'config.toml');
  copyFile(
    path.join(tpl, 'config.toml'),
    configDest,
    force,
    filesCreated,
    filesSkipped,
    errors,
  );
  if (filesCreated.includes(configDest) || (force && fs.existsSync(configDest))) {
    try {
      materializeGrokConfig(configDest);
    } catch (e) {
      errors.push(`${configDest}: materialize failed: ${(e as Error).message}`);
    }
  }

  // .grok/rules, agents, hooks, skills
  walkCopy(
    path.join(tpl, 'rules'),
    path.join(targetDir, '.grok', 'rules'),
    force,
    filesCreated,
    filesSkipped,
    errors,
  );
  walkCopy(
    path.join(tpl, 'agents'),
    path.join(targetDir, '.grok', 'agents'),
    force,
    filesCreated,
    filesSkipped,
    errors,
  );
  walkCopy(
    path.join(tpl, 'hooks'),
    path.join(targetDir, '.grok', 'hooks'),
    force,
    filesCreated,
    filesSkipped,
    errors,
  );
  walkCopy(
    path.join(tpl, 'skills'),
    path.join(targetDir, '.grok', 'skills'),
    force,
    filesCreated,
    filesSkipped,
    errors,
  );

  // scripts/ team bus (project-local MVP + SubagentStop adapter)
  walkCopy(
    path.join(tpl, 'scripts'),
    path.join(targetDir, 'scripts'),
    force,
    filesCreated,
    filesSkipped,
    errors,
  );

  if (docs) {
    walkCopy(
      path.join(tpl, 'docs'),
      path.join(targetDir, 'docs', 'grok'),
      force,
      filesCreated,
      filesSkipped,
      errors,
    );
  }

  return {
    success: errors.length === 0,
    filesCreated,
    filesSkipped,
    errors,
  };
}
