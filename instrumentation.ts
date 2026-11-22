/**
 * Chạy một lần khi server Next.js khởi động: cấu hình thiếu/sai thì thoát mã 1 và nêu tên biến
 * (BASE-CFG-002), thay vì chạy rồi lỗi ở request đầu tiên. Bỏ qua khi `next build` (build không cần bí mật).
 * Đồng thời gắn handler lỗi toàn cục của tiến trình (BASE-ERR-002).
 */
export async function register() {
  const { loadEnvOrExit, processEnv, shouldValidateAtStartup } =
    await import("./src/config/env");
  if (!shouldValidateAtStartup(processEnv())) return;
  loadEnvOrExit(processEnv());
  const { installProcessHandlers } = await import("./src/log/process");
  installProcessHandlers();
}
