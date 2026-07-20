/**
 * Host-agnostic Agent Teams MCP tools (ADR-320).
 *
 * Comms live in Ruflo (filesystem under .claude-flow/), not host SendMessage.
 * team_spawn returns a host spawn plan (Grok spawn_subagent / Claude Task adapter).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { type MCPTool, getProjectCwd } from './types.js';
import { validateIdentifier, validateText } from './validate-input.js';

const TEAMS_DIR = join('.claude-flow', 'teams');
const MAILBOX_DIR = join('.claude-flow', 'swarm', 'mailbox');

interface RoleDefaults {
  capability_mode: string;
  isolation: string;
  subagent_type: string;
  claudeTaskType?: string;
}

const ROLE_DEFAULTS: Record<string, RoleDefaults> = {
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

interface TeamMember {
  name: string;
  role: string;
  status: string;
  registeredAt: string;
  next?: string[];
  spawn?: Record<string, unknown>;
  lastStopAt?: string;
}

interface PlanStep {
  id: string;
  agent: string;
  status: string;
}

interface TeamState {
  id: string;
  name: string;
  topology: string;
  maxAgents: number;
  status: string;
  createdAt: string;
  host?: string;
  members: Record<string, TeamMember>;
  plan: { steps: PlanStep[]; index: number; updatedAt?: string };
  shutdownAt?: string;
}

interface TeamMessage {
  id: string;
  teamId: string;
  from: string;
  to: string;
  summary: string;
  content: string;
  type: string;
  priority: number;
  timestamp: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDir(p: string): void {
  if (!existsSync(p)) {
    mkdirSync(p, { recursive: true, mode: 0o700 });
  }
}

function safeName(name: string, field = 'name'): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof name !== 'string' || !name.trim()) {
    return { ok: false, error: `${field} is required` };
  }
  const v = validateIdentifier(name, field);
  if (!v.valid) return { ok: false, error: v.error || `Invalid ${field}` };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    return { ok: false, error: `Invalid ${field} "${name}" — use alphanumeric, dash, underscore` };
  }
  return { ok: true, value: name };
}

function teamsRoot(): string {
  return join(getProjectCwd(), TEAMS_DIR);
}

function mailboxRoot(): string {
  return join(getProjectCwd(), MAILBOX_DIR);
}

function teamDir(teamName: string): string {
  return join(teamsRoot(), teamName);
}

function teamPath(teamName: string): string {
  return join(teamDir(teamName), 'team.json');
}

function readJson<T>(file: string): T | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, data: unknown): void {
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function loadTeam(teamName: string): TeamState | null {
  return readJson<TeamState>(teamPath(teamName));
}

function saveTeam(team: TeamState): void {
  writeJson(teamPath(team.name), team);
}

function buildSpawnPlan(
  team: TeamState,
  agentName: string,
  role: string,
  prompt: string,
  next: string[],
): Record<string, unknown> {
  const defaults = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.coder;
  const protocol = [
    `You are "${agentName}" (role: ${role}) on team "${team.name}".`,
    `Host-agnostic Agent Teams bus (ADR-320). There is NO Claude SendMessage tool.`,
    `Prefer Ruflo MCP team_send / team_inbox when available; CLI fallback:`,
    `  node scripts/grok-team-bus.mjs send --team ${team.name} --to <next> --summary "<short>" --message "<handoff>"`,
    `Or store under memory namespace team:${team.name}.`,
    next.length
      ? `Primary next agent(s): ${next.join(', ')}`
      : `Report completion to the team lead (parent session).`,
    `Check inbox at start via team_inbox (team=${team.name}, agent=${agentName}).`,
    '',
    'Task:',
    prompt || `(No task body — wait for inbox / lead instructions for role ${role}.)`,
  ].join('\n');

  return {
    teamId: team.id,
    name: agentName,
    role,
    prompt: protocol,
    next,
    host: {
      grok: {
        subagent_type: defaults.subagent_type,
        capability_mode: defaults.capability_mode,
        isolation: defaults.isolation,
        background: true,
        description: `${role}:${agentName}`,
      },
      claude: {
        taskType: defaults.claudeTaskType || role,
        note: 'optional back-compat path via Task tool',
      },
    },
  };
}

function listMailboxFiles(agent: string): string[] {
  const dir = join(mailboxRoot(), agent);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

function okResult(data: Record<string, unknown>) {
  return { success: true, ...data };
}

function errResult(error: string) {
  return { success: false, error };
}

export const teamTools: MCPTool[] = [
  {
    name: 'team_create',
    description:
      'Create a host-agnostic Agent Team (ADR-320). State under .claude-flow/teams/. Use when native SendMessage/Task teammate bus is wrong or unavailable (Grok, Codex, multi-host). Pair with team_spawn for spawn plans and team_send/team_inbox for handoffs.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Team name/id (alphanumeric, dash, underscore)' },
        topology: {
          type: 'string',
          description: 'Team topology (hierarchical, mesh, star, ring)',
        },
        maxAgents: { type: 'number', description: 'Max members (1-50, default 8)' },
        host: { type: 'string', description: 'Host label (grok, claude, codex)' },
        force: { type: 'boolean', description: 'Overwrite existing team metadata' },
      },
      required: ['name'],
    },
    handler: async (input) => {
      const sn = safeName(String(input.name || ''), 'name');
      if (!sn.ok) return errResult(sn.error);
      const name = sn.value;
      const force = input.force === true;
      const path = teamPath(name);
      if (existsSync(path) && !force) {
        return errResult(`Team "${name}" already exists (pass force=true to overwrite metadata carefully)`);
      }

      ensureDir(teamDir(name));
      ensureDir(join(teamDir(name), 'plan'));
      ensureDir(mailboxRoot());

      const team: TeamState = {
        id: name,
        name,
        topology: (input.topology as string) || 'hierarchical',
        maxAgents: Math.min(Math.max(Number(input.maxAgents) || 8, 1), 50),
        status: 'active',
        createdAt: nowIso(),
        host: (input.host as string) || 'grok',
        members: {},
        plan: { steps: [], index: 0 },
      };
      saveTeam(team);
      return okResult({ action: 'create', team });
    },
  },
  {
    name: 'team_spawn',
    description:
      'Register a teammate and return a host spawn plan (Grok spawn_subagent / Claude Task adapter). Does not execute the agent — the host lead must spawn using the plan.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id' },
        agent: { type: 'string', description: 'Agent name' },
        role: { type: 'string', description: 'Role (architect, developer, tester, reviewer, …)' },
        prompt: { type: 'string', description: 'Task body embedded in spawn plan prompt' },
        next: {
          type: 'array',
          description: 'Next agent name(s) for handoff',
          items: { type: 'string' },
        },
      },
      required: ['team', 'agent'],
    },
    handler: async (input) => {
      const st = safeName(String(input.team || ''), 'team');
      if (!st.ok) return errResult(st.error);
      const sa = safeName(String(input.agent || ''), 'agent');
      if (!sa.ok) return errResult(sa.error);
      const team = loadTeam(st.value);
      if (!team) return errResult(`Team "${st.value}" not found — call team_create first`);

      const role = String(input.role || sa.value);
      const nextRaw = input.next;
      const next = Array.isArray(nextRaw)
        ? nextRaw.map(String).map((s) => s.trim()).filter(Boolean)
        : typeof nextRaw === 'string'
          ? String(nextRaw).split(',').map((s) => s.trim()).filter(Boolean)
          : [];

      if (input.prompt) {
        const tv = validateText(String(input.prompt), 'prompt', 100_000);
        if (!tv.valid) return errResult(tv.error || 'Invalid prompt');
      }

      const plan = buildSpawnPlan(team, sa.value, role, String(input.prompt || ''), next);
      team.members[sa.value] = {
        name: sa.value,
        role,
        status: 'registered',
        registeredAt: nowIso(),
        next,
        spawn: plan.host as Record<string, unknown>,
      };
      saveTeam(team);
      ensureDir(join(mailboxRoot(), sa.value));
      return okResult({ action: 'spawn', spawnPlan: plan, teamId: team.id });
    },
  },
  {
    name: 'team_send',
    description:
      'Enqueue a message to a named agent mailbox (or broadcast with to="*"). Host-agnostic replacement for Claude SendMessage.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id' },
        to: { type: 'string', description: 'Recipient agent name or * for broadcast' },
        message: { type: 'string', description: 'Message body' },
        summary: { type: 'string', description: 'Short summary' },
        from: { type: 'string', description: 'Sender name (default: lead)' },
        type: { type: 'string', description: 'Message type (handoff, status, …)' },
        priority: { type: 'number', description: 'Priority (lower sorts first in filename; default 2)' },
      },
      required: ['team', 'to', 'message'],
    },
    handler: async (input) => {
      const st = safeName(String(input.team || ''), 'team');
      if (!st.ok) return errResult(st.error);
      const team = loadTeam(st.value);
      if (!team) return errResult(`Team "${st.value}" not found`);

      const to = String(input.to || '*');
      if (to !== '*') {
        const sto = safeName(to, 'to');
        if (!sto.ok) return errResult(sto.error);
      }
      const content = String(input.message || input.content || '');
      if (!content.trim()) return errResult('message is required');
      const tv = validateText(content, 'message', 500_000);
      if (!tv.valid) return errResult(tv.error || 'Invalid message');

      const msg: TeamMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        teamId: team.id,
        from: String(input.from || 'lead'),
        to,
        summary: String(input.summary || ''),
        content,
        type: String(input.type || 'handoff'),
        priority: Number(input.priority ?? 2),
        timestamp: nowIso(),
      };

      const root = mailboxRoot();
      if (to === '*') {
        const members = Object.keys(team.members || {});
        if (members.length === 0) {
          ensureDir(join(root, '_broadcast'));
          writeJson(join(root, '_broadcast', `${msg.priority}_${msg.id}.json`), msg);
        } else {
          for (const m of members) {
            ensureDir(join(root, m));
            writeJson(join(root, m, `${msg.priority}_${msg.id}.json`), msg);
          }
        }
      } else {
        ensureDir(join(root, to));
        writeJson(join(root, to, `${msg.priority}_${msg.id}.json`), msg);
      }
      return okResult({ action: 'send', message: msg });
    },
  },
  {
    name: 'team_inbox',
    description:
      'Drain (default) or peek an agent mailbox. Messages archive under mailbox/<agent>/archive when drained.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id (optional validation)' },
        agent: { type: 'string', description: 'Agent name whose inbox to read' },
        peek: { type: 'boolean', description: 'If true, do not archive/drain messages' },
      },
      required: ['agent'],
    },
    handler: async (input) => {
      if (input.team) {
        const st = safeName(String(input.team), 'team');
        if (!st.ok) return errResult(st.error);
      }
      const sa = safeName(String(input.agent || ''), 'agent');
      if (!sa.ok) return errResult(sa.error);
      const peek = input.peek === true;
      const dir = join(mailboxRoot(), sa.value);
      if (!existsSync(dir)) {
        return okResult({ action: 'inbox', agent: sa.value, messages: [], peek });
      }
      const files = listMailboxFiles(sa.value);
      const messages: TeamMessage[] = [];
      for (const f of files) {
        const full = join(dir, f);
        const msg = readJson<TeamMessage>(full);
        if (!msg) continue;
        messages.push(msg);
        if (!peek) {
          const archive = join(dir, 'archive');
          ensureDir(archive);
          renameSync(full, join(archive, f));
        }
      }
      return okResult({ action: 'inbox', agent: sa.value, messages, peek });
    },
  },
  {
    name: 'team_broadcast',
    description: 'Fan-out a message to all registered team members (alias of team_send with to="*").',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id' },
        message: { type: 'string', description: 'Message body' },
        summary: { type: 'string', description: 'Short summary' },
        from: { type: 'string', description: 'Sender (default: lead)' },
      },
      required: ['team', 'message'],
    },
    handler: async (input) => {
      // Delegate via same logic as send with to=*
      const sendTool = teamTools.find((t) => t.name === 'team_send');
      if (!sendTool) return errResult('team_send not registered');
      return sendTool.handler({
        team: input.team,
        to: '*',
        message: input.message,
        summary: input.summary,
        from: input.from || 'lead',
        type: 'broadcast',
      });
    },
  },
  {
    name: 'team_plan',
    description: 'Set pipeline steps for a team (ordered agents). First step becomes ready.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id' },
        steps: {
          type: 'array',
          description: 'Ordered agent names or {id,agent} objects',
          items: {},
        },
      },
      required: ['team', 'steps'],
    },
    handler: async (input) => {
      const st = safeName(String(input.team || ''), 'team');
      if (!st.ok) return errResult(st.error);
      const team = loadTeam(st.value);
      if (!team) return errResult(`Team "${st.value}" not found`);

      let stepsIn: unknown[] = [];
      if (Array.isArray(input.steps)) {
        stepsIn = input.steps;
      } else if (typeof input.steps === 'string') {
        try {
          stepsIn = JSON.parse(input.steps);
        } catch {
          stepsIn = String(input.steps).split(',').map((s) => s.trim()).filter(Boolean);
        }
      }

      team.plan = {
        steps: stepsIn.map((s, i) =>
          typeof s === 'string'
            ? { id: s, agent: s, status: i === 0 ? 'ready' : 'pending' }
            : {
                id: String((s as PlanStep).id || (s as PlanStep).agent || `step-${i}`),
                agent: String((s as PlanStep).agent || (s as PlanStep).id || `step-${i}`),
                status: i === 0 ? 'ready' : 'pending',
              },
        ),
        index: 0,
        updatedAt: nowIso(),
      };
      saveTeam(team);
      return okResult({ action: 'plan', plan: team.plan });
    },
  },
  {
    name: 'team_status',
    description: 'Team members, plan progress, and pending mailbox counts.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id' },
      },
      required: ['team'],
    },
    handler: async (input) => {
      const st = safeName(String(input.team || ''), 'team');
      if (!st.ok) return errResult(st.error);
      const team = loadTeam(st.value);
      if (!team) return errResult(`Team "${st.value}" not found`);

      // Include registered members and any mailbox dirs (pre-spawn handoffs).
      const mail: Record<string, number> = {};
      const names = new Set(Object.keys(team.members || {}));
      const root = mailboxRoot();
      if (existsSync(root)) {
        for (const ent of readdirSync(root, { withFileTypes: true })) {
          if (ent.isDirectory()) names.add(ent.name);
        }
      }
      for (const name of names) {
        mail[name] = listMailboxFiles(name).length;
      }
      return okResult({ action: 'status', team, pendingMail: mail });
    },
  },
  {
    name: 'team_on_stop',
    description:
      'Mark agent idle, advance plan, return next assignment hint. Wire from SubagentStop / post-task hooks.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id' },
        agent: { type: 'string', description: 'Agent that stopped' },
      },
      required: ['team', 'agent'],
    },
    handler: async (input) => {
      const st = safeName(String(input.team || ''), 'team');
      if (!st.ok) return errResult(st.error);
      const sa = safeName(String(input.agent || ''), 'agent');
      if (!sa.ok) return errResult(sa.error);
      const team = loadTeam(st.value);
      if (!team) return errResult(`Team "${st.value}" not found`);

      if (team.members[sa.value]) {
        team.members[sa.value].status = 'idle';
        team.members[sa.value].lastStopAt = nowIso();
      }

      const plan = team.plan || { steps: [] as PlanStep[], index: 0 };
      const cur = plan.steps[plan.index];
      if (cur && (cur.agent === sa.value || cur.id === sa.value)) {
        cur.status = 'done';
        plan.index = Math.min(plan.index + 1, plan.steps.length);
        const next = plan.steps[plan.index];
        if (next) next.status = 'ready';
      }
      team.plan = plan;
      saveTeam(team);

      const nextStep = plan.steps[plan.index];
      return okResult({
        action: 'on-stop',
        agent: sa.value,
        next: nextStep || null,
        assign: nextStep
          ? {
              hint: `Spawn or resume agent "${nextStep.agent}" for the next plan step`,
              agent: nextStep.agent,
            }
          : { hint: 'Plan complete — lead should synthesize' },
      });
    },
  },
  {
    name: 'team_shutdown',
    description: 'Graceful team teardown — marks team and members shutdown.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id' },
      },
      required: ['team'],
    },
    handler: async (input) => {
      const st = safeName(String(input.team || ''), 'team');
      if (!st.ok) return errResult(st.error);
      const team = loadTeam(st.value);
      if (!team) return errResult(`Team "${st.value}" not found`);
      team.status = 'shutdown';
      team.shutdownAt = nowIso();
      for (const m of Object.values(team.members || {})) {
        m.status = 'shutdown';
      }
      saveTeam(team);
      return okResult({ action: 'shutdown', teamId: team.id });
    },
  },
];
