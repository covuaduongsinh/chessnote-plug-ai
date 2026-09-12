# chessnote-plug-ai

ChessNote's AI features plug: personal Claude Code CLI subscription bridge,
AI move/game annotation ("coach"), multi-game trend analysis, opening
statistics, semantic + full-text QA over the user's games, and AI tag/summary
suggestion.

## ⚠️ Not independently installable

This is a **mirrored source snapshot** of `plugs/chess-ai/` from the main
[chessnote](https://github.com/covuaduongsinh/chessnote) monorepo, kept as a
separate repository for clearer version tracking of this one feature area.

It is **not** a standalone, installable SilverBullet plug:

- It depends on `chessSql`/`chessEmbedding` — custom syscalls backed by an
  embedded SQLite WASM database and a local embedding model, both of which
  exist only in ChessNote's own client build (see `client/data/` in the main
  repo), not in vanilla SilverBullet.
- It calls chess-core (`chess.extractChessGames`, `chess.textExtractKeywords`)
  and chess-engine (`chess.reviewGame`) syscalls.
- It talks to a separate `ai-sidecar/` Node process (Claude Code CLI bridge)
  that also lives in the main repo.
- The actual build (compiling this into a `.plug.js`, registering it in
  `plugs/builtin_plugs.ts`) happens in the main chessnote repo, not here.

To use or modify this code, work in the main
[chessnote](https://github.com/covuaduongsinh/chessnote) repo instead — this
repo exists for reference and history, not standalone development.
