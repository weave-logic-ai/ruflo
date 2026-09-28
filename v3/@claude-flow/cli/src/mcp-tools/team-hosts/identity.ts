/**
 * Helpers for reading stop-hook payloads and normalizing agent labels.
 */

import type { StopIdentity } from './types.js';

type Payload = Record<string, unknown>;

function asObject(v: unknown): Payload {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Payload) : {};
}

/** First non-empty string at any of the given dotted paths. */
export function pickString(payload: unknown, paths: string[]): string | undefined {
  const root = asObject(payload);
  for (const p of paths) {
    let cur: unknown = root;
    for (const key of p.split('.')) {
      cur = asObject(cur)[key];
    }
    if (typeof cur === 'string' && cur.trim()) return cur.trim();
  }
  return undefined;
}

/**
 * Turn a host label into a team agent name: `role:agent` becomes `agent`
 * (Grok's spawn description form), whitespace becomes `-`, max 64 chars.
 */
export function normalizeAgentLabel(label: string): string {
  const afterColon = label.includes(':') ? label.slice(label.lastIndexOf(':') + 1) : label;
  return afterColon.trim().replace(/\s+/g, '-').slice(0, 64);
}

export function readStopIdentity(
  payload: unknown,
  agentPaths: string[],
  envAgent?: string,
): StopIdentity {
  const out: StopIdentity = {};
  const agent = envAgent?.trim() || pickString(payload, agentPaths);
  if (agent) out.agent = normalizeAgentLabel(agent);
  const team = pickString(payload, ['teamName', 'team', 'team_name']);
  if (team) out.team = team;
  const outcome = pickString(payload, ['outcome']);
  if (outcome === 'done' || outcome === 'failed') out.outcome = outcome;
  return out;
}
