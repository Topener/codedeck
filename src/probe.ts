/**
 * `npm run probe` — print exactly what the plugin reads, without Stream Deck.
 *
 * The file formats this plugin depends on are internal to the Codex CLI and can
 * change without notice, so this is the first thing to run when a tile shows
 * something unexpected.
 */
import { resolveCli } from "./providers/codex-cli.js";
import { readCodex } from "./providers/codex.js";
import { appServer } from "./providers/codex-rpc.js";
import type { CodexSnapshot, SessionInfo, UsageWindow } from "./types.js";

/** Probe runs against whatever is live right now, so sessions can be brief. */
const ACTIVE_MS = 120_000;

function when(ms: number | undefined): string {
	if (!ms) return "-";
	const delta = Math.round((Date.now() - ms) / 1000);
	return delta < 0 ? `in ${-delta}s` : `${delta}s ago`;
}

function describeSession(session: SessionInfo): string {
	const where = session.cwd ? `  (${session.cwd})` : "";
	return `  - ${session.activity.padEnd(11)} ${session.label}${where}  updated ${when(session.updatedAt)}`;
}

function describeWindow(window: UsageWindow): string {
	const left = `${(100 - window.usedPercent).toFixed(0)}% left (${window.usedPercent.toFixed(1)}% used)`;
	const resets = window.resetsAt ? `, resets ${when(window.resetsAt)}` : "";
	const stale = window.stale ? "  [STALE - window already rolled over]" : "";
	return `  - ${window.label.padEnd(8)} ${left}${resets}, captured ${when(window.capturedAt)}${stale}`;
}

function report(snapshot: CodexSnapshot): void {
	console.log("\n=== CODEX ===");
	console.log(`readable: ${snapshot.ok}${snapshot.error ? `  (${snapshot.error})` : ""}`);
	if (snapshot.cliOk !== undefined) {
		const plan = snapshot.planType ? `  (plan: ${snapshot.planType})` : "";
		console.log(`cli answered: ${snapshot.cliOk}${plan}`);
	}
	console.log(`aggregate activity: ${snapshot.activity}`);

	if (snapshot.sessions.length === 0) {
		console.log("sessions: none live");
	} else {
		console.log("sessions:");
		for (const session of snapshot.sessions) console.log(describeSession(session));
	}

	if (snapshot.windows.length === 0) {
		console.log("quota windows: none reported");
	} else {
		console.log("quota windows (reported by the provider):");
		for (const window of snapshot.windows) console.log(describeWindow(window));
	}
}

const cli = await resolveCli();
console.log(cli ? `codex CLI: ${cli.bin} (${cli.version})` : "codex CLI: not found");

const started = Date.now();
report(await readCodex({ activeMs: ACTIVE_MS, withLimits: true }));
console.log(`\nscanned in ${Date.now() - started}ms`);
appServer.stop();
