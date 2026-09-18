/** The actions that appear in the Stream Deck sidebar, one per metric. */
import { action } from "@elgato/streamdeck";

import { MetricAction, type StatusSettings } from "./metric-action.js";
import type { Metric } from "./tile-content.js";

@action({ UUID: "com.topener.codexdeck.activity" })
export class ActivityAction extends MetricAction {
	protected readonly metric = "activity" as const;
}

@action({ UUID: "com.topener.codexdeck.usage-5h" })
export class Usage5hAction extends MetricAction {
	protected readonly metric = "usage-5h" as const;
}

@action({ UUID: "com.topener.codexdeck.usage-weekly" })
export class UsageWeeklyAction extends MetricAction {
	protected readonly metric = "usage-weekly" as const;
}

@action({ UUID: "com.topener.codexdeck.reset-5h" })
export class Reset5hAction extends MetricAction {
	protected readonly metric = "reset-5h" as const;
}

@action({ UUID: "com.topener.codexdeck.reset-weekly" })
export class ResetWeeklyAction extends MetricAction {
	protected readonly metric = "reset-weekly" as const;
}

/**
 * The original all-in-one tile, kept so keys placed before the split keep
 * working. It is hidden from the sidebar; new keys come from the five above.
 */
@action({ UUID: "com.topener.codexdeck.status" })
export class LegacyStatusAction extends MetricAction {
	protected readonly metric = "activity" as const;

	protected override metricFor(settings: StatusSettings): Metric {
		return settings.metric ?? "activity";
	}
}
