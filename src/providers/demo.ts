import { CAPABILITIES, PLATFORMS, type SocialProvider } from "./types";

/** Provider chạy thử: khai mọi khả năng trên mọi nền tảng để dùng app khi chưa có khoá thật. */
export function createDemoProvider(): SocialProvider {
  return {
    id: "demo",
    label: "Chế độ demo",
    support: Object.fromEntries(PLATFORMS.map((p) => [p, CAPABILITIES])),
  };
}
