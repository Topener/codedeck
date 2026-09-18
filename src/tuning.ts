/**
 * Poll intervals, and the values a user may have saved before 0.3.3 took the
 * tuning fields off the property inspector. Nothing can set them any more, but
 * anything already in global settings is still honoured.
 */

export interface Tuning {
	/** How often activity is re-read. */
	pollMs: number;
	/**
	 * How often the Codex CLI is asked for quota. Each read is a round-trip to
	 * the CLI and quota moves far more slowly than activity.
	 */
	limitsPollMs: number;
	/**
	 * How recently a *finished* Codex session must have been touched to still
	 * count. Sessions waiting on you are never dropped for age.
	 */
	activeMs: number;
	/** Explicit path to the codex binary, when auto-discovery picks wrong. */
	codexBin?: string;
}

export const DEFAULT_TUNING: Tuning = {
	pollMs: 3000,
	limitsPollMs: 20_000,
	activeMs: 900_000,
};

/**
 * The shape those fields were saved in. The seconds were written by a number
 * input that could hand back a string, so each is re-parsed rather than trusted.
 */
export interface SavedTuning {
	pollSeconds?: string | number | boolean | null;
	codexActiveSeconds?: string | number | boolean | null;
	limitsPollSeconds?: string | number | boolean | null;
	codexBin?: string | number | boolean | null;
}

function seconds(value: unknown): number | undefined {
	const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
	if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) return undefined;
	return parsed;
}

/** Below these the plugin would hammer the disk or the CLI for no visible gain. */
function clampedMs(value: unknown, minSeconds: number, fallbackMs: number): number {
	const parsed = seconds(value);
	return parsed === undefined ? fallbackMs : Math.max(minSeconds, parsed) * 1000;
}

function trimmed(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = value.trim();
	return text === "" ? undefined : text;
}

export function tuningFrom(saved: SavedTuning): Tuning {
	return {
		pollMs: clampedMs(saved.pollSeconds, 1, DEFAULT_TUNING.pollMs),
		activeMs: clampedMs(saved.codexActiveSeconds, 10, DEFAULT_TUNING.activeMs),
		limitsPollMs: clampedMs(saved.limitsPollSeconds, 10, DEFAULT_TUNING.limitsPollMs),
		codexBin: trimmed(saved.codexBin),
	};
}
