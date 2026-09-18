/**
 * Turning Codex's two quota shapes — the `rate_limits` records in rollout files
 * and the `account/rateLimits/read` RPC reply — into one `UsageWindow`.
 */
import type { UsageWindow } from "../types.js";

/** As written into rollout files. */
export interface RolloutRateLimits {
	primary?: RolloutWindow | null;
	secondary?: RolloutWindow | null;
	plan_type?: string | null;
}

interface RolloutWindow {
	used_percent?: number;
	window_minutes?: number;
	resets_at?: number;
}

/** As returned by `account/rateLimits/read` — the live figures. */
export interface RpcRateLimits {
	primary?: RpcWindow | null;
	secondary?: RpcWindow | null;
	planType?: string | null;
}

interface RpcWindow {
	usedPercent?: number;
	windowDurationMins?: number;
	resetsAt?: number;
}

/** The two shapes reduced to the fields that actually matter. */
interface RawWindow {
	usedPercent?: number;
	windowMinutes?: number;
	/** Epoch *seconds*, as both Codex shapes report it. */
	resetsAtSeconds?: number;
}

export function labelForWindow(minutes: number): string {
	if (minutes <= 60) return `${minutes}m`;
	if (minutes === 300) return "5h";
	if (minutes === 10080) return "weekly";
	if (minutes === 43200) return "monthly";
	if (minutes % 1440 === 0) return `${minutes / 1440}d`;
	return `${Math.round(minutes / 60)}h`;
}

/**
 * `live` marks a figure read from the service just now, which by definition
 * describes the window that is current. A figure scraped from a rollout was
 * recorded during some earlier turn, so it goes stale once the window it
 * described has rolled over — Codex only refreshes it when the agent next runs.
 */
function toUsageWindow(raw: RawWindow, capturedAt: number, live: boolean): UsageWindow | undefined {
	const { usedPercent, windowMinutes, resetsAtSeconds } = raw;
	if (usedPercent === undefined || windowMinutes === undefined) return undefined;

	const resetsAt = resetsAtSeconds ? resetsAtSeconds * 1000 : undefined;
	return {
		label: labelForWindow(windowMinutes),
		windowMinutes,
		usedPercent,
		resetsAt,
		capturedAt,
		stale: !live && resetsAt !== undefined && resetsAt < Date.now(),
	};
}

/** Shortest window first, so tiles can pick "the short one" without guessing. */
function collect(raws: RawWindow[], capturedAt: number, live: boolean): UsageWindow[] {
	return raws
		.map((raw) => toUsageWindow(raw, capturedAt, live))
		.filter((window): window is UsageWindow => window !== undefined)
		.sort((a, b) => a.windowMinutes - b.windowMinutes);
}

function fromRollout(raw: RolloutWindow | null | undefined): RawWindow {
	return {
		usedPercent: raw?.used_percent,
		windowMinutes: raw?.window_minutes,
		resetsAtSeconds: raw?.resets_at,
	};
}

function fromRpc(raw: RpcWindow | null | undefined): RawWindow {
	return {
		usedPercent: raw?.usedPercent,
		windowMinutes: raw?.windowDurationMins,
		resetsAtSeconds: raw?.resetsAt,
	};
}

export function rolloutWindows(limits: RolloutRateLimits, capturedAt: number): UsageWindow[] {
	return collect([fromRollout(limits.primary), fromRollout(limits.secondary)], capturedAt, false);
}

export function rpcWindows(limits: RpcRateLimits, capturedAt: number): UsageWindow[] {
	return collect([fromRpc(limits.primary), fromRpc(limits.secondary)], capturedAt, true);
}
