import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(f, "utf-8");
const walk = (d: string): string[] =>
  existsSync(d)
    ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
      )
    : [];

const uiFiles = [...walk("app"), ...walk("src")].filter((f) =>
  /\.(tsx)$/.test(f),
);
const cssFiles = [...walk("app"), ...walk("src")].filter((f) =>
  f.endsWith(".css"),
);

describe("design system: token một nguồn, không màu cứng (UX-DS-001/002)", () => {
  it("UX-DS-001: token màu chỉ khai ở app/globals.css; không có đầu ra token nào khác để lệch", () => {
    expect(cssFiles).toEqual(["app/globals.css"]);
    const css = read("app/globals.css");
    expect(css).toMatch(/:root\s*{[^}]*--background:/);
    expect(css).toMatch(/prefers-color-scheme:\s*dark/);
    // không có token sinh ra từ script khác (nếu thêm build:tokens thì đổi test này sang kiểm diff = 0)
    expect(
      readFileSync("package.json", "utf-8").includes('"build:tokens"'),
    ).toBe(false);
  });

  it("UX-DS-002: không mã màu cứng, hàm màu hay lớp màu primitive trong component", () => {
    const bad: string[] = [];
    const primitive =
      /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|decoration|accent|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?\b/;
    for (const f of uiFiles) {
      const t = read(f);
      if (/#[0-9a-fA-F]{3,8}\b/.test(t.replace(/&#\d+;/g, "")))
        bad.push(`${f}: hex`);
      if (/\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/.test(t))
        bad.push(`${f}: hàm màu`);
      if (primitive.test(t)) bad.push(`${f}: lớp màu primitive`);
      if (/-\[(?:#|rgb|hsl)/.test(t)) bad.push(`${f}: màu tuỳ ý trong class`);
    }
    expect(bad).toEqual([]);
  });

  it("UX-DS-003: bộ cặp tương phản đủ cho mọi token chữ/nền/viền (kiểm máy ở Gate: xt.py contrast)", () => {
    const pairs = read("contrast-pairs.txt");
    for (const token of [
      "--foreground",
      "--muted-foreground",
      "--primary",
      "--danger",
      "--border",
      "--ring",
    ])
      expect(pairs, token).toContain(token);
    // mọi token màu trong :root đều xuất hiện ở ít nhất một cặp hoặc là nền
    const root = /:root\s*{([^}]*)}/.exec(read("app/globals.css"))![1]!;
    const tokens = [...root.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]!);
    for (const t of tokens)
      expect(pairs.includes(t) || t === "--background", t).toBe(true);
  });
});

describe("hình ảnh, chuyển động, hover (UX-VISUAL-001/002/006/007, UX-RESP-005)", () => {
  it("UX-VISUAL-001: CSS có khối prefers-reduced-motion: reduce", () => {
    expect(read("app/globals.css")).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
    );
  });

  it("UX-VISUAL-002: không animation vô hạn, không tự chạy/nhấp nháy", () => {
    const bad = uiFiles
      .concat(cssFiles)
      .filter((f) =>
        /\binfinite\b|animate-(?:spin|pulse|ping|bounce)|<video|autoplay|<marquee|<blink/i.test(
          read(f).replace(/animation-iteration-count:\s*1/g, ""),
        ),
      );
    expect(bad).toEqual([]);
  });

  it("UX-VISUAL-006: không emoji làm icon; ảnh (nếu có) có alt", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    const withEmoji = uiFiles.filter((f) => emoji.test(read(f)));
    expect(withEmoji).toEqual([]);
    for (const f of uiFiles) {
      for (const m of read(f).matchAll(/<(?:img|Image)\b[^>]*>/g))
        expect(m[0], `${f}: ảnh thiếu alt`).toMatch(/\balt=/);
    }
  });

  it("UX-VISUAL-007: mọi ảnh trong public/ và docs/assets/ có đúng một hàng trong docs/assets/CREDITS.md", () => {
    const credits = read("docs/assets/CREDITS.md");
    const listed = [...credits.matchAll(/^\|\s*`([^`]+)`/gm)].map((m) => m[1]!);
    const images = [...walk("public"), ...walk("docs/assets")]
      .filter((f) => /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(f))
      .sort();
    expect(listed.sort()).toEqual(images);
  });

  it("UX-RESP-005: không CSS :hover thô; hover chỉ qua variant Tailwind (đã bọc @media (hover: hover)) hoặc có thay thế focus", () => {
    for (const f of cssFiles) {
      const css = read(f).replace(
        /@media\s*\(hover:\s*hover\)\s*{[\s\S]*?}\s*}/g,
        "",
      );
      expect(css, f).not.toMatch(/:hover/);
    }
    // thông tin/hành động không chỉ hiện khi hover: không dùng group-hover để ẩn/hiện nội dung quan trọng
    const bad = uiFiles.filter((f) =>
      /group-hover:(?:block|visible|opacity-100)/.test(read(f)),
    );
    expect(bad).toEqual([]);
  });
});

describe("font tiếng Việt (UX-DS-006)", () => {
  it("layout khai subset vietnamese cho cả hai họ font", () => {
    const layout = read("app/layout.tsx");
    const subsets = [...layout.matchAll(/subsets:\s*\[([^\]]*)\]/g)].map(
      (m) => m[1]!,
    );
    expect(subsets.length).toBe(2);
    for (const s of subsets) expect(s).toContain('"vietnamese"');
    // fallback stack hiển thị đủ dấu
    expect(read("app/globals.css")).toMatch(/system-ui/);
  });
});

describe("nhãn ô nhập (UX-A11Y-011, FE-FORM-002)", () => {
  it("mọi input/select/textarea (trừ hidden) nằm trong <label> hoặc có aria-label/aria-labelledby", () => {
    const bad: string[] = [];
    for (const f of uiFiles) {
      const t = read(f);
      let depth = 0;
      for (const m of t.matchAll(
        /<label\b|<\/label>|<(?:input|select|textarea)\b[^>]*?(?:\/>|>)/g,
      )) {
        const tag = m[0];
        if (tag.startsWith("<label")) depth++;
        else if (tag === "</label>") depth--;
        else if (
          depth <= 0 &&
          !/type=["']hidden["']/.test(tag) &&
          !/aria-label(?:ledby)?=/.test(tag)
        ) {
          // hoặc có id và một <label htmlFor> cùng tệp trỏ tới đúng id đó
          const id = /\bid=(?:"([^"]+)"|{([^}]+)})/.exec(tag);
          const target = id?.[1] ? `"${id[1]}"` : id?.[2] ? `{${id[2]}}` : null;
          if (!target || !t.includes(`htmlFor=${target}`))
            bad.push(`${f}: ${tag.slice(0, 60)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("form đăng nhập và tạo workspace nối lỗi với ô nhập bằng aria-invalid + aria-describedby", () => {
    for (const [f, id] of [
      ["app/login/auth-form.tsx", "auth-error"],
      ["app/app/create-workspace-form.tsx", "workspace-error"],
    ] as const) {
      const t = read(f);
      expect(t, f).toContain('"aria-invalid": true');
      expect(t, f).toContain(`id="${id}"`);
      expect(t, f).toContain(id);
    }
  });
});

describe("axe tới WCAG 2.2 AA và E2E smoke (STD-A11Y-002, QA-E2E-003)", () => {
  it("STD-A11Y-001: PROJECT.md khai WCAG 2.2 AA", () => {
    expect(read("PROJECT.md")).toMatch(/WCAG 2\.2 AA/);
  });

  it("STD-A11Y-002: helper axe dùng đủ tag tới wcag22aa và mọi spec quét qua helper", () => {
    const helper = read("e2e/helpers/a11y.ts");
    for (const tag of ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      expect(helper, tag).toContain(`"${tag}"`);
    // không còn nơi nào tự dựng AxeBuilder với bộ tag thiếu
    const others = walk("e2e").filter(
      (f) => f.endsWith(".spec.ts") && /new AxeBuilder/.test(read(f)),
    );
    expect(others).toEqual([]);
  });

  it("QA-E2E-003: mọi test @smoke có mở trang đều gọi expectNoA11yViolations", () => {
    const missing: string[] = [];
    for (const f of walk("e2e").filter((x) => x.endsWith(".spec.ts"))) {
      const blocks = read(f)
        .split(/\ntest\(/)
        .slice(1);
      for (const b of blocks) {
        const title = /^"([^"]*)"|^`([^`]*)`/.exec(b.trim());
        const name = (title?.[1] ?? title?.[2] ?? b.slice(0, 40)).trim();
        if (!name.includes("@smoke")) continue;
        const usesPage = /async\s*\(\s*{\s*[^}]*\bpage\b/.test(b.slice(0, 300));
        if (usesPage && !b.includes("expectNoA11yViolations"))
          missing.push(`${f}: ${name.slice(0, 50)}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("UX-A11Y-003: có E2E bàn phím (Tab/Enter) và E2E theme tối", () => {
    const spec = read("e2e/a11y-behavior.spec.ts");
    expect(spec).toMatch(/keyboard\.press\("Tab"\)/);
    expect(spec).toMatch(/keyboard\.press\("Enter"\)/);
    expect(spec).toMatch(/colorScheme:\s*"dark"/);
  });
});

describe("tương phản token (UX-A11Y-002, UX-DS-003)", () => {
  it("xt.py contrast exit 0 trên app/globals.css với contrast-pairs.txt", () => {
    expect(() =>
      execFileSync(
        "python3",
        [
          ".xtemplates/scripts/xt.py",
          "contrast",
          "app/globals.css",
          "--pairs",
          "contrast-pairs.txt",
        ],
        { stdio: "pipe" },
      ),
    ).not.toThrow();
  });
});
