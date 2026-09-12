---
name: Library/chessnote/Chess AI
tags: meta/library
files:
  - chess-ai.plug.js
---
# Chess AI

AI features for ChessNote games: AI Coach (per-move explanation + full-game
commentary, grounded only in real Arasan engine numbers — never lets the
model "see" raw PGN and hallucinate moves), trend analysis across many
games, Q&A over your game library (semantic search or full-text fallback),
and one-click tag/summary suggestions.

Calls Anthropic's API directly (`chess.ai.mode = "api_key"`, the default —
just set `chess.ai.apiKey` in Configuration Manager, no extra process to
run) or, as an advanced opt-in, through a separate `ai-sidecar` Node process
using a personal Claude Pro/Max subscription (`chess.ai.mode =
"subscription"`) — see this repo's README.

**Depends on 3 other plugs, installed first**:
[`chessnote-plug-core`](https://github.com/covuaduongsinh/chessnote-plug-core)
(game/keyword extraction),
[`chessnote-plug-engine`](https://github.com/covuaduongsinh/chessnote-plug-engine)
(game review for AI Coach), and
[`chessnote-plug-db`](https://github.com/covuaduongsinh/chessnote-plug-db)
(search, opening stats, AI annotation storage, embeddings).

Originally built as part of
[ChessNote](https://github.com/covuaduongsinh/chessnote), a chess-focused
SilverBullet fork.

Source: [chessnote-plug-ai](https://github.com/covuaduongsinh/chessnote-plug-ai).
