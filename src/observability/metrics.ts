/**
 * Metric trong tiến trình, xuất dạng văn bản Prometheus (OPS-OBS-003). Không phụ thuộc thư viện ngoài.
 * - Histogram RED `http.server.request.duration` (giây): nhãn chỉ gồm phương thức, MẪU route (không đường dẫn thật), mã trạng thái.
 * - Counter `llm_tokens_total` theo tenant/feature/model/direction (OPS-COST-003).
 * - Chặn bùng nổ cardinality: mỗi metric tối đa `MAX_SERIES` tổ hợp nhãn; vượt thì gộp vào nhãn `other` thay vì tạo series mới.
 */
export const MAX_SERIES = 500;
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

type Labels = Record<string, string>;

const esc = (v: string) =>
  v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const fmt = (l: Labels) =>
  Object.keys(l)
    .sort()
    .map((k) => `${k}="${esc(l[k]!)}"`)
    .join(",");

export function createMetrics() {
  const hist = new Map<
    string,
    { labels: Labels; counts: number[]; sum: number; n: number }
  >();
  const counters = new Map<string, { labels: Labels; value: number }>();

  function slot<T>(
    map: Map<string, T>,
    labels: Labels,
    make: (l: Labels) => T,
  ): T {
    const key = fmt(labels);
    let s = map.get(key);
    if (!s) {
      if (map.size >= MAX_SERIES) {
        const other = Object.fromEntries(
          Object.keys(labels).map((k) => [k, "other"]),
        );
        const ok = fmt(other);
        s = map.get(ok);
        if (!s) {
          s = make(other);
          map.set(ok, s);
        }
        return s;
      }
      s = make(labels);
      map.set(key, s);
    }
    return s;
  }

  return {
    /** Ghi một request HTTP: `route` PHẢI là mẫu (vd `/api/webhooks/socialapi/[connectionId]`). */
    observeHttp(input: {
      method: string;
      route: string;
      status: number;
      seconds: number;
    }) {
      const labels = {
        "http.request.method": input.method.toUpperCase().slice(0, 10),
        "http.route": input.route.slice(0, 120),
        "http.response.status_code": String(input.status),
      };
      const s = slot(hist, labels, (l) => ({
        labels: l,
        counts: BUCKETS.map(() => 0),
        sum: 0,
        n: 0,
      }));
      BUCKETS.forEach((b, i) => {
        if (input.seconds <= b) s.counts[i]!++;
      });
      s.sum += input.seconds;
      s.n++;
    },

    addLlmTokens(input: {
      tenant: string;
      feature: string;
      model: string;
      direction: "input" | "output";
      tokens: number;
    }) {
      if (!Number.isFinite(input.tokens) || input.tokens < 0) return;
      const labels = {
        tenant: input.tenant,
        feature: input.feature,
        model: input.model.slice(0, 80),
        direction: input.direction,
      };
      slot(counters, labels, (l) => ({ labels: l, value: 0 })).value +=
        input.tokens;
    },

    seriesCount: () => hist.size + counters.size,

    render(): string {
      const out: string[] = [
        "# TYPE http_server_request_duration_seconds histogram",
      ];
      for (const s of hist.values()) {
        const base = fmt(s.labels);
        BUCKETS.forEach((b, i) =>
          out.push(
            `http_server_request_duration_seconds_bucket{${base},le="${b}"} ${s.counts[i]}`,
          ),
        );
        out.push(
          `http_server_request_duration_seconds_bucket{${base},le="+Inf"} ${s.n}`,
          `http_server_request_duration_seconds_sum{${base}} ${s.sum}`,
          `http_server_request_duration_seconds_count{${base}} ${s.n}`,
        );
      }
      out.push("# TYPE llm_tokens_total counter");
      for (const s of counters.values())
        out.push(`llm_tokens_total{${fmt(s.labels)}} ${s.value}`);
      return `${out.join("\n")}\n`;
    },
  };
}

export type Metrics = ReturnType<typeof createMetrics>;

/** Một registry dùng chung trong tiến trình. */
export const metrics: Metrics = createMetrics();
