# chessnote-plug-ai

A standalone SilverBullet plug: AI move/game annotation ("coach"),
multi-game trend analysis, opening statistics, semantic + full-text QA over
your games, and AI tag/summary suggestion — extracted from
[ChessNote](https://github.com/covuaduongsinh/chessnote) (a chess-focused
SilverBullet fork).

## Install

**Install 3 dependencies first, in this order** (each is its own standalone
plug — see its README for its own install URL):

1. [`chessnote-plug-engine`](https://github.com/covuaduongsinh/chessnote-plug-engine)
2. [`chessnote-plug-db`](https://github.com/covuaduongsinh/chessnote-plug-db)
3. [`chessnote-plug-core`](https://github.com/covuaduongsinh/chessnote-plug-core) (which itself needs `chessnote-plug-themes` first)

Then, in SilverBullet, run the **"Library: Install"** command and paste this
URL:

```
https://raw.githubusercontent.com/covuaduongsinh/chessnote-plug-ai/main/chess-ai-library.md
```

This pulls in `chess-ai.plug.js` (the compiled plug) along with the library
page. After installing, run **"Plugs: Reload"** if it doesn't load
automatically.

Then set an API key: open Configuration Manager and set `chess.ai.apiKey`
to an Anthropic API key (from [console.anthropic.com](https://console.anthropic.com)).
That's it — AI features work immediately, no extra process to run.

## AI modes

- **`chess.ai.mode = "api_key"` (default)** — calls `api.anthropic.com`
  directly through SilverBullet's own request-proxy mechanism (the same one
  any plug uses for outbound HTTP — nothing custom). Just needs
  `chess.ai.apiKey` set. Billed per-token by Anthropic, independent of any
  subscription.
- **`chess.ai.mode = "subscription"` (advanced, optional)** — routes through
  a separate `ai-sidecar` Node process that drives a personal Claude Pro/Max
  subscription via the `claude` CLI instead of paying per API call. Only
  makes sense for a single self-hosting user (not multi-user/production).
  See `plugs/chess-ai/bridge.ts` in the main
  [chessnote](https://github.com/covuaduongsinh/chessnote) repo's
  `ai-sidecar/` directory to set this up; set `chess.ai.sidecarUrl` /
  `chess.ai.sidecarToken` to match.

## What it provides

- AI Coach: per-move explanation + whole-game commentary, grounded only in
  real Arasan engine numbers (never lets the model see raw PGN and
  hallucinate moves).
- Multi-game trend analysis (accuracy/blunder trends across many reviewed
  games).
- Opening statistics (win/loss/draw by ECO code — pure SQL, no AI).
- Q&A over your game library (semantic search when embeddings exist, FTS5
  full-text fallback otherwise).
- One-click tag + summary suggestion for a single game.

## Development

Source lives here **and** as `plugs/chess-ai/` in the main
[chessnote](https://github.com/covuaduongsinh/chessnote) monorepo, which is
where `chess-ai.plug.yaml` actually gets compiled during ChessNote's own
build (`npm run build:plugs`). This repo's `chess-ai.plug.js` is a
manually-published snapshot — after changing the source here (or there),
rebuild and re-copy the compiled `.plug.js` to keep this repo's install URL
up to date.

To compile it yourself from this repo directly, you'll need SilverBullet's
plug-compile tooling (see [Plug
Development](https://silverbullet.md/Plugs/Development) docs) pointed at
`chess-ai.plug.yaml`, with the 3 dependency plugs above already installed in
the target Space (this plug only calls their syscalls by name at runtime —
it doesn't need their source to build).
