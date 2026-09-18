/**
 * Reads Codex's local state into one snapshot: activity from the rollout files,
 * quota from the CLI (with the rollout files as a cold-start stand-in).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { basenameOf, type FileEntry, listFiles } from "../fsutil.js";
import {
	type Activity,
	type CodexSnapshot,
	emptySnapshot,
	type SessionInfo,
	type UsageWindow,
	worst,
} from "../types.js";
import { liveWriters } from "./codex-liveness.js";
import { rolloutWindows, type RpcRateLimits, rpcWindows } from "./codex-limits.js";
import {
	classifyRollout,
	rateLimitsIn,
	readRolloutTail,
	type RolloutRecord,
	type RolloutState,
	threadIdFromPath,
	timestampOf,
} from "./codex-rollout.js";
import { appServer } from "./codex-rpc.js";

const CODEX_DIR = process.env["CODEX_HOME"] ?? path.join(os.homedir(), ".codex");
const SESSIONS_DIR = path.join(CODEX_DIR, "sessions");

const WEEK_MS = 7 * 24 * 3600_000;
/** Rollouts that could plausibly still be running. */
const CANDIDATE_FILES = 8;
/** Give up on a blocked session this old when liveness cannot be checked. */
const BLOCKED_MAX_MS = 8 * 3600_000;

/**
 * Whether the CLI has ever answered in this process. Once it has, the quota
 * records scraped from rollout files are never shown again: they are a snapshot
 * taken during some earlier session, so they disagree with the live figure by a
 * point or two, and a tile that alternated between the two sources would appear
 * to flip between two readings of the same window.
 */
let cliEverAnswered = false;

export interface CodexOptions {
	/**
	 * How recently a *finished* session must have been touched to still count.
	 * Sessions waiting on you ignore this entirely — see `isStillInPlay`.
	 */
	activeMs: number;
	/** Ask the CLI for quota this tick. Cheap to skip; quota moves slowly. */
	withLimits: boolean;
	/** Explicit path to the codex binary, when auto-discovery picks wrong. */
	cliPath?: string;
}

interface Candidate {
	file: FileEntry;
	state: RolloutState;
}

async function listRollouts(): Promise<FileEntry[]> {
	const isRollout = (name: string) => name.startsWith("rollout-") && name.endsWith(".jsonl");
	return listFiles(SESSIONS_DIR, isRollout, { maxDepth: 4, newerThanMs: Date.now() - WEEK_MS });
}

interface ScrapedQuota {
	windows: UsageWindow[];
	/** Epoch ms of the record the windows came from. */
	at: number;
}

/**
 * Quota is account-wide, so the freshest record across every rollout wins.
 * Only a fallback: the CLI is asked for the live figures once the scan is done.
 */
function absorbQuota(current: ScrapedQuota, records: RolloutRecord[], fallbackAt: number): ScrapedQuota {
	let best = current;
	for (const record of records) {
		const limits = rateLimitsIn(record);
		if (!limits) continue;

		const at = timestampOf(record, fallbackAt);
		// Written as a negation so an unparseable timestamp (NaN) loses.
		if (!(at > best.at)) continue;

		const windows = rolloutWindows(limits, at);
		if (windows.length > 0) best = { windows, at };
	}
	return best;
}

interface RolloutScan {
	candidates: Candidate[];
	quota: ScrapedQuota;
}

async function scanRollouts(files: FileEntry[], now: number): Promise<RolloutScan> {
	const candidates: Candidate[] = [];
	let quota: ScrapedQuota = { windows: [], at: 0 };

	for (const file of files) {
		try {
			const records = await readRolloutTail(file.path);
			quota = absorbQuota(quota, records, file.mtimeMs);
			candidates.push({ file, state: classifyRollout(records, now) });
		} catch {
			// Unreadable or raced with a delete; the next poll will pick it up.
		}
	}
	return { candidates, quota };
}

/**
 * A session waiting on you is never dropped for age: the wait is silent by
 * construction, so elapsed time says nothing about whether it still needs you.
 * A finished session is only worth counting while it is still in play — Codex
 * keeps days-old threads open, and those should not pad the session count.
 *
 * `live` is undefined when liveness could not be checked at all, in which case
 * the file's own recency has to stand in.
 */
function isStillInPlay(candidate: Candidate, live: boolean | undefined, now: number, activeMs: number): boolean {
	const age = now - candidate.file.mtimeMs;
	if (live === false) return false;

	if (candidate.state.blocked) return live !== undefined || age <= BLOCKED_MAX_MS;
	return age <= activeMs;
}

function toSession(candidate: Candidate): SessionInfo {
	const id = threadIdFromPath(candidate.file.path);
	return {
		id,
		label: basenameOf(candidate.state.cwd) ?? id.slice(0, 8),
		cwd: candidate.state.cwd,
		activity: candidate.state.activity,
		updatedAt: candidate.file.mtimeMs,
	};
}

interface CodexReading {
	sessions: SessionInfo[];
	quota: ScrapedQuota;
}

async function readSessions(files: FileEntry[], now: number, activeMs: number): Promise<CodexReading> {
	const { candidates, quota } = await scanRollouts(files.slice(0, CANDIDATE_FILES), now);
	// One lsof for everything whose liveness could matter.
	const live = await liveWriters(candidates.map((candidate) => candidate.file.path));

	const sessions = candidates
		.filter((candidate) => isStillInPlay(candidate, live?.get(candidate.file.path), now, activeMs))
		.map(toSession);

	return { sessions, quota };
}

function summarise(snapshot: CodexSnapshot, sessions: SessionInfo[]): void {
	snapshot.sessions = sessions;
	snapshot.activity = sessions.reduce<Activity>((acc, session) => worst(acc, session.activity), "offline");
	for (const session of sessions) snapshot.counts[session.activity] += 1;
}

/**
 * Quota from the CLI overrides anything scraped from rollouts: the files only
 * hold what was true while a session ran, which can be days old.
 */
async function applyLiveQuota(snapshot: CodexSnapshot, now: number, cliPath?: string): Promise<void> {
	appServer.setBin(cliPath);
	try {
		const reply = await appServer.call<{ rateLimits?: RpcRateLimits }>("account/rateLimits/read");
		const limits = reply.rateLimits;
		const windows = limits ? rpcWindows(limits, now) : [];
		if (windows.length > 0) {
			snapshot.windows = windows;
			snapshot.planType = limits?.planType ?? undefined;
			cliEverAnswered = true;
		}
		snapshot.cliOk = true;
	} catch (err) {
		// Fall back to whatever the rollouts held, flagged stale as before.
		snapshot.cliOk = false;
		snapshot.error = `codex CLI: ${(err as Error).message}`;
	}
}

export async function readCodex(opts: CodexOptions): Promise<CodexSnapshot> {
	const snapshot = emptySnapshot();

	try {
		await fs.access(SESSIONS_DIR);
	} catch {
		snapshot.error = "~/.codex/sessions not found";
		return snapshot;
	}
	snapshot.ok = true;

	const now = Date.now();
	const { sessions, quota } = await readSessions(await listRollouts(), now, opts.activeMs);
	summarise(snapshot, sessions);

	// Only ever a cold-start stand-in. Once the CLI has answered, the live
	// figure (carried forward by the monitor between reads) is the only one.
	snapshot.windows = cliEverAnswered ? [] : quota.windows;
	if (opts.withLimits) await applyLiveQuota(snapshot, now, opts.cliPath);

	snapshot.updatedAt = now;
	return snapshot;
}
