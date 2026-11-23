/**
 * Chạy một lần khi server Next.js khởi động: cấu hình thiếu/sai thì thoát mã 1 và nêu tên biến
 * (BASE-CFG-002), thay vì chạy rồi lỗi ở request đầu tiên. Bỏ qua khi `next build` (build không cần bí mật).
 * Đồng thời gắn handler lỗi toàn cục của tiến trình (BASE-ERR-002) và bật worker nền (hàng đợi pg-boss).
 */
export async function register() {
  const { loadEnvOrExit, processEnv, shouldValidateAtStartup } =
    await import("./src/config/env");
  if (!shouldValidateAtStartup(processEnv())) return;
  const cfg = loadEnvOrExit(processEnv());
  const { installProcessHandlers, defaultLogger } =
    await import("./src/log/process");
  installProcessHandlers();
  let stop: (() => Promise<void>) | undefined;
  try {
    const { startWorkers } = await import("./src/jobs/start");
    stop = await startWorkers(cfg);
  } catch (error) {
    // Worker không lên được không được làm sập web, nhưng phải nhìn thấy rõ trong log.
    defaultLogger().error("không khởi động được worker nền", { error });
  }
  // Tắt êm (ARC-RES-009): readiness lỗi → dừng worker êm → đóng pool; máy chủ Next tự đợi request đang chạy rồi thoát,
  // nên ở đây không gọi process.exit (xem src/server/shutdown.ts).
  const { createShutdown } = await import("./src/server/shutdown");
  const shutdown = createShutdown({
    stopWorkers: stop ?? (async () => {}),
    log: defaultLogger(),
    exit: (code) => process.exit(code),
  });
  process.once("SIGTERM", () => void shutdown.trigger("SIGTERM"));
  process.once("SIGINT", () => void shutdown.trigger("SIGINT"));
}
