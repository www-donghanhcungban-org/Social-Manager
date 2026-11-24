import { timed } from "@/src/observability/instrument";
import { currentUser, getContainer } from "@/src/server/runtime";

/**
 * Xuất dữ liệu của CHÍNH người đang đăng nhập (STD-PRIV-004). Id lấy từ phiên; chưa đăng nhập thì 401, không chuyển
 * hướng (đây là tải tệp). Không cache. POST vì có ghi một dòng kiểm toán (SEC-WEB-007: GET không ghi); trang tài khoản
 * dùng biểu mẫu `method="post"`; cookie phiên SameSite=Lax nên POST từ trang khác không mang phiên (401), và kẻ
 * tấn công không đọc được phản hồi.
 */
export const POST = timed("POST", "/app/account/export", async () => {
  const user = await currentUser();
  if (!user)
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  const data = await getContainer().services.accountRights.exportMyData({
    userId: user.id,
  });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="du-lieu-cua-toi.json"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
