/**
 * Reading turn state out of a Codex rollout file.
 *
 * Codex has no status field, so state is inferred from the tail of the rollout:
 * its lifecycle events, plus any tool call still waiting for its result.
 */
import path from "node:path";

import { parseJsonLines, readTail } from "../fsutil.js";
import type { Activity } from "../types.js";
import type { RolloutRateLimits } from "./codex-limits.js";

/** Enough to cover the trailing turn of a rollout without reading whole files. */
const TAIL_BYTES = 512 * 1024;

export interface RolloutRecord {
	timestamp?: string;
	type?: string;
	payload?: {
		type?: string;
		cwd?: string;
		call_id?: string;
		name?: string;
		input?: string;
		info?: { rate_limits?: RolloutRateLimits };
		rate_limits?: RolloutRateLimits;
	};
}

/** Payload types that represent a model-issued call awaiting a result. */
const CALL_TYPES = new Set(["custom_tool_call", "function_call", "local_shell_call"]);
const OUTPUT_TYPES = new Set(["custom_tool_call_output", "function_call_output", "local_shell_call_output"]);

/**
 * A call that asks to leave the sandbox carries an escalation marker and a
 * justification — the text Codex shows in its approval dialog.
 */
const ESCALATION = /require_escalated|"justification"|needs_approval|request_approval|with_escalated_permissions/;

/** A call auto-approved by policy returns almost immediately. */
const APPROVAL_GRACE_MS = 3000;

export interface RolloutState {
	activity: Activity;
	cwd?: string;
	/**
	 * The agent issued a call and is waiting for its result — either running it
	 * or, if it asked to escalate, waiting for you to approve it.
	 */
	blocked: boolean;
}

export async function readRolloutTail(file: string): Promise<RolloutRecord[]> {
	return parseJsonLines<RolloutRecord>(await readTail(file, TAIL_BYTES));
}

export function rateLimitsIn(record: RolloutRecord): RolloutRateLimits | undefined {
	return record.payload?.info?.rate_limits ?? record.payload?.rate_limits;
}

export function timestampOf(record: RolloutRecord, fallback: number): number {
	return record.timestamp ? Date.parse(record.timestamp) : fallback;
}

/**
 * Unknown event names that look like a prompt for the user are treated as
 * needs-input, so a new approval type is not read as "still working".
 */
function classifyEvent(payloadType: string): Activity | undefined {
	if (/approval|elicit|permission|confirm|request_input/.test(payloadType)) return "needs-input";
	if (payloadType === "task_started" || payloadType === "turn_started") return "working";
	if (
		payloadType === "task_complete" ||
		payloadType === "turn_complete" ||
		payloadType === "turn_aborted" ||
		payloadType === "shutdown_complete"
	) {
		return "idle";
	}
	return undefined;
}

interface OutstandingCall {
	at: number;
	escalated: boolean;
}

/** A call left unmatched by its `*_output` means the agent is blocked on it. */
function trackCall(outstanding: Map<string, OutstandingCall>, record: RolloutRecord, at: number): void {
	const payload = record.payload;
	const callId = payload?.call_id;
	const type = payload?.type ?? "";
	if (!callId) return;

	if (CALL_TYPES.has(type)) {
		outstanding.set(callId, { at, escalated: ESCALATION.test(payload?.input ?? "") });
	} else if (OUTPUT_TYPES.has(type)) {
		outstanding.delete(callId);
	}
}

/**
 * The approval prompt itself is never written to the rollout, so a pending
 * approval has to be recognised by its shape: a tool call with no matching
 * output, whose input asks to escalate. The grace period exists because a call
 * auto-approved by policy is also escalated, and returns almost immediately.
 */
function activityWhileBlocked(outstanding: Map<string, OutstandingCall>, now: number): Activity {
	for (const call of outstanding.values()) {
		if (call.escalated && now - call.at > APPROVAL_GRACE_MS) return "needs-input";
	}
	return "working";
}

export function classifyRollout(records: RolloutRecord[], now: number): RolloutState {
	const state: RolloutState = { activity: "idle", blocked: false };
	const outstanding = new Map<string, OutstandingCall>();

	for (const record of records) {
		const payload = record.payload;
		if (!payload) continue;
		if (payload.cwd) state.cwd = payload.cwd;

		if (record.type === "response_item") {
			trackCall(outstanding, record, timestampOf(record, now));
			continue;
		}
		if (record.type !== "event_msg") continue;

		const classified = classifyEvent(payload.type ?? "");
		if (!classified) continue;
		state.activity = classified;
		// The turn is over; nothing it left outstanding is still pending.
		if (classified === "idle") outstanding.clear();
	}

	if (outstanding.size === 0) return state;

	state.blocked = true;
	state.activity = activityWhileBlocked(outstanding, now);
	return state;
}

/** Rollout files are named `rollout-<iso>-<thread-id>.jsonl`. */
export function threadIdFromPath(file: string): string {
	return path
		.basename(file)
		.replace(/^rollout-.*?-(?=[0-9a-f]{8}-)/, "")
		.replace(/\.jsonl$/, "");
}
