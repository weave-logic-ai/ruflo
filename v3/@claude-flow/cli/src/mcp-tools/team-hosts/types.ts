/**
 * Team host adapter seam (ADR-402).
 *
 * Each host (Grok, Claude, Codex, or a generic command host) turns one
 * team_spawn request into a plan entry under spawnPlan.host[<label>] and
 * knows how to read its own stop-hook payload.
 */

export interface RoleDefaults {
  capability_mode: string;
  isolation: string;
  subagent_type: string;
  claudeTaskType?: string;
}

export const ROLE_DEFAULTS: Record<string, RoleDefaults> = {
  researcher: {
    capability_mode: 'read-only',
    isolation: 'none',
    subagent_type: 'explore',
    claudeTaskType: 'researcher',
  },
  architect: {
    capability_mode: 'read-only',
    isolation: 'none',
    subagent_type: 'plan',
    claudeTaskType: 'system-architect',
  },
  developer: {
    capability_mode: 'all',
    isolation: 'worktree',
    subagent_type: 'general-purpose',
    claudeTaskType: 'coder',
  },
  coder: {
    capability_mode: 'all',
    isolation: 'worktree',
    subagent_type: 'general-purpose',
    claudeTaskType: 'coder',
  },
  tester: {
    capability_mode: 'all',
    isolation: 'worktree',
    subagent_type: 'general-purpose',
    claudeTaskType: 'tester',
  },
  reviewer: {
    capability_mode: 'read-only',
    isolation: 'none',
    subagent_type: 'general-purpose',
    claudeTaskType: 'reviewer',
  },
  security: {
    capability_mode: 'read-only',
    isolation: 'none',
    subagent_type: 'general-purpose',
    claudeTaskType: 'security-auditor',
  },
  coordinator: {
    capability_mode: 'all',
    isolation: 'none',
    subagent_type: 'general-purpose',
    claudeTaskType: 'coordinator',
  },
};

export function roleDefaults(role: string): RoleDefaults {
  return ROLE_DEFAULTS[role] || ROLE_DEFAULTS.coder;
}

/** A command a runner executes directly (never through a shell). */
export interface ExecSpec {
  command: string;
  /** May contain placeholders such as {prompt}, {cwd}, {resultFile}. */
  args: string[];
  promptVia: 'stdin' | 'arg';
  closeStdin: boolean;
  /** Env names re-added after the runner strips secrets from the child env. */
  passEnv: string[];
}

/** Command host entry from .claude-flow/team-hosts.json, after validation. */
export interface CommandHostConfig {
  kind: 'exec';
  command: string;
  args: string[];
  promptVia: 'stdin' | 'arg';
  passEnv: string[];
  isolation: string;
}

export interface SpawnContext {
  team: { id: string; name: string; host?: string };
  agent: string;
  role: string;
  defaults: RoleDefaults;
  next: string[];
  /** Task body as given to team_spawn. */
  task: string;
  /** Host label this plan entry is built for (e.g. 'codex', 'myagent'). */
  label: string;
  /** Optional model override passed to team_spawn. */
  model?: string;
  /** Resolved config for a command host; undefined for built-ins. */
  hostConfig?: CommandHostConfig;
}

export interface StopIdentity {
  team?: string;
  agent?: string;
  outcome?: 'done' | 'failed';
}

export interface TeamHostAdapter {
  id: string;
  kind: 'native' | 'exec';
  /** Host-specific lines added to the shared child protocol. */
  protocolLines(ctx: SpawnContext): string[];
  /** Becomes spawnPlan.host[<label>] (without `prompt`, which the caller adds). */
  plan(ctx: SpawnContext): Record<string, unknown>;
  /** Map a stop-hook payload to a team/agent. */
  stopIdentity(payload: unknown, env?: NodeJS.ProcessEnv): StopIdentity;
}

/** Placeholders a runner fills in exec args. */
export const EXEC_PLACEHOLDERS = [
  'prompt',
  'team',
  'agent',
  'role',
  'cwd',
  'teamRoot',
  'resultFile',
] as const;
