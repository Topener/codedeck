/** Finding a `codex` binary that actually works. */
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const VERSION_TIMEOUT_MS = 5000;

/**
 * Checked in order. `codex` on PATH is listed early but is not trusted: the npm
 * package can install a launcher whose vendored binary is missing, so every
 * candidate must prove itself with `--version` before being used.
 */
function candidates(configured?: string): string[] {
	const home = os.homedir();
	const paths = [
		configured,
		process.env["CODEX_BIN"],
		"codex",
		"/Applications/Codex.app/Contents/Resources/codex",
		path.join(home, "Applications/Codex.app/Contents/Resources/codex"),
		"/opt/homebrew/bin/codex",
		"/usr/local/bin/codex",
	];
	return paths.filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
}

/** A working binary prints `codex-cli <version>` and exits 0. */
async function versionOf(bin: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(bin, ["--version"], { timeout: VERSION_TIMEOUT_MS });
		return /codex-cli\s+(\S+)/.exec(stdout)?.[1];
	} catch {
		return undefined;
	}
}

export interface ResolvedCli {
	bin: string;
	version: string;
}

export async function resolveCli(configured?: string): Promise<ResolvedCli | undefined> {
	for (const bin of candidates(configured)) {
		const version = await versionOf(bin);
		if (version) return { bin, version };
	}
	return undefined;
}
