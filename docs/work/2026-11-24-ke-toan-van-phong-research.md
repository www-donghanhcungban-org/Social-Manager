# Nghiên cứu: AI cho kế toán công ty khoá thông minh và công cụ văn phòng Word

Ngày tra cứu: 2026-11-24. Mức bằng chứng: **[C]** tài liệu chính thức đã đọc · **[T]** nguồn thứ cấp (báo, blog, README bên thứ ba) · **[?]** chưa xác minh. Không phải tư vấn pháp lý hay thuế: mọi số hiệu văn bản cần kế toán trưởng/luật sư đối chiếu bản gốc.

## 1. Trả lời nhanh ba câu "cần"

1. **AI vào nhóm Zalo đọc thông tin:** không làm được bằng tài khoản Zalo cá nhân một cách an toàn. Cách có tài liệu là **Zalo Official Account (OA) với nhóm GMF**: webhook `user_send_group_text` gửi nội dung, ảnh, người gửi về hệ thống [C: [tài liệu webhook nhóm GMF](https://docs.zaloplatforms.com/docs/OA/webhook/nhom-chat-gmf/message_webhook)]. Điều kiện để OA tạo nhóm (gói dịch vụ, duyệt, phí) chưa xác minh được [?]; SDK bên thứ ba ghi nhóm do OA sở hữu và gắn với gói OA [T]. Nhóm hiện có của nhân viên kinh doanh phải **chuyển sang nhóm do OA tạo** thì mới đọc được.
2. **Nhập liệu vào phần mềm kế toán:** làm được một phần. MISA AMIS Kế toán có Open API, đẩy chứng từ bán hàng dưới dạng **"đề nghị sinh chứng từ"**, tối đa 1.000 chứng từ mỗi lần, token hiệu lực 12 giờ, mỗi khách hàng tự tạo access_code trong AMIS [C: [tài liệu Open API](https://www.misa.vn/154745/tai-lieu-open-api-tich-hop-amis-ke-toan-doanh-nghiep/), [T: ghi chú tích hợp](https://github.com/DOS/Ludy/issues/3854)]. Tức AI **soạn**, kế toán **duyệt và ghi sổ**. Phí API: chưa tra được [?]. Phần mềm đang dùng của công ty chưa biết, nên phải hỏi; nếu không phải MISA thì cần tra riêng (FAST, Bravo, Sapo, KiotViet đều chưa xác minh [?]).
3. **Cập nhật doanh thu/công nợ từng nhân viên kinh doanh lên Drive:** làm được bằng Google Sheets API (đọc/ghi 300 yêu cầu/phút/dự án, 60/phút/người dùng [C: [giới hạn Sheets](https://developers.google.com/workspace/sheets/api/limits)]) — dư cho quy mô công ty. **Lưu ý:** "protected range" không phải bảo mật, Google tự ghi người chỉ xem vẫn xem/sao chép/xuất được [C: [Google](https://support.google.com/docs/answer/1218656)]. Muốn mỗi nhân viên chỉ thấy phần của mình thì **mỗi người một file riêng**.

## 2. Từng quy trình: ai làm, ai duyệt

| Quy trình                                        | AI làm được                                                    | Người phải giữ                            | Rủi ro chính                                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Đọc order trong nhóm → báo giá                   | Tách mã hàng, số lượng, khách; tra bảng giá; soạn báo giá nháp | NVKD/kế toán duyệt trước khi gửi khách    | Order viết tắt, nhiều khách trong một tin; cần bảng giá và mã hàng chuẩn                                                                   |
| Khách chốt → hoá đơn bán hàng                    | Soạn phiếu bán hàng từ báo giá đã chốt                         | Xác nhận "đã chốt" là hành động của người | Chốt miệng trong nhóm không rõ ràng                                                                                                        |
| Ảnh bill chuyển khoản → công nợ                  | Đọc ảnh, ghép với khách/đơn, đề xuất khớp                      | Kế toán xác nhận khớp tiền thật           | Ảnh sửa, nội dung chuyển khoản bị đổi [T: tài liệu VietinBank nêu app cho sửa nội dung điền sẵn]; OCR ảnh chụp app ngân hàng chưa kiểm [?] |
| Xuất hoá đơn GTGT                                | Chuẩn bị dữ liệu                                               | **Người có thẩm quyền phát hành**         | Sai thời điểm lập bị phạt; xem mục 4                                                                                                       |
| Theo dõi đơn mua, công nợ mua, tồn kho, cảnh báo | Tổng hợp, nhắc ngày giao, cảnh báo dưới mức tồn                | Quyết định đặt hàng                       | Dữ liệu tồn kho phải đúng từ phần mềm kế toán                                                                                              |
| Sổ chi theo hoá đơn                              | Phân loại, đề xuất bút toán                                    | Kế toán duyệt                             | Phân loại sai tài khoản                                                                                                                    |
| Báo cáo tuần theo NVKD, báo cáo quản trị tháng   | **Làm tốt nhất**: tổng hợp, biểu đồ, so kỳ                     | Soát số trước khi gửi giám đốc            | Số sai nếu dữ liệu đầu vào sai                                                                                                             |
| Bảng lương theo chấm công                        | Tính nháp theo quy tắc cấu hình                                | Kế toán/nhân sự duyệt                     | Quy định thay đổi hằng năm                                                                                                                 |

**Nguyên tắc thiết kế:** AI chỉ **đề xuất**, mọi thứ ghi vào sổ, phát hành hoá đơn, chi tiền đều qua bước duyệt của người (khớp luật vận hành của X-Workspace: tác dụng phụ qua sổ hành động `waiting_approval`).

## 3. Đưa dữ liệu từ nhóm Zalo vào hệ thống

| Cách                                                              | Có tài liệu                     | Rủi ro                                                                                                                                                                                                                                  | Kết luận                                      |
| ----------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| OA + nhóm GMF + webhook                                           | [C] webhook; điều kiện nhóm [?] | Phải chuyển nhóm; có thể có phí/duyệt                                                                                                                                                                                                   | **Ưu tiên, cần xác minh điều kiện OA**        |
| Thư viện không chính thức đăng nhập tài khoản cá nhân (zca-js...) | Không                           | Điều khoản cấm phần mềm bên thứ ba, có thể bị khoá 30 ngày hoặc vĩnh viễn, mất dữ liệu [T: [CafeF](https://cafef.vn/thao-tac-co-the-khien-tai-khoan-zalo-cua-ban-bi-khoa-vinh-vien-188260910160926853.chn)]; văn bản điều khoản gốc [?] | **Không khuyến nghị** cho tài khoản công việc |
| NVKD chuyển tiếp/nhập order qua form                              | Không cần API                   | Thêm thao tác cho NVKD                                                                                                                                                                                                                  | Phương án dự phòng, chắc chắn chạy            |
| Chuyển sang kênh có API (Telegram, web form, Mini App)            | Tuỳ kênh                        | Đổi thói quen khách                                                                                                                                                                                                                     | Dài hạn                                       |

X-Workspace đã có lớp nguồn dữ liệu cắm được (nhà cung cấp SocialAPI, hộp thư hợp nhất). SocialAPI có trang cho Zalo OA ([social-api.ai/platforms/zalo](https://social-api.ai/platforms/zalo)); hỗ trợ **nhóm** của nó chưa xác minh [?].

## 4. Hoá đơn, kế toán, dữ liệu cá nhân (nguồn thứ cấp, cần đối chiếu)

- Hoá đơn điện tử: Nghị định 123/2020/NĐ-CP được sửa bởi **NĐ 70/2025/NĐ-CP** (ban hành 20/03/2025, hiệu lực 01/06/2025, sửa cả Điều 9 về thời điểm lập) [T: [PwC](https://www.pwc.com/vn/vn/publications/2025/250416-changes-to-invoicing-regulations.pdf)]. Thông tư 78/2021 được nguồn thứ cấp nói đã thay bởi **TT 32/2025/TT-BTC** (hiệu lực 01/06/2025) [T: [KPMG](https://kpmg.com/us/en/taxnewsflash/news/2025/06/tnf-vietnam-guidance-on-invoices-including-electronic-invoices-and-documents.html)]; có nhắc "TT 91/2026/TT-BTC" mới từ 01/07/2026, chưa rõ có thay TT 32 [?].
- Nhà cung cấp hoá đơn có API phát hành tự động (VNPT, Viettel, BKAV, MISA meInvoice, EasyInvoice): MISA meInvoice nói có API/SDK [T], phần còn lại và **trách nhiệm pháp lý khi phát hành tự động, yêu cầu chữ ký số** chưa xác minh [?]. Đề xuất giữ người bấm phát hành.
- Chế độ kế toán: **TT 99/2025/TT-BTC** (hiệu lực 01/01/2026) thay TT 200/2014 [T: [KPMG](https://kpmg.com/vn/vi/home/phan-tich-chuyen-sau/2025/11/key-changes-in-vietnamese-accounting-system-for-enterprises.html)]. Cách tính giá xuất kho (bình quân, FIFO) cần đọc điều khoản gốc [?].
- Dữ liệu cá nhân khách hàng/nhân viên: Luật 91/2025/QH15, NĐ 356/2025/NĐ-CP hiệu lực 01/01/2026 [T: [PwC](https://www.pwc.com/vn/vn/publications/2026/20260128-new-rules-personal-data-protection.pdf)]. Cần ghi nhận đồng ý khi AI đọc nhóm chat có tên, số điện thoại, tài khoản ngân hàng.
- Lương 2026 [T]: giảm trừ bản thân 15,5 triệu và người phụ thuộc 6,2 triệu/tháng (NQ 110/2025/UBTVQH15); lương tối thiểu vùng I 5.310.000 (NĐ 293/2025); lương cơ sở 2,53 triệu từ 01/07/2026. Bảng tỷ lệ BHXH chi tiết chưa xác minh [?] — **cấu hình tham số, không cứng trong mã**.
- Nhận tiền tự động thay ảnh bill: SePay, Casso có webhook biến động số dư [C: [SePay](https://docs.sepay.vn), [Casso](https://flow.casso.vn/huong-dan/)]; giá và ngân hàng hỗ trợ chưa tra [?]. Đây là cách **giảm sai sót nhiều nhất**, thay vì đọc ảnh bill. Thông tư 64/2024/TT-NHNN về Open API ngân hàng có hiệu lực 01/03/2025 [T], tư cách pháp lý của các đơn vị trung gian chưa kiểm [?].

## 5. Phần mềm văn phòng Word (yêu cầu thứ hai)

### Thể thức văn bản hành chính (đã đọc bản phụ lục NĐ 30/2020/NĐ-CP)

Nguồn: [Phụ lục I do VCCI đăng](https://vanban.vcci.com.vn/hm_content/uploads/van-ban/ND_30-2020-ND-CP_Phu_luc.pdf) (bản đăng lại, chưa đối chiếu Công báo). Không tìm thấy nghị định sửa đổi NĐ 30 đến 11/2026 (kết quả tìm kiếm âm tính, chưa chắc) [T].

- Khổ A4 (210 × 297 mm), trình bày theo chiều dài; lề trên và dưới 20–25 mm, trái 30–35 mm, phải 15–20 mm.
- Phông Times New Roman, Unicode (TCVN 6909:2001), màu đen. Số trang chữ số Ả Rập, cỡ 13–14, giữa lề trên, **không hiện số ở trang đầu**.
- Quốc hiệu in hoa cỡ 12–13 đậm; tiêu ngữ cỡ 13–14 đậm; tên cơ quan in hoa cỡ 12–13. Cỡ chữ nội dung, giãn dòng, thụt đầu dòng: chưa đọc tới [?].

Ghi chú: NĐ 30 áp dụng cho văn bản hành chính của cơ quan nhà nước; công ty tư nhân thường dùng làm chuẩn trình bày chung, nên đặt thành **mẫu cấu hình được**, không ép.

### Cách làm kỹ thuật (số phiên bản lấy từ registry ngày 2026-11-24)

| Việc                                         | Công cụ có tài liệu                                                                                                                                                         | Giới hạn đã biết                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Đọc/sửa font, cỡ, lề, thụt, giãn dòng, style | python-docx 1.2.0, MIT [C: [PyPI](https://pypi.org/pypi/python-docx/json)]                                                                                                  | Tên style dựng sẵn phải dùng tên tiếng Anh                                                                                                                    |
| Gộp nhiều file Word                          | docxcompose 2.2.0, MIT (06/2026) [C: [PyPI](https://pypi.org/pypi/docxcompose/json)]                                                                                        | Mặc định giữ style file đầu; **bỏ header/footer của file nối** (số trang nằm ở header)                                                                        |
| Mục lục tự động                              | Chèn trường TOC được; **cập nhật số trang cần Word hoặc LibreOffice mở file** [T: diễn đàn LibreOffice, chưa có tài liệu chính thức]                                        | `soffice --convert-to` không tự cập nhật mục lục; có báo cáo treo trong Docker [T]                                                                            |
| Chạy trong Word                              | Office Add-in (Office.js): Word web, Windows, Mac, iPad [C: [Microsoft Learn](https://learn.microsoft.com/en-us/office/dev/add-ins/word/word-add-ins-programming-overview)] | `insertOoxml`, trường TOC, giới hạn Word web: chưa xác minh [?]                                                                                               |
| Kiểm tra chính tả tiếng Việt                 | Hunspell vi_VN (hai kiểu dấu cũ/mới) [C: [hunspell-vi](https://github.com/1ec5/hunspell-vi)], giấy phép [?]                                                                 | Từ điển chỉ liệt kê âm tiết, **không có từ ghép**; LanguageTool **không** hỗ trợ tiếng Việt [C: [danh sách ngôn ngữ](https://dev.languagetool.org/languages)] |

**Kết luận kỹ thuật:** định dạng, lề, thụt đầu dòng, gộp file làm được ổn định bằng python-docx và docxcompose. **Chính tả tiếng Việt là phần yếu nhất:** Hunspell bắt được lỗi âm tiết sai nhưng không bắt lỗi dấu thanh hợp lệ-nhưng-sai-ngữ-cảnh, từ ghép, tên riêng; nên dùng mô hình ngôn ngữ để rà ngữ cảnh và **đánh dấu để người duyệt, không tự sửa**. Độ chính xác mô hình chưa có số đo công bố nên cần đo trên văn bản thật của công ty.

**Sản phẩm có sẵn:** tiện ích "Căn chỉnh NĐ 30" cho Word (nguồn thứ cấp, giá chưa rõ) [T: [Quantrimang](https://quantrimang.com/huong-dan-can-chinh-van-ban-theo-dung-nd-30-215440)]; AppSource chưa thấy add-in thể thức hành chính VN [T]. Nên so "làm hay mua" sau khi có mẫu văn bản thật.

**Tính năng văn phòng khác nên làm (đề xuất):** báo cáo trước/sau cho từng thay đổi định dạng (không tự sửa im lặng); so sánh hai phiên bản; kiểm tra số trang, đề mục nhảy cấp, khoảng trắng kép, dấu câu; điền mẫu hợp đồng/biên bản/công văn từ dữ liệu; xuất PDF.

## 6. Việc chưa xác minh (cần làm trước khi cam kết)

1. Điều kiện OA tạo nhóm GMF (gói, duyệt, phí) và SocialAPI có hỗ trợ nhóm không.
2. Phần mềm kế toán công ty đang dùng là gì; phí và phạm vi API của nó (nếu MISA: tài liệu developer chỉ đọc được tiêu đề).
3. Nhà cung cấp hoá đơn điện tử đang dùng; API phát hành, chữ ký số, trách nhiệm pháp lý.
4. Đối chiếu bản gốc: NĐ 70/2025, TT 32/2025, TT 99/2025, NĐ 356/2025, NĐ 30/2020 (cỡ chữ nội dung, giãn dòng).
5. OCR ảnh bill thật của công ty: đo tỷ lệ đọc đúng trước khi tin.
6. Chính tả tiếng Việt: đo trên 20–30 văn bản thật.

## 6b. Trường hợp của công ty: dùng MISA, hai kịch bản về Zalo

Công ty xác nhận dùng **MISA** (chưa rõ sản phẩm: AMIS Kế toán Doanh nghiệp hay MISA SME; tài liệu Open API tìm được là của AMIS Kế toán) và chưa quyết định chuyển nhóm sang OA. Cần hỏi: bản MISA đang dùng, và đã đăng ký MISA meInvoice chưa.

|             | Kịch bản A: **không chuyển** nhóm Zalo                                      | Kịch bản B: **chuyển** sang OA/GMF                                                             |
| ----------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Đọc order   | NVKD **dán/chuyển tiếp** order vào một form hoặc kênh có API; AI đọc từ đó  | Webhook đọc thẳng tin nhóm, ảnh, người gửi [C]                                                 |
| Ảnh bill    | NVKD gửi ảnh vào cùng form; hoặc bỏ ảnh, dùng biến động số dư (SePay/Casso) | Ảnh về qua webhook (có `attachments`) [T: tin tức tìm kiếm]; vẫn nên đối chiếu biến động số dư |
| Rủi ro      | Thêm thao tác cho NVKD, dễ quên                                             | Chưa biết gói/phí/duyệt OA; khách đổi thói quen; phụ thuộc chính sách Zalo [?]                 |
| Chi phí làm | Thấp, chắc chắn chạy                                                        | Trung bình, **chỉ chạy được sau khi xác minh điều kiện OA**                                    |
| Đề xuất     | Bắt đầu ở đây (giai đoạn 1–2)                                               | Thử một nhóm nhỏ làm thí điểm sau khi xác minh với Zalo                                        |

Phần phía sau (soạn báo giá, ghi Sheets theo từng NVKD, đẩy "đề nghị sinh chứng từ" sang MISA) **giống nhau ở cả hai kịch bản**; hai kịch bản chỉ khác cách dữ liệu đầu vào đến hệ thống. Vì vậy nên xây phần sau trước, đầu vào cắm sau.

## 7. Đề xuất giai đoạn (nhỏ, đảo ngược được)

1. **Giai đoạn 1 — không rủi ro:** báo cáo tuần theo NVKD và báo cáo quản trị tháng từ file/Sheets hiện có; công cụ Word (định dạng, gộp file, mục lục, kiểm tra chính tả đánh dấu). Không chạm tiền hay hoá đơn.
2. **Giai đoạn 2 — đọc, đề xuất:** đọc order và ảnh bill để soạn báo giá/đề xuất khớp công nợ; ghi vào Sheets theo từng NVKD; người duyệt từng dòng.
3. **Giai đoạn 3 — nối phần mềm kế toán:** đẩy "đề nghị sinh chứng từ" sang AMIS (nếu dùng MISA), kế toán duyệt; nhận biến động số dư qua dịch vụ có API thay ảnh bill.
4. **Không làm tự động:** phát hành hoá đơn GTGT, chi tiền, chốt lương.
