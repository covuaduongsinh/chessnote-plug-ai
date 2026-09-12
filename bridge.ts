// Cầu nối mỏng giữa ChessNote (chạy trong Worker sandbox của trình duyệt) và
// nguồn AI thật — 1 trong 2 chế độ độc lập nhau (`chess.ai.mode`):
//
// - "subscription": qua ai-sidecar/ (tiến trình Node độc lập lo đăng nhập +
//   gọi CLI `claude`, dùng gói thuê bao Claude Pro/Max cá nhân). `fetch()`
//   trong sandbox này đã bị monkey-patch (client/plugos/worker_runtime.ts) để
//   tự đi qua syscall `sandboxFetch.fetch` -> route Rust
//   `/.proxy/<host:port>/...` (server/src/handlers/proxy.rs) -> sidecar.
// - "api_key" (Phase 3 của docs/plans/2026-09-12-lam-plug-co-vua-cai-dat-doc-lap.md):
//   gọi thẳng api.anthropic.com bằng API key người dùng tự nhập — KHÔNG cần
//   ai-sidecar/ chạy, chỉ cần `requiredPermissions: [fetch]` đã khai báo
//   trong chess-ai.plug.yaml (cơ chế `/.proxy/` xử lý CORS y hệt, là chuẩn
//   upstream SilverBullet, không riêng gì sidecar). Đây là chế độ làm cho
//   chess-ai cài độc lập được lên SilverBullet gốc, không cần chạy thêm tiến
//   trình Node nào — "subscription" qua sidecar vẫn giữ nguyên như tùy chọn
//   nâng cao cho ai muốn dùng gói thuê bao cá nhân.
//
// KHÔNG có logic nghiệp vụ AI nào khác ở đây ngoài chọn đường gọi theo mode.
//
// Thư mục `ai/` này TÁI SINH với nội dung hoàn toàn khác `plugs/chess/ai/{index,
// gateway.test}.ts` cũ (đã xoá — code chết/giả của mô hình AI Gateway SaaS 3-tier).
import { config, editor } from "@silverbulletmd/silverbullet/syscalls";

const DEFAULT_SIDECAR_URL = "http://127.0.0.1:3457";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

async function sidecarConfig(): Promise<{ url: string; token: string }> {
  const url = await config.get<string>(
    "chess.ai.sidecarUrl",
    DEFAULT_SIDECAR_URL,
  );
  const token = await config.get<string>("chess.ai.sidecarToken", "");
  return { url, token };
}

async function sidecarFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<any> {
  const { url, token } = await sidecarConfig();
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${url}${path}`, {
      method: init.method || "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok && json.ok === undefined) {
      return { ok: false, error: `sidecar trả HTTP ${res.status}` };
    }
    return json;
  } catch (e) {
    return {
      ok: false,
      error: `không gọi được ai-sidecar (đã chạy chưa? ${url}): ${(e as Error).message}`,
    };
  }
}

/** Init hook (editor:init) — đăng ký công tắc chế độ AI vào Configuration Manager. */
export async function initAiConfig() {
  await config.define("chess.ai.mode", {
    description:
      "Nguồn AI cho ChessNote: 'api_key' gọi thẳng api.anthropic.com bằng API key tự nhập bên " +
      "dưới — KHÔNG cần cài/chạy ai-sidecar, dùng ngay khi cài chess-ai độc lập lên SilverBullet " +
      "gốc. 'subscription' dùng gói Claude Pro/Max cá nhân qua ai-sidecar (tiến trình Node riêng, " +
      "phải tự chạy thêm) — tuỳ chọn nâng cao cho ai muốn dùng gói thuê bao thay vì trả theo " +
      "API key, chỉ hợp lệ cho một người dùng là chính chủ tài khoản.",
    type: "string",
    enum: ["api_key", "subscription"],
    default: "api_key",
    ui: { category: "AI", label: "Chế độ AI", priority: 1 },
  });
  await config.define("chess.ai.apiKey", {
    description:
      "API key Anthropic (bắt đầu bằng 'sk-ant-...', lấy tại console.anthropic.com) — dùng khi " +
      "'Chế độ AI' = 'api_key'. Trả phí theo lượng dùng thực tế, độc lập với gói thuê bao Claude " +
      "Pro/Max. Lưu dạng chữ thường trong CONFIG.md của Space này — không chia sẻ file đó công khai.",
    type: "string",
    default: "",
    ui: { category: "AI", label: "API key Anthropic", priority: 2 },
  });
  await config.define("chess.ai.sidecarUrl", {
    description:
      "Địa chỉ ai-sidecar (tiến trình Node độc lập lo đăng nhập + gọi CLI claude) — chỉ dùng khi " +
      "'Chế độ AI' = 'subscription'.",
    type: "string",
    default: DEFAULT_SIDECAR_URL,
    ui: { category: "AI", label: "Địa chỉ ai-sidecar", priority: 3 },
  });
  await config.define("chess.ai.sidecarToken", {
    description:
      "Token nội bộ để xác thực với ai-sidecar (khớp với biến môi trường AUTH_SIDECAR_TOKEN " +
      "khi chạy sidecar). Không phải API key AI — chỉ là bí mật chia sẻ giữa ChessNote và sidecar. " +
      "Chỉ dùng khi 'Chế độ AI' = 'subscription'.",
    type: "string",
    default: "",
    ui: { category: "AI", label: "Token ai-sidecar", priority: 4 },
  });
  await config.define("chess.ai.model", {
    description:
      "Model dùng để sinh văn bản (AI Coach/Bình luận ván). Ở chế độ 'api_key' PHẢI là model ID " +
      "đầy đủ, hợp lệ với API Anthropic (vd. 'claude-haiku-4-5-20251001', 'claude-sonnet-5') — " +
      "xem danh sách mới nhất tại docs.anthropic.com. Ở chế độ 'subscription', CLI tự hiểu cả bí " +
      "danh ngắn (vd. 'claude-haiku-4-5'). Mặc định haiku — rẻ, đủ tốt cho giải thích ngắn.",
    type: "string",
    default: "claude-haiku-4-5-20251001",
    ui: { category: "AI", label: "Model AI", priority: 5 },
  });
}

/** Direct call to api.anthropic.com — the "api_key" mode's entire implementation, no sidecar involved. */
async function directApiAsk(
  prompt: string,
  model: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const apiKey = await config.get<string>("chess.ai.apiKey", "");
  if (!apiKey) {
    return {
      ok: false,
      error:
        'Chưa nhập API key Anthropic. Vào Configuration Manager, đặt "chess.ai.apiKey" ' +
        "(lấy tại console.anthropic.com), hoặc đổi \"chess.ai.mode\" sang \"subscription\" " +
        "nếu muốn dùng ai-sidecar + gói thuê bao cá nhân thay vì API key.",
    };
  }
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const json = await res.json().catch(() => ({}) as any);
    if (!res.ok) {
      return {
        ok: false,
        error: `Anthropic API lỗi HTTP ${res.status}: ${
          json?.error?.message || "không rõ nguyên nhân"
        }`,
      };
    }
    const text = json?.content?.[0]?.text;
    if (typeof text !== "string") {
      return { ok: false, error: "Phản hồi từ Anthropic API không có nội dung văn bản." };
    }
    return { ok: true, text };
  } catch (e) {
    return {
      ok: false,
      error: `Không gọi được api.anthropic.com: ${(e as Error).message}`,
    };
  }
}

export async function aiStatus() {
  const mode = await config.get<string>("chess.ai.mode", "api_key");
  if (mode === "api_key") {
    const apiKey = await config.get<string>("chess.ai.apiKey", "");
    return apiKey
      ? { ok: true, connected: true, account: "API key" }
      : { ok: true, connected: false };
  }
  return sidecarFetch("/auth/status");
}

export async function aiAuthStart() {
  return sidecarFetch("/auth/start", { method: "POST" });
}

export async function aiAuthCode(code: string) {
  return sidecarFetch("/auth/code", { method: "POST", body: { code } });
}

export async function aiAuthLogout() {
  return sidecarFetch("/auth/logout", { method: "POST" });
}

export async function aiAuthCancel() {
  return sidecarFetch("/auth/cancel", { method: "POST" });
}

export async function aiAsk(prompt: string) {
  const mode = await config.get<string>("chess.ai.mode", "api_key");
  const model = await config.get<string>(
    "chess.ai.model",
    "claude-haiku-4-5-20251001",
  );
  const result =
    mode === "api_key"
      ? await directApiAsk(prompt, model)
      : await sidecarFetch("/ai/generate", {
          method: "POST",
          body: { prompt, mode, model },
        });
  // Model attribution for Phase 5b (docs/plans/2026-09-11-dbms-sqlite-wasm-tich-hop.md)
  // — neither directApiAsk() nor the sidecar's /ai/generate response echoes
  // the model back, but the caller (tagging.ts's applyTagSuggestion) needs it
  // to record which model produced a stored AI annotation. Known here (it's
  // what was sent), not worth changing either call to round-trip it back.
  return { ...result, model };
}

const SIDECAR_NOT_RUNNING_HINT =
  'ai-sidecar chưa chạy hoặc không tới được. Mở terminal, vào thư mục "ai-sidecar/" rồi ' +
  'chạy "npx tsx src/server.ts" (nhớ đặt biến môi trường AUTH_SIDECAR_TOKEN khớp với ' +
  '"chess.ai.sidecarToken" trong Configuration Manager).';

/** Command "Chess: Đăng nhập AI" — chạy trọn luồng pipe+regex qua sidecar (chỉ áp dụng chế độ "subscription"; "api_key" không có bước đăng nhập, chỉ cần nhập key vào Configuration Manager). */
export async function commandAiLogin() {
  const mode = await config.get<string>("chess.ai.mode", "api_key");
  if (mode === "api_key") {
    await editor.flashNotification(
      'Chế độ "api_key" không cần đăng nhập — vào Configuration Manager, đặt "chess.ai.apiKey" ' +
        "bằng API key lấy tại console.anthropic.com.",
      "info",
    );
    return;
  }
  const status = await aiStatus();
  if (!status.ok) {
    await editor.flashNotification(
      `${status.error || "Lỗi không rõ"}. ${SIDECAR_NOT_RUNNING_HINT}`,
      "error",
    );
    return;
  }
  if (status.connected) {
    await editor.flashNotification(
      `Đã đăng nhập AI rồi (tài khoản: ${status.account || "không rõ"}).`,
      "info",
    );
    return;
  }

  const start = await aiAuthStart();
  if (!start.ok || !start.url) {
    await editor.flashNotification(
      `Không bắt đầu được đăng nhập: ${start.error || "không rõ lỗi"}`,
      "error",
    );
    return;
  }

  await editor.openUrl(start.url, false);
  const code = await editor.prompt(
    "Đã mở trang đăng nhập Claude trong tab mới. Đăng nhập xong, dán mã xác nhận vào đây:",
  );
  if (!code) {
    await aiAuthCancel();
    await editor.flashNotification("Đã huỷ đăng nhập AI.", "info");
    return;
  }

  const result = await aiAuthCode(code);
  if (result.ok) {
    await editor.flashNotification("Đăng nhập AI thành công.", "info");
  } else {
    await editor.flashNotification(
      `Đăng nhập thất bại: ${result.error || "không rõ lỗi"}`,
      "error",
    );
  }
}

/** Command "Chess: Đăng xuất AI". */
export async function commandAiLogout() {
  const mode = await config.get<string>("chess.ai.mode", "api_key");
  if (mode === "api_key") {
    await editor.flashNotification(
      'Chế độ "api_key" không có phiên đăng nhập — xoá giá trị "chess.ai.apiKey" trong ' +
        "Configuration Manager nếu muốn tắt AI.",
      "info",
    );
    return;
  }
  const confirmed = await editor.confirm(
    "Đăng xuất tài khoản Claude khỏi ChessNote AI sidecar?",
  );
  if (!confirmed) return;
  const result = await aiAuthLogout();
  await editor.flashNotification(
    result.ok
      ? "Đã đăng xuất AI."
      : `Đăng xuất thất bại: ${result.detail || result.error || "không rõ lỗi"}`,
    result.ok ? "info" : "error",
  );
}

/** Command "Chess: Trạng thái AI". */
export async function commandAiStatus() {
  const mode = await config.get<string>("chess.ai.mode", "api_key");
  const status = await aiStatus();
  if (!status.ok) {
    await editor.flashNotification(
      `${status.error || "Lỗi không rõ"}. ${SIDECAR_NOT_RUNNING_HINT}`,
      "error",
    );
    return;
  }
  if (status.unknown) {
    await editor.flashNotification(
      "Không xác định được trạng thái AI (sidecar không phản hồi kịp).",
      "warning",
    );
    return;
  }
  if (!status.connected) {
    await editor.flashNotification(
      mode === "api_key"
        ? 'Chưa có API key. Vào Configuration Manager, đặt "chess.ai.apiKey" để bắt đầu.'
        : 'Chưa đăng nhập AI. Chạy lệnh "Chess: Đăng nhập AI" để bắt đầu.',
      "info",
    );
    return;
  }
  const staleNote = status.stale ? " (dữ liệu cũ, chưa hỏi lại được CLI)" : "";
  await editor.flashNotification(
    `Đã đăng nhập AI: ${status.account || "không rõ tài khoản"}${staleNote}`,
    "info",
  );
}
