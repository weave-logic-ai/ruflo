/**
 * On-disk state for host-agnostic Agent Teams (ADR-402).
 *
 * The team_* handlers are the only writer of .claude-flow/teams/ and the
 * mailbox. Writes to team.json happen under a short O_EXCL lock file and go
 * through a temp file plus rename, because parallel runners stop at the
 * same time.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { getProjectCwd } from './types.js';
import { validateIdentifier } from './validate-input.js';

export const TEAM_SCHEMA_VERSION = 1;

const TEAMS_DIR = join('.claude-flow', 'teams');
const MAILBOX_DIR = join('.claude-flow', 'swarm', 'mailbox');
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 2000;
const LOCK_STALE_MS = 10_000;

export interface TeamMember {
  name: string;
  role: string;
  status: string;
  registeredAt: string;
  next?: string[];
  spawn?: Record<string, unknown>;
  lastStopAt?: string;
  lastStopRunId?: string;
  runId?: string;
  threadId?: string;
  [key: string]: unknown;
}

export interface PlanStep {
  id: string;
  agent: string;
  status: string;
  [key: string]: unknown;
}

export interface TeamState {
  schemaVersion?: number;
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
  [key: string]: unknown;
}

export interface TeamMessage {
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

export function nowIso(): string {
  return new Date().toISOString();
}

export function ensureDir(p: string): void {
  if (!existsSync(p)) {
    mkdirSync(p, { recursive: true, mode: 0o700 });
  }
}

export function safeName(name: string, field = 'name'): { ok: true; value: string } | { ok: false; error: string } {
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

export function teamsRoot(): string {
  return join(getProjectCwd(), TEAMS_DIR);
}

export function mailboxRoot(): string {
  return join(getProjectCwd(), MAILBOX_DIR);
}

export function teamDir(teamName: string): string {
  return join(teamsRoot(), teamName);
}

export function teamPath(teamName: string): string {
  return join(teamDir(teamName), 'team.json');
}

export function readJson<T>(file: string): T | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** Write JSON through a temp file and rename, so readers never see half a file. */
export function writeJson(file: string, data: unknown): void {
  ensureDir(dirname(file));
  const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, file);
}

/** Plan-step normalization shared by team_plan and v0 reads. */
export function normalizeStep(s: unknown, i: number, index = 0): PlanStep {
  const statusFor = () => (i < index ? 'done' : i === index ? 'ready' : 'pending');
  if (typeof s === 'string') return { id: s, agent: s, status: statusFor() };
  const o = (s && typeof s === 'object' ? s : {}) as Partial<PlanStep>;
  return {
    ...o,
    id: String(o.id || o.agent || `step-${i}`),
    agent: String(o.agent || o.id || `step-${i}`),
    status: typeof o.status === 'string' && o.status ? o.status : statusFor(),
  };
}

/** Fill fields that pre-schemaVersion writers could leave out. Keeps unknown keys. */
function normalizeTeam(team: TeamState): TeamState {
  team.members = team.members && typeof team.members === 'object' ? team.members : {};
  const plan = team.plan && typeof team.plan === 'object' ? team.plan : { steps: [], index: 0 };
  const index = Number.isInteger(plan.index) && plan.index >= 0 ? plan.index : 0;
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  team.plan = { ...plan, index, steps: steps.map((s, i) => normalizeStep(s, i, index)) };
  return team;
}

export type LoadResult = { team: TeamState | null; error?: string };

/**
 * Read team.json. v0 data (no schemaVersion) is normalized; a newer
 * schemaVersion is refused so this writer never downgrades it.
 */
export function loadTeam(teamName: string): LoadResult {
  const raw = readJson<TeamState>(teamPath(teamName));
  if (!raw) return { team: null };
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > TEAM_SCHEMA_VERSION) {
    return {
      team: null,
      error: `Team "${teamName}" uses schemaVersion ${version}; this Ruflo understands up to ${TEAM_SCHEMA_VERSION}. Upgrade Ruflo.`,
    };
  }
  return { team: normalizeTeam(raw) };
}

export function saveTeam(team: TeamState): void {
  team.schemaVersion = TEAM_SCHEMA_VERSION;
  writeJson(teamPath(team.name), team);
}

/**
 * Record an agent stop on a loaded team (caller saves). `done` advances the
 * plan when the agent owns the current step; `failed` marks the step failed
 * and does not advance. A repeated runId for the same member is a duplicate.
 */
export function applyStop(
  team: TeamState,
  agent: string,
  outcome: 'done' | 'failed',
  runId?: string,
  reason?: string,
): { duplicate: boolean; current?: PlanStep } {
  const member = team.members[agent];
  if (member && runId && member.lastStopRunId === runId) return { duplicate: true };
  if (member) {
    member.status = outcome === 'failed' ? 'failed' : 'idle';
    member.lastStopAt = nowIso();
    if (runId) member.lastStopRunId = runId;
    if (reason !== undefined) member.lastStopReason = reason;
  }
  const plan = team.plan;
  const cur = plan.steps[plan.index];
  if (!cur || (cur.agent !== agent && cur.id !== agent)) return { duplicate: false };
  if (outcome === 'failed') {
    cur.status = 'failed';
  } else {
    cur.status = 'done';
    plan.index = Math.min(plan.index + 1, plan.steps.length);
    const next = plan.steps[plan.index];
    if (next) next.status = 'ready';
  }
  return { duplicate: false, current: cur };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` while holding .claude-flow/teams/<name>/team.json.lock. The lock
 * is an O_EXCL file; a lock older than 10 s is treated as stale and broken.
 * Throws when the lock cannot be taken within 2 s.
 */
export async function withTeamLock<T>(teamName: string, fn: () => T | Promise<T>): Promise<T> {
  const dir = teamDir(teamName);
  ensureDir(dir);
  const lock = join(dir, 'team.json.lock');
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lock);
          continue;
        }
      } catch {
        continue; // lock vanished between open and stat; retry at once
      }
      if (Date.now() >= deadline) {
        throw new Error(`Team "${teamName}" is locked by another writer (${lock})`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      /* already removed as stale by another writer */
    }
  }
}

export function listMailboxFiles(agent: string): string[] {
  const dir = join(mailboxRoot(), agent);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}
