/** Shared vocabulary between the provider, the monitor and the renderers. */

/**
 * Ordered worst-first. `worst()` relies on this order when aggregating several
 * sessions onto one tile: the most attention-worthy state wins.
 */
export type Activity = "needs-input" | "working" | "idle" | "offline";

const ACTIVITY_RANK: Record<Activity, number> = {
	"needs-input": 0,
	working: 1,
	idle: 2,
	offline: 3,
};

export function worst(a: Activity, b: Activity): Activity {
	return ACTIVITY_RANK[a] <= ACTIVITY_RANK[b] ? a : b;
}

export type ActivityCounts = Record<Activity, number>;

export interface SessionInfo {
	/** Stable-ish identifier: the Codex thread id. */
	id: string;
	/** Human label, usually derived from the session name or the folder. */
	label: string;
	/** Absolute working directory, when the provider records one. */
	cwd?: string;
	activity: Activity;
	/** Epoch ms of the last state change we could observe. */
	updatedAt: number;
}

/** A quota window as reported by Codex — never estimated. */
export interface UsageWindow {
	/** "5h", "weekly", "monthly", or "14d" / "7h" when the span is unfamiliar. */
	label: string;
	windowMinutes: number;
	usedPercent: number;
	/** Epoch ms when the window rolls over, when known. */
	resetsAt?: number;
	/** Epoch ms of the record this came from. */
	capturedAt: number;
	/**
	 * True once `resetsAt` has passed: the window rolled over after the figure
	 * was captured, so the percentage no longer describes the current window.
	 * Codex only refreshes it when the agent next runs.
	 */
	stale: boolean;
}

export interface CodexSnapshot {
	/** False when Codex's data directory could not be read at all. */
	ok: boolean;
	error?: string;
	activity: Activity;
	sessions: SessionInfo[];
	counts: ActivityCounts;
	/** Real quota windows. */
	windows: UsageWindow[];
	/** Plan name, when Codex tells us one. */
	planType?: string;
	/**
	 * Whether the Codex CLI answered. Undefined when it was not consulted this
	 * tick; false means the tile is showing file-scraped data at best.
	 */
	cliOk?: boolean;
	updatedAt: number;
}

function emptyCounts(): ActivityCounts {
	return { "needs-input": 0, working: 0, idle: 0, offline: 0 };
}

export function emptySnapshot(): CodexSnapshot {
	return {
		ok: false,
		activity: "offline",
		sessions: [],
		counts: emptyCounts(),
		windows: [],
		updatedAt: Date.now(),
	};
}
