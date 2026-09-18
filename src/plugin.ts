import streamDeck from "@elgato/streamdeck";

import { initGlobalSettings } from "./settings.js";
import {
	ActivityAction,
	LegacyStatusAction,
	Reset5hAction,
	ResetWeeklyAction,
	Usage5hAction,
	UsageWeeklyAction,
} from "./actions/tiles.js";

streamDeck.actions.registerAction(new ActivityAction());
streamDeck.actions.registerAction(new Usage5hAction());
streamDeck.actions.registerAction(new UsageWeeklyAction());
streamDeck.actions.registerAction(new Reset5hAction());
streamDeck.actions.registerAction(new ResetWeeklyAction());
streamDeck.actions.registerAction(new LegacyStatusAction());

await streamDeck.connect();
await initGlobalSettings();
