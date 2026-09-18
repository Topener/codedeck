import fs from "node:fs/promises";
import path from "node:path";

/** Read at most `maxBytes` from the end of a file, aligned to a line break. */
export async function readTail(file: string, maxBytes: number): Promise<string> {
	const handle = await fs.open(file, "r");
	try {
		const { size } = await handle.stat();
		const start = Math.max(0, size - maxBytes);
		const buf = Buffer.alloc(Math.min(size, maxBytes));
		await handle.read(buf, 0, buf.length, start);
		const text = buf.toString("utf8");
		// A partial first line would fail to parse; drop it unless we read from 0.
		return start === 0 ? text : text.slice(text.indexOf("\n") + 1);
	} finally {
		await handle.close();
	}
}

export function parseJsonLines<T = unknown>(text: string): T[] {
	const out: T[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		try {
			out.push(JSON.parse(trimmed) as T);
		} catch {
			// Truncated or mid-write line — the next poll will pick it up.
		}
	}
	return out;
}

export interface FileEntry {
	path: string;
	mtimeMs: number;
}

/** Recursively list files matching `test`, newest first. Missing dirs yield []. */
export async function listFiles(
	root: string,
	test: (name: string) => boolean,
	opts: { maxDepth?: number; newerThanMs?: number } = {},
): Promise<FileEntry[]> {
	const { maxDepth = 6, newerThanMs } = opts;
	const out: FileEntry[] = [];

	async function walk(dir: string, depth: number): Promise<void> {
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (depth < maxDepth) await walk(full, depth + 1);
			} else if (entry.isFile() && test(entry.name)) {
				try {
					const stat = await fs.stat(full);
					if (newerThanMs !== undefined && stat.mtimeMs < newerThanMs) continue;
					out.push({ path: full, mtimeMs: stat.mtimeMs });
				} catch {
					// Raced with a delete.
				}
			}
		}
	}

	await walk(root, 0);
	out.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return out;
}

export function basenameOf(dir?: string): string | undefined {
	if (!dir) return undefined;
	const base = path.basename(dir);
	return base === "" ? undefined : base;
}
