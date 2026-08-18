/**
 * The escalation vocabulary and choreography shared by every sandbox-enforcing
 * tool family (`@deepseek-ai/dsh-tool-bash`, `@deepseek-ai/dsh-tool-fs`): the
 * strictly-wider ladder, the argument resolution, the model-facing
 * denial/hint markers, and {@link approveEscalation} — the ordered fail-closed
 * sequence that resolves a `sandbox_permissions` request through a
 * user-approval channel BEFORE anything executes. One home keeps the two
 * families' approval ordering and verbatim error texts from drifting apart.
 *
 * The channel is a minimal STRUCTURAL function shape ({@link EscalationAsk}),
 * not the approval service type: the tool layer — which owns the agent, the
 * call id, and the tool name — closes over `ctx.approval.request(...)` and
 * hands the closure down, so this package never depends on the approval or
 * agent packages.
 *
 * @module dsh-sandbox/escalation
 */

import { assertNever } from '@deepseek-ai/dsh-llm'
import type { SandboxMode } from './index.ts'

/**
 * The strictly-wider table: what a call whose effective mode is the key may
 * escalate TO. Checked at EXECUTION, never baked into a tool schema — the
 * schema's enum is {@link ESCALATION_TARGETS}, because schemas are
 * registry-global while the effective mode is per-call truth.
 */
export const WIDER_MODES: Record<string, readonly SandboxMode[]> = {
  'read-only': ['workspace-write', 'danger-full-access'],
  'workspace-write': ['danger-full-access'],
}

/**
 * The closed escalation-target vocabulary — every mode a call could ever
 * escalate TO (`read-only` is the floor; nothing escalates to it). Advertised
 * whenever the mounted capability confines: cutting the enum down to the modes
 * wider than the composition's DEFAULT would strand a session whose effective
 * mode sits below it (a `danger-full-access` default would advertise nothing
 * while a narrower-switched session stays confined with no lever).
 */
export const ESCALATION_TARGETS: readonly SandboxMode[] = ['workspace-write', 'danger-full-access']

/**
 * Describe a non-widening request with the correction the caller can apply.
 * The approval check remains fail-closed for callers that bypass
 * {@link resolveEscalationArgs}.
 * @param mode - the requested target mode.
 * @param effectiveMode - the call's current mode.
 * @param subject - the operation noun used in the correction.
 * @returns the complete model-facing diagnostic.
 */
function nonWideningMessage(mode: string, effectiveMode: SandboxMode, subject: string): string {
  const prefix = `sandbox escalation to "${mode}" is not strictly wider than this call's current "${effectiveMode}" mode`
  const widerModes = WIDER_MODES[effectiveMode] ?? []
  if (effectiveMode === 'danger-full-access') {
    return `${prefix}; no wider sandbox mode exists, so retry this ${subject} without sandbox_permissions or justification`
  }
  if (widerModes.length > 0) {
    const targets = widerModes.map(target => `"${target}"`).join(' or ')
    return `${prefix}; request ${targets} with a non-empty justification after a denial, or omit both fields if this ${subject} does not need escalation`
  }
  return `${prefix}; the current sandbox mode has no recognized wider target`
}

/** A validated escalation request that still needs approval. */
export interface ResolvedEscalationArgs {
  /** The strictly wider sandbox mode requested for this call. */
  requestedMode: string
  /** The non-empty reason shown to the user in the approval request. */
  justification: string
}

/**
 * Resolve raw tool arguments into an escalation that still needs approval.
 * A recognized target that is equal to or narrower than the effective mode is
 * inert and ignored because it cannot add authority. Under
 * `danger-full-access`, every field combination is inert. A genuinely wider
 * target requires a paired, non-empty justification.
 * @param sandboxPermissions - the raw `sandbox_permissions` argument, if given.
 * @param justification - the raw `justification` argument, if given.
 * @param effectiveMode - the call's current mode, when policy has already been resolved.
 * @param subject - the operation noun used in a non-widening correction.
 * @returns the validated request, or `undefined` when no approval is needed.
 */
export function resolveEscalationArgs(
  sandboxPermissions: string | undefined,
  justification: string | undefined,
  effectiveMode?: SandboxMode,
  subject = 'operation',
): ResolvedEscalationArgs | undefined {
  if (effectiveMode !== undefined && effectiveMode !== 'danger-full-access' && WIDER_MODES[effectiveMode] === undefined) {
    throw new Error(nonWideningMessage(sandboxPermissions ?? '<omitted>', effectiveMode, subject))
  }
  if (effectiveMode === 'danger-full-access') return undefined
  if (sandboxPermissions !== undefined && effectiveMode !== undefined
    && !(WIDER_MODES[effectiveMode] ?? []).includes(sandboxPermissions as SandboxMode)) {
    if (ESCALATION_TARGETS.includes(sandboxPermissions as SandboxMode)) return undefined
    throw new Error(nonWideningMessage(sandboxPermissions, effectiveMode, subject))
  }
  if (sandboxPermissions !== undefined && justification === undefined) {
    throw new Error('invalid escalation: sandbox_permissions requires a justification')
  }
  if (justification !== undefined && sandboxPermissions === undefined) {
    throw new Error('invalid escalation: justification is only valid together with sandbox_permissions')
  }
  if (justification !== undefined && justification.trim().length === 0) {
    throw new Error('invalid justification: expected a non-empty sentence; provide one with sandbox_permissions, or omit both escalation fields')
  }
  if (sandboxPermissions === undefined || justification === undefined) return undefined
  return { requestedMode: sandboxPermissions, justification }
}

/**
 * The model-facing denial marker — the one vocabulary both enforcing families
 * teach and report, so the model recognizes a policy denial identically
 * whether the kernel refused a bash file effect or the filesystem provider's
 * fence refused a mutation.
 * @param mode - the mode the denied call ran under.
 * @returns the marker line, exactly as the model sees it.
 */
export function sandboxDenialMarker(mode: SandboxMode): string {
  return `[sandbox: file access denied under ${mode} mode]`
}

/**
 * The same-turn escalation hint that rides a denial when the composition
 * advertises the escalation fields — the nudge lives at the decision point so
 * the sanctioned retry does not depend on the model recalling the tool
 * description.
 * @param subject - the family's noun for the denied action (`command` for
 *   bash, `operation` for a filesystem mutation).
 * @returns the hint line, exactly as the model sees it.
 */
export function escalationHintMarker(subject: string): string {
  return `[sandbox: escalation available — retry this exact ${subject} once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]`
}

/**
 * The closed outcome vocabulary of one escalation ask — structurally identical
 * to the approval seam's `ApprovalOutcome` so an `ApprovalService.request`
 * return is assignable without this package importing it.
 */
export type EscalationOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/**
 * The minimal approval-request shape {@link approveEscalation} needs —
 * structurally the approval seam's `ApprovalService`, generic over the agent
 * type `A` and call-id type `C` so this package resolves escalations through
 * `ctx.approval` without importing the approval or agent packages (the tool
 * layer infers `A`/`C` as its own `Agent`/`CallId`).
 */
export interface EscalationApprover<A = object, C = string> {
  /**
   * Ask the human to approve one action, resolving to a closed outcome.
   * @param req - the audit-self-contained request (agent, tool, call id, reason, optional signal).
   * @returns the human's decision as a closed {@link EscalationOutcome}.
   */
  request(req: { agent: A; toolName: string; callId: C; reason: string; signal?: AbortSignal }): Promise<EscalationOutcome>
}

/**
 * The approval ingredients an escalating tool hands {@link approveEscalation}:
 * the approval requester (`ctx.approval`, or `undefined` when none is
 * composed), the calling agent (or `undefined` for an agent-less execution),
 * and the call's identity. The tool layer holds all of these; this package
 * only judges them.
 */
export interface EscalationApproval<A = object, C = string> {
  /** The approval requester (`ctx.approval`), or `undefined` when none is composed. */
  approver: EscalationApprover<A, C> | undefined
  /** The calling agent, or `undefined` for an agent-less execution (fails closed). */
  agent: A | undefined
  /** The tool-call id the approval prompt attaches to. */
  callId: C
  /** The tool name recorded on the approval request. */
  toolName: string
  /** The tool-execution abort signal the approval request rides, when present. */
  signal?: AbortSignal
}

/** One escalation request, as {@link approveEscalation} judges it. */
export interface EscalationRequest {
  /** The requested target mode (schema-pinned to {@link ESCALATION_TARGETS} when advertised). */
  requestedMode: string
  /** The model's one-sentence reason, shown verbatim to the user inside the audit reason. */
  justification: string
  /** The call's effective mode (session override ?? composition default) the request must strictly widen. */
  effectiveMode: SandboxMode
  /** The family's noun for the escalated action in user-facing texts (`command` for bash, `operation` for fs). */
  subject: string
}

/**
 * Resolve a sandbox-escalation request BEFORE anything executes: check strict
 * widening against the call's effective mode, then resolve the approval
 * channel, then map every outcome — the ordered fail-closed sequence both
 * enforcing families share. Returns the granted mode to stamp onto exactly
 * this call; throws the distinct verbatim text for every other path (a
 * non-widening request, a missing approval service, an agent-less execution,
 * a rejection, a cancellation, an unanswerable ask) — the tool registry turns
 * the throw into the call's isError result, and nothing has run. A
 * non-widening request never prompts a human.
 * @param request - the escalation to judge (see {@link EscalationRequest}).
 * @param approval - the approval ingredients the tool holds (see {@link EscalationApproval}).
 * @returns the granted mode, consumed by the one call that asked.
 */
export async function approveEscalation<A, C>(request: EscalationRequest, approval: EscalationApproval<A, C>): Promise<SandboxMode> {
  const { requestedMode: mode, effectiveMode, justification, subject } = request
  // Strict widening is an EXECUTION check against the call's effective mode —
  // deliberately not a schema constraint (the enum is the closed target
  // vocabulary; the effective mode is per-call truth).
  if (!(WIDER_MODES[effectiveMode] ?? []).includes(mode as SandboxMode)) {
    throw new Error(nonWideningMessage(mode, effectiveMode, subject))
  }
  if (approval.approver === undefined) {
    throw new Error(`sandbox escalation to "${mode}" requires approval, but no approval service is composed`)
  }
  if (approval.agent === undefined) {
    throw new Error(`sandbox escalation to "${mode}" requires approval, but the call has no agent to route it through`)
  }
  // Self-contained for the audit trail: approval/asked stores this reason,
  // and the target mode is part of the grant's identity.
  const outcome = await approval.approver.request({
    agent: approval.agent,
    toolName: approval.toolName,
    callId: approval.callId,
    reason: `escalate sandbox to ${mode}: ${justification}`,
    ...approval.signal ? { signal: approval.signal } : {},
  })
  switch (outcome) {
    // The schema enum already pinned `mode` to the closed target vocabulary;
    // the check above proved it is strictly wider.
    case 'allowed-once': return mode as SandboxMode
    case 'rejected': throw new Error(`the user rejected escalating this ${subject} to "${mode}"`)
    case 'cancelled': throw new Error(`approval for escalating to "${mode}" was cancelled`)
    case 'unavailable': throw new Error(`sandbox escalation to "${mode}" requires approval, but no approval channel is available`)
    default: return assertNever(outcome, 'EscalationOutcome')
  }
}
