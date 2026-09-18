# Codex Deck

A Stream Deck plugin that puts the state of your **Codex** sessions on your keys: whether Codex is
waiting on you, whether it is working, how much of your quota is left, and how long until it resets.

Everything is read locally — quota comes from the Codex CLI on your machine, activity from Codex's
own state files. You never enter an API key, and no credentials are touched.

## Install

You need:

- Stream Deck app 6.5 or newer
- Node 20 or newer
- Elgato's CLI: `npm install -g @elgato/cli`
- A working `codex` binary, for the quota and reset tiles

Then build the plugin and install it:

```bash
npm install && npm run pack
```

That writes `build/com.topener.codexdeck.streamDeckPlugin`. Open that file and the Stream Deck app
installs it. The tiles appear in the sidebar under the **Codex Deck** category.

## Using it

Drag the tile you want onto a key. There is nothing to configure, and you can place any tile on as
many keys as you like. Pressing a tile does nothing on purpose, so a key can sit under your hand
without triggering anything.

| Tile | Icon | Shows |
| --- | --- | --- |
| **Codex Activity** | three lamps | Whether Codex needs you, is working, or is idle |
| **Quota — 5h** | upright level, blue | Percentage of the short window still left |
| **Quota — Weekly** | level on its side, purple | Percentage of the weekly window still left |
| **Reset — 5h** | clock, blue | Time until the short window rolls over |
| **Reset — Weekly** | calendar, purple | Time until the weekly window rolls over |

The icons follow one rule: shape says *quota or time*, colour says *short window (blue) or long
window (purple)*.

### Activity

One tile for all your Codex sessions, showing the worst state first. The footer counts live
sessions.

| Tile | Colour | Meaning |
| --- | --- | --- |
| `NEEDS YOU` | amber | At least one session is blocked on you — an approval prompt or a question. It stays amber for as long as it waits, however long that is. |
| `WORKING` | blue | At least one session is mid-turn. |
| `IDLE` | green | The turn is done — shown immediately, with no grace period. |
| `NO SESSION` | grey | Nothing running. |
| `NO DATA` | red | Codex's data directory could not be read. |

A finished session stops being counted 15 minutes after it was last touched. A session waiting on
you is never dropped for age.

### Quota

The whole key is the gauge. It fills from the bottom with what is **available**, so a full key
means full quota and an empty key means none. The number is the percentage **left** — the same
direction Codex itself counts, so the tile and the Codex app always agree — and under it sits the
window it refers to (`5h`, `weekly`).

Blue normally, amber under 25% left, red under 10%. Below 25% the number takes the colour too,
since there is little fill left to carry it.

### Reset

A countdown (`4h23m`, `5d19h`) over the window name, on its own key, filling with how much of the
window is left.

### What the tiles say while they wait

- `...` / `reading...` — nothing has been read yet this session.
- `--` / `unavailable` — no reading could be obtained.
- `stale - run codex` — see [Troubleshooting](#troubleshooting).

A tile never blanks while a slower read is in flight: the last good reading stays on screen until a
better one replaces it. Quota is also saved with the plugin's settings, so it is back on screen
immediately after a Stream Deck restart.

## Where the numbers come from

Activity is inferred from the events Codex writes as a session runs.

Quota is the real, current figure, never an estimate. The plugin keeps one Codex process running —
`codex -s read-only -a never app-server`, in Codex's read-only sandbox with approvals disabled — and
asks it for your account rate limits. The answer carries the window length, the reset time and the
percentage consumed; the tile shows the complement, percent remaining, because that is what Codex
shows you.

Refresh rates: activity every 3 seconds, quota every 20 seconds.

### Finding the codex binary

The quota and reset tiles need a working `codex`. The plugin tries, in order: `$CODEX_BIN`, `codex`
on your `PATH`, `/Applications/Codex.app/Contents/Resources/codex`, then Homebrew and
`/usr/local/bin`. Each candidate has to answer `codex --version` before it is used, so a broken
install on `PATH` is skipped rather than trusted. Set `CODEX_BIN` to override the choice.

### Files it reads

Read-only, always:

- `~/.codex/sessions/<year>/<month>/<day>/rollout-*.jsonl` — Codex lifecycle events, and quota
  figures when the CLI cannot be reached

`CODEX_HOME` and `CODEX_BIN` are honoured if set. Nothing is written outside the plugin's own
Stream Deck settings, and the plugin makes no network calls of its own — the Codex CLI talks to its
own service to answer the quota query.

## Troubleshooting

**A tile shows `stale - run codex`.** The CLI could not be reached, so quota fell back to the
figures in Codex's session files. Those are only written while a session runs, and the window this
one described has already rolled over. Start a Codex session and the tile catches up.

**Quota tiles show `--` / `unavailable`.** The plugin could not find or run `codex`. Run the probe
to see which binary it picked:

```bash
npm run probe
```

The probe prints exactly what the plugin sees, without Stream Deck.

**`spawn … ENOENT` from a codex on your `PATH`.** The npm package `@openai/codex` can install a
launcher whose vendored binary is missing. The plugin falls through to the binary inside Codex.app;
to fix the one on your `PATH`, reinstall with `npm install -g @openai/codex`.

**Something else looks wrong.** The session file formats are internal to the Codex CLI and can
change without notice. `npm run probe` is the fastest way to see whether the plugin is reading what
you expect.

## Development

```bash
streamdeck dev          # one-off: enable Stream Deck developer mode
npm run link            # point Stream Deck at this folder
npm run build           # debug build (unminified, inspector enabled)
npm run restart         # reload after a rebuild
```

`npm run watch` rebuilds on save; `npm run restart` still reloads it.

| Script | Does |
| --- | --- |
| `build` | Debug bundle into the `.sdPlugin` folder, `Nodejs.Debug` on. |
| `release` | Minified bundle, `Nodejs.Debug` off. |
| `pack` | typecheck → icons → release → validate → `.streamDeckPlugin` file. |
| `validate` | Elgato's manifest and asset checks on their own. |
| `probe` | Print what the plugin reads, without Stream Deck. |
| `preview` | Write `build/preview.html` with every tile state, live and synthetic. |

`build` and `release` rewrite `Nodejs.Debug` in the manifest, so the packaged plugin never ships
with an inspector port open.

## AI disclosure

This plugin was built with AI assistance. Claude Code wrote the bulk of the implementation,
icons and documentation, under human direction and review. If you hit something odd, please
open an issue — reports are welcome.
