import { processEnv } from "../config/env";
import { createLogger, type Logger } from "./logger";

export function defaultLogger(): Logger {
  const env = processEnv();
  return createLogger({
    service: "x-workspace",
    version: env.npm_package_version ?? "0.0.0",
    env: env.NODE_ENV ?? "development",
  });
}

/**
 * Handler lỗi toàn cục (BASE-ERR-002): promise bị từ chối không ai bắt thì ghi log rồi để tiến trình
 * chạy tiếp (Next vẫn phục vụ được); ngoại lệ không bắt được thì ghi log FATAL rồi thoát mã 1 để
 * trình giám sát khởi động lại, không chạy tiếp ở trạng thái không xác định.
 */
export function installProcessHandlers(
  target: Pick<NodeJS.Process, "on" | "exit"> = process,
  log: Logger = defaultLogger(),
) {
  target.on("unhandledRejection", (reason) => {
    log.error("unhandled promise rejection", { error: reason });
  });
  target.on("uncaughtException", (err) => {
    log.fatal("uncaught exception", { error: err });
    target.exit(1);
  });
}
