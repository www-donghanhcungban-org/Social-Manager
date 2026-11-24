/**
 * Cổng đọc nguyên văn bằng chứng mà tìm kiếm cần (chỉ phần dùng). `EvidenceService` thoả cấu trúc này, nên search không
 * phải import evidence — evidence → search/fold là chiều phụ thuộc duy nhất.
 */
export interface EvidenceContentReader {
  getContent(input: {
    actorId: string;
    workspaceId: string;
    itemId: string;
  }): Promise<{ content: Uint8Array }>;
}
