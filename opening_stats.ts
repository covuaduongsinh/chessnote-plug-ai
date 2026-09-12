// AI: Thống kê khai cuộc — Phase 1 của kế hoạch bổ sung DBMS
// (docs/plans/2026-09-11-dbms-sqlite-wasm-tich-hop.md). Không dùng AI: mục
// đích là chứng minh sức mạnh SQL thật (lọc theo người chơi/ngày + GROUP BY)
// mà Object Index (full-scan trong bộ nhớ) không làm được, chạy tức thời vì
// không cần engine Arasan.
import {
  chessSql,
  editor,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";

type OpeningStatRow = Awaited<
  ReturnType<typeof chessSql.queryOpeningStats>
>[number];

const PLAYER_NAME_CONFIG_KEY = "chess.playerName";

function isValidIsoDate(s: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())
  );
}

function formatDateForPageName(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  // Không dùng ":" — không hợp lệ trong tên file trên Windows.
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

export function renderOpeningStatsMarkdown(
  playerName: string,
  sinceDate: string | undefined,
  rows: OpeningStatRow[],
): string {
  const totalGames = rows.reduce((sum, r) => sum + r.total, 0);
  const totalWins = rows.reduce((sum, r) => sum + r.wins, 0);
  const totalDraws = rows.reduce((sum, r) => sum + r.draws, 0);
  const totalLosses = rows.reduce((sum, r) => sum + r.losses, 0);

  const tableRows = rows
    .map(
      (r) => `| ${r.eco} | ${r.total} | ${r.wins} | ${r.draws} | ${r.losses} |`,
    )
    .join("\n");

  const sinceLine = sinceDate ? `, từ ngày **${sinceDate}**` : "";

  return `# Thống kê khai cuộc — ${playerName}

Gộp theo mã khai cuộc (ECO) trên toàn bộ ván cờ có **${playerName}** cầm quân${sinceLine},
bằng truy vấn SQL (\`GROUP BY\`) thật trên cơ sở dữ liệu SQLite nhúng — không qua AI.

- Tổng số ván: **${totalGames}** (Thắng **${totalWins}** · Hòa **${totalDraws}** · Thua **${totalLosses}**)

| ECO | Tổng | Thắng | Hòa | Thua |
|---|---|---|---|---|
${tableRows || "| _(không có dữ liệu)_ | | | | |"}

---
*Số liệu gộp trực tiếp từ SQLite (client/data/chess_sql_store.ts).*
`;
}

/** Command "Chess: Thống kê khai cuộc". */
export async function commandOpeningStats() {
  // Chỉ đọc mặc định để điền sẵn ô nhập — chưa làm "lưu làm mặc định toàn
  // cục" như piece-set/theme: cơ chế đó chạy hoàn toàn phía client trong
  // iframe widget (postMessage), không áp dụng được cho một lệnh của plug;
  // ghi bền config.set() thật (CONFIG.md) là việc của configuration-manager,
  // ngoài phạm vi bản chứng minh SQL của Phase 1 này.
  const defaultPlayerName = await system.getConfig<string>(
    PLAYER_NAME_CONFIG_KEY,
    "",
  );
  const playerName = await editor.prompt(
    "Tên người chơi (để lọc đúng theo màu quân đã cầm):",
    defaultPlayerName,
  );
  if (!playerName) return;

  const sinceInput = await editor.prompt(
    "Chỉ tính từ ngày (YYYY-MM-DD), để trống để tính toàn bộ:",
    "",
  );
  let sinceDate: string | undefined;
  if (sinceInput) {
    if (!isValidIsoDate(sinceInput)) {
      await editor.flashNotification(
        `Ngày "${sinceInput}" không hợp lệ (cần dạng YYYY-MM-DD) — bỏ qua bộ lọc ngày.`,
        "warning",
      );
    } else {
      sinceDate = sinceInput;
    }
  }

  const rows = await chessSql.queryOpeningStats({ playerName, sinceDate });
  if (rows.length === 0) {
    await editor.flashNotification(
      `Không tìm thấy ván nào có "${playerName}" cầm quân` +
        (sinceDate ? ` từ ${sinceDate}.` : "."),
      "info",
    );
    return;
  }

  const reportName = `Chess/Thống kê khai cuộc/${formatDateForPageName(new Date())}`;
  await space.writePage(
    reportName,
    renderOpeningStatsMarkdown(playerName, sinceDate, rows),
  );
  await editor.navigate(reportName);
  await editor.flashNotification("Đã tạo báo cáo thống kê khai cuộc.", "info");
}
