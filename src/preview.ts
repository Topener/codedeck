/**
 * `npm run preview` — write build/preview.html with every tile variant, drawn
 * from this machine's real data plus synthetic states that are hard to catch
 * live (needs-input, a nearly-exhausted quota). Opening the file is much faster
 * than re-deploying to hardware to check a layout change.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { readCodex } from "./providers/codex.js";
import { appServer } from "./providers/codex-rpc.js";
import { renderActivity, renderReset, renderUsage } from "./render/tiles.js";
import { type CodexSnapshot, emptySnapshot } from "./types.js";

const ACTIVE_MS = 120_000;
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

interface Tile {
	caption: string;
	svg: string;
}

function synthetic(patch: Partial<CodexSnapshot>): CodexSnapshot {
	return { ...emptySnapshot(), ok: true, ...patch };
}

function liveTiles(snapshot: CodexSnapshot): Tile[] {
	const window = snapshot.windows.find((candidate) => !candidate.stale);
	return [
		{ caption: "Codex · activity (live)", svg: renderActivity(snapshot) },
		{
			caption: "Codex · quota (live)",
			svg: renderUsage({
				windowLabel: window?.label ?? "5h",
				percentRemaining: window ? 100 - window.usedPercent : undefined,
			}),
		},
		{
			caption: "Codex · reset (live)",
			svg: renderReset({
				windowLabel: window?.label ?? "5h",
				resetsAt: window?.resetsAt,
				windowMinutes: window?.windowMinutes,
			}),
		},
	];
}

function syntheticTiles(): Tile[] {
	const needsInput = synthetic({
		activity: "needs-input",
		counts: { "needs-input": 1, working: 0, idle: 1, offline: 0 },
	});

	return [
		{ caption: "Codex · needs input", svg: renderActivity(needsInput) },
		{ caption: "Codex · no session", svg: renderActivity(synthetic({ activity: "offline" })) },
		{ caption: "Codex · unreadable", svg: renderActivity(emptySnapshot()) },
		{ caption: "Codex · 59% left", svg: renderUsage({ windowLabel: "5h", percentRemaining: 59 }) },
		{ caption: "Codex · 7% left", svg: renderUsage({ windowLabel: "5h", percentRemaining: 7 }) },
		{ caption: "Codex · first read pending", svg: renderUsage({ windowLabel: "5h", pending: true }) },
		{ caption: "Codex · quota stale", svg: renderUsage({ windowLabel: "5h", note: "stale - run codex" }) },
		{
			caption: "Codex · weekly reset",
			svg: renderReset({
				windowLabel: "weekly",
				resetsAt: Date.now() + 5.8 * DAY_MS,
				windowMinutes: 10080,
			}),
		},
	];
}

function page(tiles: Tile[]): string {
	const figures = tiles
		.map((tile) => `<figure>${tile.svg}<figcaption>${tile.caption}</figcaption></figure>`)
		.join("\n");

	return `<!doctype html>
<meta charset="utf-8">
<title>Codex Deck tiles</title>
<style>
  body { background:#0d1117; color:#c9d1d9; font:14px/1.5 -apple-system,Helvetica,Arial,sans-serif; padding:28px; }
  h1 { font-size:18px; font-weight:700; margin:0 0 4px; }
  p.sub { color:#8b949e; margin:0 0 24px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:22px; }
  figure { margin:0; }
  figure svg { width:144px; height:144px; display:block; }
  figcaption { color:#8b949e; font-size:12px; margin-top:8px; }
</style>
<h1>Codex Deck tiles</h1>
<p class="sub">Generated ${new Date().toLocaleString()} — live tiles read this machine, the rest are synthetic states.</p>
<div class="grid">
${figures}
</div>
`;
}

const snapshot = await readCodex({ activeMs: ACTIVE_MS, withLimits: true });

const out = path.join(process.cwd(), "build", "preview.html");
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, page([...liveTiles(snapshot), ...syntheticTiles()]), "utf8");
console.log(out);
appServer.stop();
