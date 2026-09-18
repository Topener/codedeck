/** Turning a snapshot into the key image a given metric should show. */
import { renderActivity, renderReset, renderUsage } from "../render/tiles.js";
import type { CodexSnapshot, UsageWindow } from "../types.js";

export type Metric = "activity" | "usage-5h" | "usage-weekly" | "reset-5h" | "reset-weekly";

/** Anything longer than this counts as the long window. */
const WEEKLY_MINUTES = 10080;
/** Anything up to this counts as the short window. */
const SHORT_MINUTES = 300;

const WEEKLY_METRICS = new Set<Metric>(["usage-weekly", "reset-weekly"]);

/** Shown instead of a percentage the window has already invalidated. */
const STALE_NOTE = "stale - run codex";

interface WindowChoice {
	label: string;
	/** Percentage still available, as Codex counts it. */
	percentRemaining?: number;
	resetsAt?: number;
	windowMinutes?: number;
	note?: string;
}

/**
 * Prefer an exact match on the window the tile asked for; otherwise fall back
 * to the shortest (5h) or longest (weekly) window on offer, because the set of
 * windows a plan reports is not fixed.
 */
function chooseWindow(windows: UsageWindow[], wantWeekly: boolean): UsageWindow | undefined {
	const sorted = [...windows].sort((a, b) => a.windowMinutes - b.windowMinutes);
	if (sorted.length === 0) return undefined;

	const exact = sorted.find((window) =>
		wantWeekly ? window.windowMinutes >= WEEKLY_MINUTES : window.windowMinutes <= SHORT_MINUTES,
	);
	if (exact) return exact;
	return wantWeekly ? sorted[sorted.length - 1] : sorted[0];
}

function pickWindow(snapshot: CodexSnapshot, metric: Metric): WindowChoice {
	const wantWeekly = WEEKLY_METRICS.has(metric);
	const chosen = chooseWindow(snapshot.windows, wantWeekly);
	if (!chosen) return { label: wantWeekly ? "weekly" : "5h" };

	// The window rolled over since Codex last recorded it, so the old
	// percentage would be a confident-looking lie. Show nothing instead.
	if (chosen.stale) return { label: chosen.label, note: STALE_NOTE };

	return {
		label: chosen.label,
		// Codex reports percent *used*; its own UI counts down. Match that, so
		// the tile and the Codex app never disagree.
		percentRemaining: 100 - chosen.usedPercent,
		windowMinutes: chosen.windowMinutes,
		resetsAt: chosen.resetsAt,
	};
}

/**
 * Nothing has been read yet this session: the tile is waiting, not unavailable.
 * `cliOk` is undefined until the CLI has been consulted at least once.
 */
function isPending(snapshot: CodexSnapshot, hasReading: boolean, choice: WindowChoice): boolean {
	return !hasReading && !choice.note && snapshot.cliOk === undefined;
}

export function renderMetric(snapshot: CodexSnapshot, metric: Metric): string {
	if (metric === "activity") return renderActivity(snapshot);

	const choice = pickWindow(snapshot, metric);
	if (metric === "usage-5h" || metric === "usage-weekly") {
		return renderUsage({
			windowLabel: choice.label,
			percentRemaining: choice.percentRemaining,
			note: choice.note,
			pending: isPending(snapshot, choice.percentRemaining !== undefined, choice),
		});
	}

	return renderReset({
		windowLabel: choice.label,
		resetsAt: choice.resetsAt,
		windowMinutes: choice.windowMinutes,
		note: choice.note,
		pending: isPending(snapshot, choice.resetsAt !== undefined, choice),
	});
}
