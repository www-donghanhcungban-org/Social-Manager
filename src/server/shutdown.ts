/**
 * Tắt êm (ARC-RES-009, BE-REL-004). Khi nhận SIGTERM/SIGINT:
 *  1. đánh dấu `draining` → `/api/health` trả 503 ngay (readiness lỗi, bộ cân bằng tải ngừng gửi request mới);
 *  2. dừng worker nền êm (đợi job đang chạy xong tới hạn `graceMs`; job chưa xong được pg-boss trả lại hàng đợi) rồi
 *     đóng pool CSDL — việc đó nằm trong `stopWorkers`;
 *  3. KHÔNG gọi `process.exit` ở đây: máy chủ Next tự đóng cổng, đợi request đang chạy xong rồi thoát (start-server.js);
 *     gọi exit sớm sẽ cắt request dở. Chỉ có đồng hồ an toàn: quá `graceMs + HARD_EXIT_EXTRA_MS` thì thoát mã 1.
 * Hạn tổng phải nhỏ hơn `stop_grace_period` của orchestrator (docker-compose.yml: 40 giây).
 */
let draining = false;

export const isDraining = () => draining;
/** Chỉ cho test: đưa trạng thái về ban đầu. */
export function resetDrainingForTest() {
  draining = false;
}

export const DEFAULT_GRACE_MS = 25_000;
export const HARD_EXIT_EXTRA_MS = 5_000;

export interface ShutdownDeps {
  /** Dừng êm worker nền và đóng pool; có thể trả ngay khi không có worker. */
  stopWorkers: () => Promise<void>;
  log: {
    info(msg: string, f?: Record<string, unknown>): void;
    error(msg: string, f?: Record<string, unknown>): void;
  };
  exit: (code: number) => void;
  graceMs?: number;
}

export function createShutdown({
  stopWorkers,
  log,
  exit,
  graceMs = DEFAULT_GRACE_MS,
}: ShutdownDeps) {
  let started: Promise<void> | undefined;

  return {
    /** Gọi nhiều lần (SIGTERM rồi SIGINT) chỉ chạy một lần. */
    trigger(signal: string): Promise<void> {
      if (started) return started;
      draining = true;
      log.info("nhận tín hiệu tắt, ngừng nhận việc mới", { signal });
      const hard = setTimeout(() => {
        log.error("tắt êm quá hạn, thoát cưỡng bức", { graceMs });
        exit(1);
      }, graceMs + HARD_EXIT_EXTRA_MS);
      hard.unref();
      started = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            stopWorkers(),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, graceMs);
            }),
          ]);
          log.info("đã dừng worker nền và đóng kết nối");
        } catch (error) {
          log.error("lỗi khi tắt êm", { error });
        } finally {
          clearTimeout(timer);
        }
      })();
      return started;
    },
  };
}
