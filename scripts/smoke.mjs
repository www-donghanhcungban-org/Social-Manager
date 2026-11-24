// Smoke test sau deploy (WF-REL-007, OPS-DEPLOY-004). Chạy trên URL thật:
//   node scripts/smoke.mjs https://xw.example.vn [phiên-bản-mong-đợi]
// Thoát 0 khi mọi kiểm tra đạt; khác 0 và liệt kê kiểm tra hỏng → người/pipeline lùi (RUNBOOK §Rollback).
// Kiểm: sống, sẵn sàng (CSDL), phiên bản khớp tag, header bảo mật, trang đăng nhập, metrics đóng với người ngoài.
const REQUIRED_HEADERS = [
  "content-security-policy",
  "strict-transport-security",
  "x-content-type-options",
];

export async function smoke(base, expectVersion, fetchImpl = fetch) {
  const url = (p) => new URL(p, base).toString();
  const results = [];
  const check = async (name, fn) => {
    try {
      const msg = await fn();
      results.push({ name, ok: msg === undefined || msg === true, msg });
    } catch (e) {
      results.push({
        name,
        ok: false,
        msg: e instanceof Error ? e.message : "lỗi",
      });
    }
  };
  const get = (p, init) =>
    fetchImpl(url(p), {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      ...init,
    });

  await check("liveness /api/health/live = 200", async () => {
    const r = await get("/api/health/live");
    return r.status === 200 || `status ${r.status}`;
  });
  await check("readiness /api/health = 200 và status ok", async () => {
    const r = await get("/api/health");
    const b = await r.json().catch(() => ({}));
    if (r.status !== 200 || b.status !== "ok")
      return `status ${r.status}, body ${JSON.stringify(b)}`;
    return true;
  });
  if (expectVersion) {
    await check(`phiên bản = ${expectVersion}`, async () => {
      const b = await (await get("/api/health")).json().catch(() => ({}));
      return (
        b.version === expectVersion || `version ${b.version ?? "(không có)"}`
      );
    });
  }
  await check("trang đăng nhập trả 200 kèm header bảo mật", async () => {
    const r = await get("/login");
    if (r.status !== 200) return `status ${r.status}`;
    const missing = REQUIRED_HEADERS.filter((h) => !r.headers.has(h));
    return missing.length === 0 || `thiếu header: ${missing.join(", ")}`;
  });
  await check(
    "trang trong /app chưa đăng nhập không lộ nội dung (chuyển hướng, 401, hoặc vỏ chưa có dữ liệu)",
    async () => {
      const r = await get("/app/account");
      if ([301, 302, 303, 307, 308, 401].includes(r.status)) return true;
      // Next.js stream vỏ "Đang tải" rồi chuyển hướng phía client: trạng thái 200 nhưng không có nội dung riêng.
      const body = r.status === 200 ? await r.text() : "";
      return (
        (r.status === 200 && !body.includes("Tải dữ liệu của tôi")) ||
        `status ${r.status}`
      );
    },
  );
  await check("/api/metrics đóng với người không có Bearer", async () => {
    const r = await get("/api/metrics");
    return [401, 403, 404].includes(r.status) || `status ${r.status}`;
  });
  return results;
}

import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [base, version] = process.argv.slice(2);
  if (!base || !/^https?:\/\//.test(base)) {
    console.error("dùng: node scripts/smoke.mjs <URL> [phiên-bản]");
    process.exit(2);
  }
  const results = await smoke(base, version);
  for (const r of results)
    console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : ` — ${r.msg}`}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
