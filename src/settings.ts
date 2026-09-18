/**
 * Stream Deck's global settings, which the plugin uses for two things: the last
 * good quota reading, and the tuning values a user may have saved before 0.3.3
 * took those fields off the property inspector.
 *
 * Caching matters because Stream Deck restarts the plugin on wake, on reconnect
 * and on every rebuild — without it the quota tiles would show `--` for a
 * second or two each time, while the CLI is asked again.
 */
import streamDeck from "@elgato/streamdeck";

import { type CachedState, monitor } from "./monitor.js";
import { type SavedTuning, tuningFrom } from "./tuning.js";

/** Writing settings echoes back as an event, so writes are coalesced. */
const WRITE_DELAY_MS = 5000;

interface GlobalSettings extends SavedTuning {
	/** `CachedState`, serialised. */
	cache?: string;
	[key: string]: string | number | boolean | null | undefined;
}

function parseCache(raw: unknown): CachedState {
	if (typeof raw !== "string") return {};
	try {
		const cached = JSON.parse(raw) as CachedState;
		// A window cached before its reset time describes a window that has since
		// rolled over; mark it so the tile does not present it as current.
		for (const window of cached.codexWindows ?? []) {
			window.stale = window.resetsAt !== undefined && window.resetsAt < Date.now();
		}
		return cached;
	} catch {
		return {};
	}
}

function persistCacheInto(settings: GlobalSettings): void {
	let pendingWrite: NodeJS.Timeout | undefined;

	monitor.setPersist((cache) => {
		const serialised = JSON.stringify(cache);
		if (serialised === settings.cache) return;

		settings.cache = serialised;
		clearTimeout(pendingWrite);
		pendingWrite = setTimeout(() => void streamDeck.settings.setGlobalSettings(settings), WRITE_DELAY_MS);
	});
}

export async function initGlobalSettings(): Promise<void> {
	const settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();

	monitor.hydrate(parseCache(settings.cache));
	monitor.configure(tuningFrom(settings));
	persistCacheInto(settings);
}
