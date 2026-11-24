/** Trạng thái đang tải của mọi trang trong workspace (UX-STATE-001); tĩnh, không hoạt ảnh vô hạn (UX-VISUAL-002). */
export default function Loading() {
  return (
    <p role="status" aria-live="polite" className="p-4 text-muted-foreground">
      Đang tải…
    </p>
  );
}
