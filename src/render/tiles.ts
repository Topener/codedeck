/** The five key images, one per metric. */
import type { Activity, CodexSnapshot } from "../types.js";
import { centred, circle, COLORS, keyImage, levelFill, SIZE } from "./svg.js";

const ACTIVITY_LABEL: Record<Activity, string> = {
	"needs-input": "NEEDS YOU",
	working: "WORKING",
	idle: "IDLE",
	offline: "NO SESSION",
};

/** Quota fills the key with what is left, and goes red as that runs out. */
function gaugeColor(percentRemaining: number): string {
	if (percentRemaining <= 10) return COLORS.error;
	if (percentRemaining <= 25) return COLORS["needs-input"];
	return COLORS.working;
}

/** A label wider than this has to drop a size to clear the tile edges. */
function labelSize(label: string): number {
	return label.length > 7 ? 17 : 21;
}

/** A percentage: four digits ("100%") plus a sign still has to clear the edges. */
function percentSize(reading: string): number {
	if (reading.length >= 5) return 38;
	if (reading.length === 4) return 42;
	return 46;
}

/** A countdown carries more glyphs than a percentage ("5d19h"), so it sits smaller. */
function countdownSize(countdown: string): number {
	if (countdown.length >= 5) return 34;
	if (countdown.length === 4) return 40;
	return 46;
}

/** Long enough to read from a metre away: `4h23m`, `5d19h`. */
export function formatCountdown(resetsAt?: number): string {
	if (!resetsAt) return "";

	const ms = resetsAt - Date.now();
	if (ms <= 0) return "due";

	const totalMinutes = Math.floor(ms / 60_000);
	if (totalMinutes < 60) return `${totalMinutes}m`;

	const hours = Math.floor(totalMinutes / 60);
	if (hours < 24) {
		const minutes = totalMinutes % 60;
		return minutes === 0 ? `${hours}h` : `${hours}h${minutes}m`;
	}

	const days = Math.floor(hours / 24);
	const remainingHours = hours % 24;
	return remainingHours === 0 ? `${days}d` : `${days}d${remainingHours}h`;
}

/**
 * Drawn when there is no reading to show. `pending` is the difference between
 * "still looking" and "looked, and there is nothing" — a tile must not cry
 * unavailable while it is simply waiting for the CLI to answer.
 */
function renderPlaceholder(windowLabel: string, note: string | undefined, pending: boolean): string {
	return keyImage(
		centred(70, pending ? "..." : "--", { size: 40, fill: COLORS.dim, weight: 800 }) +
			centred(100, windowLabel, { size: 21, fill: COLORS.dim, weight: 700 }) +
			centred(124, note ?? (pending ? "reading..." : "unavailable"), {
				size: 13,
				fill: COLORS.dim,
				weight: 500,
			}),
	);
}

/** "NEEDS YOU" needs two lines; the other labels fit on one. */
function activityLabel(label: string, color: string): string {
	const style = { size: 26, fill: color, weight: 800 };
	const words = label.split(" ");
	if (words.length === 1) return centred(88, label, style);
	return centred(74, words[0]!, style) + centred(100, words.slice(1).join(" "), style);
}

function sessionCount(snapshot: CodexSnapshot): string {
	const { counts } = snapshot;
	const active = counts.working + counts["needs-input"] + counts.idle;
	if (active === 0) return "";
	return centred(128, `${active} session${active === 1 ? "" : "s"}`, {
		size: 15,
		fill: COLORS.dim,
		weight: 500,
	});
}

export function renderActivity(snapshot: CodexSnapshot): string {
	const color = snapshot.ok ? COLORS[snapshot.activity] : COLORS.error;
	const label = snapshot.ok ? ACTIVITY_LABEL[snapshot.activity] : "NO DATA";

	return keyImage(circle(SIZE / 2, 36, 8, color) + activityLabel(label, color) + sessionCount(snapshot));
}

export interface UsageTile {
	/** The window this tile is about — "5h", "weekly". */
	windowLabel: string;
	/** Percentage of the window still available, as Codex counts it. */
	percentRemaining?: number;
	/** Shown instead of the window label when something needs explaining. */
	note?: string;
	/** True before the first successful read. */
	pending?: boolean;
}

export function renderUsage(tile: UsageTile): string {
	const { windowLabel, percentRemaining, note, pending = false } = tile;
	if (percentRemaining === undefined) return renderPlaceholder(windowLabel, note, pending);

	const color = gaugeColor(percentRemaining);
	const reading =
		percentRemaining >= 10 ? `${Math.round(percentRemaining)}%` : `${percentRemaining.toFixed(1)}%`;
	// Nearly empty means almost no fill left to carry the colour, so the
	// number takes it over — otherwise "out of quota" reads as a blank key.
	const readingFill = percentRemaining <= 25 ? color : COLORS.text;

	return keyImage(
		centred(76, reading, { size: percentSize(reading), fill: readingFill, weight: 800 }) +
			centred(108, windowLabel, { size: labelSize(windowLabel), fill: COLORS.text, weight: 700, opacity: 0.75 }) +
			(note ? centred(132, note, { size: 12, fill: COLORS.dim, weight: 500 }) : ""),
		levelFill(percentRemaining / 100, color),
	);
}

export interface ResetTile {
	windowLabel: string;
	resetsAt?: number;
	/** Window length, used to fill the tile by how much of it is left. */
	windowMinutes?: number;
	note?: string;
	pending?: boolean;
}

/** The countdown on its own key, so the quota tile can stay uncluttered. */
export function renderReset(tile: ResetTile): string {
	const { windowLabel, resetsAt, windowMinutes, note, pending = false } = tile;

	const countdown = formatCountdown(resetsAt);
	if (!countdown) return renderPlaceholder(windowLabel, note, pending);

	const remainingMs = (resetsAt ?? 0) - Date.now();
	const elapsedFraction = windowMinutes ? remainingMs / (windowMinutes * 60_000) : 0;

	return keyImage(
		centred(76, countdown, { size: countdownSize(countdown), fill: COLORS.text, weight: 800 }) +
			centred(108, windowLabel, { size: labelSize(windowLabel), fill: COLORS.text, weight: 700, opacity: 0.75 }) +
			centred(132, "to reset", { size: 12, fill: COLORS.dim, weight: 500 }),
		levelFill(elapsedFraction, COLORS.offline),
	);
}
