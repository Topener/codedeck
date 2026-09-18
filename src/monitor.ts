import { readCodex } from "./providers/codex.js";
import { type CodexSnapshot, emptySnapshot, type UsageWindow } from "./types.js";
import { DEFAULT_TUNING, type Tuning } from "./tuning.js";

/**
 * The slice worth surviving a plugin restart. Stream Deck restarts the plugin
 * on wake, on reconnect and on every rebuild; without this the quota tiles
 * would blank for a second or two each time while the CLI is asked again.
 */
export interface CachedState {
	codexWindows?: UsageWindow[];
	codexPlanType?: string;
}

type Listener = (snapshot: CodexSnapshot) => void;

/**
 * One poller for every tile. Actions subscribe rather than reading the disk
 * themselves, so eight tiles cost the same I/O as one.
 */
class Monitor {
	#tuning: Tuning = { ...DEFAULT_TUNING };
	#listeners = new Set<Listener>();
	#timer?: NodeJS.Timeout;
	#running = false;
	#lastLimitsAt = 0;
	/** Last reading good enough to keep showing while the next one is fetched. */
	#cache: CachedState = {};
	#persist?: (cache: CachedState) => void;

	snapshot: CodexSnapshot = emptySnapshot();

	subscribe(listener: Listener): () => void {
		this.#listeners.add(listener);
		this.#startTimer();
		listener(this.snapshot);

		return () => {
			this.#listeners.delete(listener);
			if (this.#listeners.size === 0) this.#stopTimer();
		};
	}

	/**
	 * Settings are read after `connect()`, so a tile can already be polling on
	 * the defaults by the time this arrives; the timer is rebuilt if so.
	 */
	configure(tuning: Tuning): void {
		this.#tuning = tuning;
		if (!this.#timer) return;
		this.#stopTimer();
		this.#startTimer();
	}

	/** Seed from persisted state so the first paint is not empty. */
	hydrate(cache: CachedState): void {
		if (this.#cache.codexWindows) return;
		this.#cache = { ...cache };
		if (!cache.codexWindows?.length) return;

		this.snapshot.windows = cache.codexWindows;
		this.snapshot.planType = cache.codexPlanType;
		this.snapshot.ok = true;
	}

	setPersist(persist: (cache: CachedState) => void): void {
		this.#persist = persist;
	}

	/** Force an immediate refresh (used when a tile appears). */
	refresh(): void {
		void this.#tick();
	}

	#startTimer(): void {
		if (this.#timer) return;
		this.#timer = setInterval(() => void this.#tick(), this.#tuning.pollMs);
		void this.#tick();
	}

	#stopTimer(): void {
		clearInterval(this.#timer);
		this.#timer = undefined;
	}

	/**
	 * A tile must never blank while a slower read is in flight, so the last good
	 * reading is carried forward until a better one arrives. A fresh live read
	 * always wins; a stale file scrape never displaces a figure the CLI gave us.
	 */
	#mergeCache(snapshot: CodexSnapshot): void {
		if (snapshot.cliOk && snapshot.windows.length > 0) {
			this.#cache.codexWindows = snapshot.windows;
			this.#cache.codexPlanType = snapshot.planType;
			return;
		}
		if (!this.#cache.codexWindows?.length) return;

		snapshot.windows = this.#cache.codexWindows;
		snapshot.planType = this.#cache.codexPlanType;
		snapshot.cliOk = true;
	}

	async #tick(): Promise<void> {
		// A slow read must not stack up behind the next interval.
		if (this.#running) return;
		this.#running = true;

		try {
			const now = Date.now();
			// Quota moves far more slowly than activity and each read is a CLI
			// round-trip, so it runs on its own cadence.
			const withLimits = now - this.#lastLimitsAt >= this.#tuning.limitsPollMs;

			const snapshot = await readCodex({
				activeMs: this.#tuning.activeMs,
				withLimits,
				cliPath: this.#tuning.codexBin,
			});
			if (withLimits && snapshot.cliOk) this.#lastLimitsAt = now;

			this.#mergeCache(snapshot);
			this.#persist?.(this.#cache);

			this.snapshot = snapshot;
			for (const listener of this.#listeners) listener(snapshot);
		} catch {
			// Never let a transient read error kill the interval.
		} finally {
			this.#running = false;
		}
	}
}

export const monitor = new Monitor();
