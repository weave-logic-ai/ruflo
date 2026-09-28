/**
 * Host registry: built-in adapters first, then labels declared in the
 * project's .claude-flow/team-hosts.json (served by the command adapter).
 * An unknown label is an error, never a silent fallback.
 */

import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { commandAdapter, loadTeamHosts, TeamHostsError } from './command.js';
import { grokAdapter } from './grok.js';
import type { CommandHostConfig, TeamHostAdapter } from './types.js';

export const BUILT_IN_HOSTS: Record<string, TeamHostAdapter> = {
  grok: grokAdapter,
  claude: claudeAdapter,
  codex: codexAdapter,
};

const RESERVED = [...Object.keys(BUILT_IN_HOSTS), 'command'];

export interface ResolvedHost {
  label: string;
  adapter: TeamHostAdapter;
  hostConfig?: CommandHostConfig;
}

/** Resolve a host label for planning. Throws TeamHostsError when unknown or invalid. */
export function resolveHost(label: string, projectRoot: string): ResolvedHost {
  const builtIn = BUILT_IN_HOSTS[label];
  if (builtIn) return { label, adapter: builtIn };
  const hosts = loadTeamHosts(projectRoot, RESERVED);
  const cfg = hosts[label];
  if (!cfg) {
    throw new TeamHostsError(
      `Unknown host "${label}". Built-in hosts: ${Object.keys(BUILT_IN_HOSTS).join(', ')}; ` +
        'declare others in .claude-flow/team-hosts.json',
    );
  }
  return { label, adapter: commandAdapter, hostConfig: cfg };
}

/** Adapter for a stop hook. Labels that are not built in use the command adapter. */
export function getAdapter(label: string): TeamHostAdapter {
  return BUILT_IN_HOSTS[label] ?? commandAdapter;
}

export { claudeAdapter, codexAdapter, commandAdapter, grokAdapter, TeamHostsError };
export { grokSpawnArgs, roleConstraint } from './grok.js';
export { codexExecSpec, CODEX_PASS_ENV } from './codex.js';
export { loadTeamHosts, parseTeamHosts, validateCommandHost, TEAM_HOSTS_FILE } from './command.js';
export { normalizeAgentLabel, pickString } from './identity.js';
export * from './types.js';
