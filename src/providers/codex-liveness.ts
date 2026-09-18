/**
 * Which rollout files a process still holds open.
 *
 * A session waiting on an approval writes nothing, so mtime cannot tell it
 * apart from one that died — but the writer keeps the file open, and that is
 * visible to `lsof`.
 *
 * This answers "is this thread still open in Codex", not "is it busy": the
 * desktop app holds every open tab's rollout, including days-old ones. It is
 * the right gate for "is this session still real", not for "is it active".
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CACHE_MS = 15_000;
const LSOF_TIMEOUT_MS = 5000;

const cache = new Map<string, { at: number; live: boolean }>();

/** `lsof -F pn` prints one field per line; the ones we want start with `n`. */
function openPathsIn(stdout: string): Set<string> {
	const paths = stdout
		.split("\n")
		.filter((line) => line.startsWith("n"))
		.map((line) => line.slice(1));
	return new Set(paths);
}

async function runLsof(files: string[]): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("lsof", ["-F", "pn", "--", ...files], { timeout: LSOF_TIMEOUT_MS });
		return stdout;
	} catch (err) {
		// lsof exits non-zero when any argument is not open, having still
		// reported the ones that are — that output is the answer, not an error.
		const failure = err as { stdout?: string; code?: unknown };
		if (typeof failure.stdout === "string" && failure.code !== "ENOENT") return failure.stdout;
		return undefined;
	}
}

/**
 * Returns undefined when liveness could not be established at all (no `lsof`,
 * or a permissions refusal) — callers fall back to the files' own recency.
 */
export async function liveWriters(files: string[]): Promise<Map<string, boolean> | undefined> {
	const now = Date.now();
	const result = new Map<string, boolean>();
	const unknown: string[] = [];

	for (const file of files) {
		const cached = cache.get(file);
		if (cached && now - cached.at < CACHE_MS) result.set(file, cached.live);
		else unknown.push(file);
	}
	if (unknown.length === 0) return result;

	// One lsof for every candidate; spawning per file would dominate the tick.
	const stdout = await runLsof(unknown);
	if (stdout === undefined) return undefined;

	const open = openPathsIn(stdout);
	for (const file of unknown) {
		const live = open.has(file);
		cache.set(file, { at: now, live });
		result.set(file, live);
	}
	return result;
}
