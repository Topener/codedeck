import streamDeck, {
	type DidReceiveSettingsEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { monitor } from "../monitor.js";
import { toDataUri } from "../render/svg.js";
import type { CodexSnapshot } from "../types.js";
import { type Metric, renderMetric } from "./tile-content.js";

export interface StatusSettings {
	metric?: Metric;
	[key: string]: string | number | boolean | null | undefined;
}

/**
 * Every tile class shares one monitor subscription: the poller is plugin-wide,
 * so subscribing per class would multiply repaints by the number of classes
 * rather than by the number of keys actually on the deck.
 */
const registered = new Set<MetricAction>();
let unsubscribe: (() => void) | undefined;

function keysOnDeck(): boolean {
	return [...registered].some((action) => [...action.actions].length > 0);
}

function repaintAll(snapshot: CodexSnapshot): void {
	for (const action of registered) void action.repaint(snapshot);
}

/**
 * One key = one metric, fixed by which action you dragged out of the sidebar.
 * Everything is display-only; presses are deliberately inert so a tile can sit
 * under your hand without side effects.
 */
export abstract class MetricAction extends SingletonAction<StatusSettings> {
	/** The metric this action always shows. */
	protected abstract readonly metric: Metric;

	/** Legacy tiles override this to keep honouring their saved choice. */
	protected metricFor(_settings: StatusSettings): Metric {
		return this.metric;
	}

	override onWillAppear(ev: WillAppearEvent<StatusSettings>): void {
		registered.add(this);
		unsubscribe ??= monitor.subscribe(repaintAll);
		void this.#paint(ev.action.id, ev.payload.settings, monitor.snapshot);
		monitor.refresh();
	}

	override onWillDisappear(_ev: WillDisappearEvent<StatusSettings>): void {
		// The last key of any kind leaving the deck should stop the polling.
		if (keysOnDeck()) return;
		unsubscribe?.();
		unsubscribe = undefined;
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<StatusSettings>): void {
		void this.#paint(ev.action.id, ev.payload.settings, monitor.snapshot);
		monitor.refresh();
	}

	async repaint(snapshot: CodexSnapshot): Promise<void> {
		for (const key of this.actions) {
			await this.#paint(key.id, await key.getSettings(), snapshot);
		}
	}

	async #paint(id: string, settings: StatusSettings, snapshot: CodexSnapshot): Promise<void> {
		const key = this.actions.find((candidate) => candidate.id === id);
		if (!key) return;

		const svg = renderMetric(snapshot, this.metricFor(settings));
		try {
			await key.setTitle("");
			await key.setImage(toDataUri(svg));
		} catch (err) {
			streamDeck.logger.warn(`failed to paint ${id}: ${(err as Error).message}`);
		}
	}
}
