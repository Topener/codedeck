import fs from "node:fs/promises";

import * as esbuild from "esbuild";

const MANIFEST = "com.topener.codexdeck.sdPlugin/manifest.json";

/** The three things that can be built, keyed by the flag that selects them. */
const TARGETS = {
	probe: { entry: "src/probe.ts", out: "build/probe.js" },
	preview: { entry: "src/preview.ts", out: "build/preview.js" },
	plugin: { entry: "src/plugin.ts", out: "com.topener.codexdeck.sdPlugin/bin/plugin.js" },
};

const flags = new Set(process.argv.slice(2));
const watch = flags.has("--watch");
/** A release build minifies and takes the plugin out of Node debug mode. */
const release = flags.has("--release");

function selectTarget() {
	if (flags.has("--probe")) return TARGETS.probe;
	if (flags.has("--preview")) return TARGETS.preview;
	return TARGETS.plugin;
}

const target = selectTarget();
const isPlugin = target === TARGETS.plugin;

/** @type {import("esbuild").BuildOptions} */
const options = {
	entryPoints: [target.entry],
	outfile: target.out,
	bundle: true,
	platform: "node",
	target: "node20",
	format: "esm",
	minify: release,
	sourcemap: watch ? "inline" : false,
	// @elgato/streamdeck ships CJS deps that reference these ESM-missing globals.
	banner: {
		js: [
			"import { createRequire as __createRequire } from 'node:module';",
			"import { fileURLToPath as __fileURLToPath } from 'node:url';",
			"import { dirname as __pathDirname } from 'node:path';",
			"const require = __createRequire(import.meta.url);",
			"const __filename = __fileURLToPath(import.meta.url);",
			"const __dirname = __pathDirname(__filename);",
		].join("\n"),
	},
};

/**
 * `Nodejs.Debug` opens an inspector port. That belongs in development, not in
 * a plugin someone installs, so it is rewritten rather than kept in two files.
 */
async function setDebug(enabled) {
	const manifest = JSON.parse(await fs.readFile(MANIFEST, "utf8"));
	const next = enabled ? "enabled" : "disabled";
	if (manifest.Nodejs?.Debug === next) return;

	manifest.Nodejs.Debug = next;
	await fs.writeFile(MANIFEST, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
}

if (watch) {
	const ctx = await esbuild.context(options);
	await ctx.watch();
	console.log("watching...");
} else {
	if (isPlugin) await setDebug(!release);
	await esbuild.build(options);
	if (isPlugin) {
		console.log(`built ${target.out}${release ? " (release: minified, debug off)" : ""}`);
	}
}
