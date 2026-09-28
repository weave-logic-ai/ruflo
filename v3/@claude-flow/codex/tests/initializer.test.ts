import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexInitializer, mergeTeamStopHook, teamStopHookCommand } from '../src/initializer.js';
import { BUILT_IN_SKILL_NAMES } from '../src/generators/skill-md.js';

let projectPath: string;
let originalPath: string | undefined;

beforeEach(() => {
  projectPath = mkdtempSync(join(tmpdir(), 'codex-full-init-2634-'));
  originalPath = process.env.PATH;
  // Prevent tests from registering MCP servers or plugins in user config.
  process.env.PATH = '';
});

afterEach(() => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  rmSync(projectPath, { recursive: true, force: true });
});

describe('Codex full template canonical skills (#2634)', () => {
  it('omits catalog-only capabilities instead of generating placeholder skills', async () => {
    const result = await new CodexInitializer().initialize({
      projectPath,
      template: 'full',
    });

    expect(result.success).toBe(true);
    expect(result.skillsGenerated.sort()).toEqual([...BUILT_IN_SKILL_NAMES].sort());
    expect(result.warnings).toContain(
      'Omitted 103 catalog skills without canonical packaged assets. ' +
      'Install additional capabilities from the Ruflo plugin catalog.',
    );

    const installed = readdirSync(join(projectPath, '.agents', 'skills')).sort();
    expect(installed).toEqual([...BUILT_IN_SKILL_NAMES].sort());

    for (const skillName of installed) {
      const content = readFileSync(
        join(projectPath, '.agents', 'skills', skillName, 'SKILL.md'),
        'utf8',
      );
      expect(content).not.toContain('Custom skill:');
      expect(content).not.toContain('Define when to trigger this skill');
    }

    const config = readFileSync(join(projectPath, '.agents', 'config.toml'), 'utf8');
    expect(config).not.toContain('.agents/skills/agentdb-advanced');
  });

  it('preserves explicitly requested custom-skill scaffolding', async () => {
    const result = await new CodexInitializer().initialize({
      projectPath,
      template: 'full',
      skills: ['my-project-skill'],
    });

    expect(result.success).toBe(true);
    expect(result.skillsGenerated).toContain('my-project-skill');
    const content = readFileSync(
      join(projectPath, '.agents', 'skills', 'my-project-skill', 'SKILL.md'),
      'utf8',
    );
    expect(content).toContain('Custom skill: my-project-skill');
  });

  it('adds Codex ignores without duplicating shared Claude init entries', async () => {
    const gitignorePath = join(projectPath, '.gitignore');
    writeFileSync(
      gitignorePath,
      '# Ruflo local secrets and runtime data\n.env\n.claude-flow/data/\n',
      'utf8',
    );

    const result = await new CodexInitializer().initialize({
      projectPath,
      template: 'minimal',
    });

    expect(result.success).toBe(true);
    const gitignore = readFileSync(gitignorePath, 'utf8');
    expect(gitignore.match(/^\.env$/gm)).toHaveLength(1);
    expect(gitignore.match(/^\.claude-flow\/data\/$/gm)).toHaveLength(1);
    expect(gitignore).toContain('.codex/');
  });
});

describe('Agent Teams stop hook (opt-in)', () => {
  const hooksFile = () => join(projectPath, '.codex', 'hooks.json');
  const readHooks = () => JSON.parse(readFileSync(hooksFile(), 'utf-8'));

  it('mergeTeamStopHook creates .codex/hooks.json in an empty project', async () => {
    const r = await mergeTeamStopHook(projectPath, 'linux');
    expect(r.added).toBe(true);
    expect(readHooks()).toEqual({
      hooks: {
        SubagentStop: [
          { hooks: [{ type: 'command', command: 'npx -y ruflo@latest team hook-stop --host codex', timeout: 30 }] },
        ],
      },
    });
  });

  it('keeps existing events and entries, and appends after them', async () => {
    mkdirSync(join(projectPath, '.codex'), { recursive: true });
    const existing = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }],
        SubagentStop: [{ hooks: [{ type: 'command', command: 'echo other' }] }],
      },
      extra: true,
    };
    writeFileSync(hooksFile(), JSON.stringify(existing));
    await mergeTeamStopHook(projectPath, 'linux');
    const doc = readHooks();
    expect(doc.extra).toBe(true);
    expect(doc.hooks.PreToolUse).toEqual(existing.hooks.PreToolUse);
    expect(doc.hooks.SubagentStop[0]).toEqual(existing.hooks.SubagentStop[0]);
    expect(doc.hooks.SubagentStop[1].hooks[0].command).toContain('team hook-stop');
  });

  it('is idempotent', async () => {
    await mergeTeamStopHook(projectPath, 'linux');
    const first = readFileSync(hooksFile(), 'utf-8');
    const again = await mergeTeamStopHook(projectPath, 'linux');
    expect(again.added).toBe(false);
    expect(readFileSync(hooksFile(), 'utf-8')).toBe(first);
  });

  it('uses cmd /c on Windows', () => {
    expect(teamStopHookCommand('win32')).toBe('cmd /c npx -y ruflo@latest team hook-stop --host codex');
  });

  it('initialize writes no hook by default and one with teamHooks', async () => {
    const plain = await new CodexInitializer().initialize({ projectPath, template: 'default' });
    expect(plain.success).toBe(true);
    expect(existsSync(hooksFile())).toBe(false);
    expect(existsSync(join(projectPath, '.agents', 'skills', 'agent-teams', 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(projectPath, 'AGENTS.md'), 'utf-8')).toContain('## Agent Teams');

    const withHooks = await new CodexInitializer().initialize({ projectPath, template: 'default', force: true, teamHooks: true });
    expect(withHooks.success).toBe(true);
    expect(readHooks().hooks.SubagentStop).toHaveLength(1);
    expect(withHooks.warnings?.some((w) => w.includes('/hooks'))).toBe(true);
  });
});
