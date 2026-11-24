import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Tag axe đủ tới WCAG 2.2 AA (STD-A11Y-002). */
export const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
];

/**
 * Quét axe trang hiện tại: 0 vi phạm (mọi mức, chặt hơn yêu cầu critical/serious của QA-E2E-003). Gọi trong mọi test
 * `@smoke` có mở trang; `tests/config/design-system.test.ts` đỏ nếu thiếu.
 */
export async function expectNoA11yViolations(page: Page, label = page.url()) {
  const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(
    axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`),
    `axe ${label}`,
  ).toEqual([]);
}
