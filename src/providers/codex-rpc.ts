/**
 * Talks to `codex app-server` over JSON-RPC on stdio.
 *
 * This is the only source of *current* Codex quota. The rate-limit records in
 * rollout files are written only while a session runs, so they go stale as soon
 * as you stop using Codex; the app-server answers from the service.
 *
 * One long-lived child process is reused for every call — spawning the CLI per
 * poll costs roughly a second.
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import { resolveCli, type ResolvedCli } from "./codex-cli.js";

const REQUEST_TIMEOUT_MS = 10_000;
/** After a failed start, wait this long before trying to spawn again. */
const RESPAWN_BACKOFF_MS = 30_000;

const CLIENT_INFO = {
	name: "codex-deck",
	title: "Codex Deck for Stream Deck",
	version: "0.1.0",
};

interface Pending {
	resolve: (value: unknown) => void;
	reject: (err: Error) => void;
	timer: NodeJS.Timeout;
}

interface RpcMessage {
	id?: number;
	result?: unknown;
	error?: { message?: string };
}

function encode(message: Record<string, unknown>): string {
	return `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`;
}

export class CodexAppServer {
	#child?: ChildProcessWithoutNullStreams;
	#starting?: Promise<void>;
	#pending = new Map<number, Pending>();
	#buffer = "";
	#nextId = 1;
	#lastFailureAt = 0;
	#cli?: ResolvedCli;
	#configuredBin?: string;

	/** Set when the last attempt failed, for display on the tile. */
	lastError?: string;

	/** Changing the binary drops the connection so the next call respawns. */
	setBin(bin?: string): void {
		if (bin === this.#configuredBin) return;
		this.#configuredBin = bin;
		this.#cli = undefined;
		this.stop();
	}

	async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		await this.#ensureStarted();
		return this.#request<T>(method, params);
	}

	stop(): void {
		const child = this.#child;
		this.#child = undefined;
		this.#starting = undefined;
		this.#rejectPending(new Error("app-server stopped"));
		child?.kill();
	}

	#rejectPending(reason: Error): void {
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(reason);
		}
		this.#pending.clear();
	}

	async #ensureStarted(): Promise<void> {
		if (this.#child) return;
		if (Date.now() - this.#lastFailureAt < RESPAWN_BACKOFF_MS) {
			throw new Error(this.lastError ?? "codex app-server unavailable");
		}
		this.#starting ??= this.#start().finally(() => {
			this.#starting = undefined;
		});
		await this.#starting;
	}

	async #start(): Promise<void> {
		try {
			this.#cli ??= await resolveCli(this.#configuredBin);
			if (!this.#cli) throw new Error("codex CLI not found");

			this.#child = this.#spawn(this.#cli.bin);
			await this.#handshake(this.#child);
			this.lastError = undefined;
		} catch (err) {
			this.#fail((err as Error).message);
			throw err;
		}
	}

	/** read-only sandbox, never prompt: this connection only reads status. */
	#spawn(bin: string): ChildProcessWithoutNullStreams {
		const child = spawn(bin, ["-s", "read-only", "-a", "never", "app-server"], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.#onData(chunk));
		child.on("error", (err) => this.#fail(err.message));
		child.on("exit", (code) => this.#fail(`app-server exited (${code})`));
		return child;
	}

	async #handshake(child: ChildProcessWithoutNullStreams): Promise<void> {
		await this.#request("initialize", { clientInfo: CLIENT_INFO });
		child.stdin.write(encode({ method: "initialized", params: {} }));
	}

	#fail(reason: string): void {
		this.#lastFailureAt = Date.now();
		this.lastError = reason;
		this.stop();
	}

	#onData(chunk: string): void {
		this.#buffer += chunk;
		let index: number;
		while ((index = this.#buffer.indexOf("\n")) >= 0) {
			const line = this.#buffer.slice(0, index).trim();
			this.#buffer = this.#buffer.slice(index + 1);
			if (line) this.#onLine(line);
		}
	}

	#onLine(line: string): void {
		let message: RpcMessage;
		try {
			message = JSON.parse(line) as RpcMessage;
		} catch {
			return;
		}

		// Server notifications have no id; nothing here subscribes to them yet.
		if (typeof message.id !== "number") return;
		const pending = this.#pending.get(message.id);
		if (!pending) return;

		this.#pending.delete(message.id);
		clearTimeout(pending.timer);
		if (message.error) pending.reject(new Error(message.error.message ?? "rpc error"));
		else pending.resolve(message.result);
	}

	#request<T>(method: string, params: Record<string, unknown>): Promise<T> {
		const child = this.#child;
		if (!child) return Promise.reject(new Error("app-server not running"));
		const id = this.#nextId++;

		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error(`${method} timed out`));
			}, REQUEST_TIMEOUT_MS);
			this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
			child.stdin.write(encode({ id, method, params }));
		});
	}
}

export const appServer = new CodexAppServer();
