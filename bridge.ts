// Cầu nối mỏng giữa ChessNote (chạy trong Worker sandbox của trình duyệt) và
// ai-sidecar/ (tiến trình Node độc lập lo đăng nhập + gọi CLI `claude`).
//
// KHÔNG có logic nghiệp vụ AI ở đây — chỉ đọc cấu hình rồi fetch() sang sidecar.
// `fetch()` trong sandbox này đã bị monkey-patch (client/plugos/worker_runtime.ts)
// để tự đi qua syscall `sandboxFetch.fetch` -> route Rust `/.proxy/<host:port>/...`
// (server/src/handlers/proxy.rs, đã có sẵn, không cần route mới) -> sidecar.
//
// Thư mục `ai/` này TÁI SINH với nội dung hoàn toàn khác `plugs/chess/ai/{index,
// gateway.test}.ts` cũ (đã xoá — code chết/giả của mô hình AI Gateway SaaS 3-tier).
import { config, editor } from "@silverbulletmd/silverbullet/syscalls";

const DEFAULT_SIDECAR_URL = "http://127.0.0.1:3457";

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
      "Nguồn AI cho ChessNote: 'subscription' dùng gói Claude Pro/Max cá nhân qua CLI đăng " +
      "nhập riêng (chỉ hợp lệ cho một người dùng là chính chủ tài khoản — không dùng cho " +
      "nhiều người/production mở ra ngoài), 'api_key' dùng API key trả phí (ANTHROPIC_API_KEY " +
      "đặt trong biến môi trường của ai-sidecar).",
    type: "string",
    enum: ["subscription", "api_key"],
    default: "subscription",
    ui: { category: "AI", label: "Chế độ AI", priority: 1 },
  });
  await config.define("chess.ai.sidecarUrl", {
    description:
      "Địa chỉ ai-sidecar (tiến trình Node độc lập lo đăng nhập + gọi CLI claude).",
    type: "string",
    default: DEFAULT_SIDECAR_URL,
    ui: { category: "AI", label: "Địa chỉ ai-sidecar", priority: 2 },
  });
  await config.define("chess.ai.sidecarToken", {
    description:
      "Token nội bộ để xác thực với ai-sidecar (khớp với biến môi trường AUTH_SIDECAR_TOKEN " +
      "khi chạy sidecar). Không phải API key AI — chỉ là bí mật chia sẻ giữa ChessNote và sidecar.",
    type: "string",
    default: "",
    ui: { category: "AI", label: "Token ai-sidecar", priority: 3 },
  });
  await config.define("chess.ai.model", {
    description:
      "Model CLI dùng để sinh văn bản (AI Coach/Bình luận ván). Mặc định haiku — rẻ, đủ tốt cho " +
      "giải thích ngắn. Đổi sang model mạnh hơn (vd. claude-sonnet-4-5) nếu muốn chất lượng cao " +
      "hơn cho bình luận ván dài, đổi lại tốn nhiều ngân sách gói hơn mỗi lần gọi.",
    type: "string",
    default: "claude-haiku-4-5",
    ui: { category: "AI", label: "Model AI", priority: 4 },
  });
}

export async function aiStatus() {
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
  const mode = await config.get<string>("chess.ai.mode", "subscription");
  const model = await config.get<string>("chess.ai.model", "claude-haiku-4-5");
  const result = await sidecarFetch("/ai/generate", {
    method: "POST",
    body: { prompt, mode, model },
  });
  // Model attribution for Phase 5b (docs/plans/2026-09-11-dbms-sqlite-wasm-tich-hop.md)
  // — the sidecar's /ai/generate response doesn't echo the model back, but
  // the caller (tagging.ts's applyTagSuggestion) needs it to record which
  // model produced a stored AI annotation. Known here (it's what was sent),
  // not worth a sidecar round-trip change for.
  return { ...result, model };
}

const SIDECAR_NOT_RUNNING_HINT =
  'ai-sidecar chưa chạy hoặc không tới được. Mở terminal, vào thư mục "ai-sidecar/" rồi ' +
  'chạy "npx tsx src/server.ts" (nhớ đặt biến môi trường AUTH_SIDECAR_TOKEN khớp với ' +
  '"chess.ai.sidecarToken" trong Configuration Manager).';

/** Command "Chess: Đăng nhập AI" — chạy trọn luồng pipe+regex qua sidecar. */
export async function commandAiLogin() {
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
      'Chưa đăng nhập AI. Chạy lệnh "Chess: Đăng nhập AI" để bắt đầu.',
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
