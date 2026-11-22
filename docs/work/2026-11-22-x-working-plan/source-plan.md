# X-Working — Kế hoạch sản phẩm (bản gốc của chủ dự án)

> Nguồn: tài liệu `X-Working-Ke-hoach-san-pham-2026-11-22.docx` do chủ dự án cung cấp ngày 2026-11-22, chuyển sang Markdown bằng pandoc, giữ nguyên nội dung. Đây là căn cứ sản phẩm; phần nghiên cứu bổ sung và kế hoạch triển khai trong repo nằm ở [`working.md`](working.md).

Bản cập nhật sau nghiên cứu stored ngày 22 tháng 11 năm 2026

Chốt phát triển X-Working từ repo Social-Manager thành một trợ lý công việc có bộ nhớ dài hạn và khả năng hành động. Sản phẩm gom tin nhắn, tài liệu, repo và ngữ cảnh ứng dụng vào hồ sơ dự án; trả lời từ bằng chứng; soạn hoặc thực hiện công việc trong phạm vi được cấp; lưu kết quả để tra cứu nhiều năm.

Giữ một sản phẩm và một codebase, tận dụng Next.js, PostgreSQL, Drizzle, pg-boss và Better Auth đang có trong PR 18. Bổ sung kho bằng chứng, AI điều phối và một chương trình phụ trên Windows dùng Agent Desktop. MVP thử một người dùng, một dự án, một kênh tin nhắn và một workflow desktop; mở rộng sau khi vòng công việc này đạt nghiệm thu. \[S18\] \[S19\]

Kế hoạch tuân theo ba giai đoạn: MVP để dùng thử và chỉnh sửa, sản phẩm hoàn thiện, rồi tối ưu. Các lựa chọn kiến trúc và tên dưới đây là quyết định cho hướng phát triển; các khoảng thời gian, ngưỡng đánh giá và lợi ích dự kiến cần được đo khi triển khai. Quyết định sản phẩm không đồng nghĩa đã hoàn tất chức năng, đổi tên repo hay triển khai bản mới.

Nghiên cứu bổ sung từ stored đã được ghép vào mục 15: dùng catalog làm nguồn tri thức, chuẩn hóa nhập tài liệu và khả năng thực thi, bổ sung task có phiên bản, ngân sách context và bộ đánh giá tách tầng. Các cải thiện được gắn vào backlog hiện có và giữ phạm vi pilot hẹp. \[S43\] \[S44\]

# Định vị và tên sản phẩm

Tên sản phẩm được chốt theo lựa chọn của chủ dự án là **X-Working**, slug **x-working**. Mô tả tiếng Việt: Trợ lý công việc có bộ nhớ dài hạn. Mô tả tiếng Anh: AI Work Companion. Câu giới thiệu ngắn: Ghi nhớ, tổng hợp và thực hiện công việc cùng bạn.

X-Working là tên chung cho giao diện công việc, kho tri thức, AI và khả năng thao tác ứng dụng. Social Manager trở thành nền và module quản lý hội thoại/social; Agent Desktop là công cụ thực thi tích hợp. Tên sản phẩm bao quát cả công việc cá nhân lẫn nhiều dự án và giữ cách đặt tên X trong hệ sản phẩm.

| **Phạm vi**          | **Tên thống nhất**  | **Cách dùng**                                                                             |
| -------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| Thương hiệu sản phẩm | X-Working           | Dùng trong giao diện, đặc tả và tài liệu.                                                 |
| Repository mục tiêu  | X-Working           | Phát triển từ Social-Manager; giữ lịch sử Git và đường triển khai hiện có khi chuyển tên. |
| Định danh kỹ thuật   | x-working           | Slug hoặc tiền tố cho package/service mới; rà riêng các định danh đã tồn tại.             |
| Ứng dụng máy tính    | X-Working Companion | Chương trình phụ trên máy người dùng, kết nối hub và gọi Agent Desktop.                   |

Giữ một sản phẩm và một codebase có module rõ ràng. Đổi thương hiệu trong đặc tả và giao diện trước; việc đổi tên repository, remote, CI, secrets và cấu hình triển khai là một hạng mục chuyển đổi riêng trong quá trình triển khai.

# 1 Mục tiêu và phạm vi sản phẩm

Hệ thống cần giúp trả lời nhanh: mỗi sản phẩm đang ở đâu; điều gì đã thay đổi; quyết định nào còn hiệu lực; công việc nào còn dở; trước đây đã thử gì; nguồn nào chứng minh kết luận; và bước tiếp theo nên làm là gì. Thông tin phải tiếp tục sử dụng được khi đổi model AI, đổi công cụ thu thập hoặc chuyển sang máy khác.

- Hồ sơ dự án tự cập nhật gồm mục tiêu, giai đoạn, phiên bản, quyết định, việc còn mở, trở ngại và nguồn xác nhận.

- Dòng thời gian liên kết yêu cầu, trao đổi, tài liệu, thay đổi mã nguồn, kiểm thử, merge và triển khai.

- Tra cứu theo ý nghĩa và theo mã chính xác như tên file, PR, SHA, phiên làm việc hoặc mã lỗi.

- Gói bàn giao giúp người dùng hoặc agent mới tiếp tục công việc với mục tiêu, quyết định hiện hành, việc còn dở và bằng chứng cần đọc.

- Bản tổng hợp thay đổi kể từ lần xem trước và kế hoạch tiếp theo, có tách phần quan sát được với phần AI đề xuất.

- Hộp thư có ngữ cảnh dự án, bản nháp có căn cứ, trạng thái gửi và lịch sử nội dung thực gửi.

- Thiết bị được ghép nối để thao tác app; mỗi nhiệm vụ có mục tiêu, phạm vi và kết quả kiểm chứng.

Dự án pilot đề xuất là X-Templates, dùng để kiểm tra quan hệ giữa hội thoại, code, CI và bằng chứng triển khai. Sau MVP, mở rộng sang X-BOSS, donghanhcungban.org, X-Scanner và X-Studio theo mức sử dụng thực. Đây là phạm vi thí điểm, không phải báo cáo tình trạng hiện tại của các dự án đó.

Yêu cầu lưu toàn bộ được áp dụng cho dữ liệu nằm trong các nguồn, ứng dụng, thư mục và khoảng thời gian đã chọn. Không thể khôi phục những nội dung chưa từng được ghi nhận, đã mất ở nguồn hoặc không được nguồn cho truy cập. Hệ thống phải hiển thị khoảng thiếu dữ liệu thay vì diễn giải sự im lặng thành không có hoạt động.

MVP có cả đọc, tổng hợp, soạn nháp và một workflow gửi có kiểm chứng trong phạm vi cấu hình. Tác vụ điều khiển app được đặt sau lớp thực thi; việc sửa code, merge và deploy các dự án khác chỉ trở thành workflow khi có yêu cầu cùng phạm vi quyền cụ thể. Ưu tiên hoàn thiện một vòng công việc hữu ích trước khi bổ sung CRM, ERP hoặc các màn hình quản lý mới.

# 2 Căn cứ nghiên cứu và quyết định tích hợp

| **Thành phần**        | **Căn cứ**                                                                              | **Quyết định**                                                                         |
| --------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Social Manager        | PR 18 đã có mã auth, workspace, provider, inbox, publishing và jobs. \[S18\] \[S19\]    | Tận dụng làm nền sản phẩm; kiểm chứng phần nền trước khi mở rộng.                      |
| Agent Desktop         | Công cụ đọc và thao tác accessibility; caller quản lý AI và vòng kiểm chứng. \[S24\]    | Dùng qua adapter CLI hoặc MCP trên máy đích; ghim phiên bản.                           |
| PostgreSQL và pg-boss | Đã là stack của PR; cùng một cơ sở dữ liệu cho nghiệp vụ và hàng đợi. \[S19\] \[S29\]   | Dùng tiếp làm trung tâm; lưu trạng thái công việc bền vững.                            |
| Bộ nhớ cho model      | Mem0 mặc định trích xuất memory; Letta tách bulky archives khỏi memory. \[S32\] \[S33\] | Kho bằng chứng độc lập; memory và summary là dữ liệu dẫn xuất.                         |
| Tìm kiếm              | Postgres có full-text search; pgvector là lựa chọn bổ sung. \[S31\] \[S15\]             | Bắt đầu bằng định danh và văn bản; thêm semantic search khi bộ thử chứng minh lợi ích. |

Không chọn thêm một agent framework hoặc memory service bắt buộc trong MVP. Một vòng điều phối chính và các module trong codebase hiện tại đủ cho phạm vi thử. Chỉ bổ sung workflow engine, vector database riêng hoặc graph database khi có yêu cầu đo được mà kiến trúc hiện tại không đáp ứng tốt.

Agent Desktop cung cấp khả năng thao tác; snapshots và trace của nó không thay thế lịch sử công việc. Trace có giới hạn ghi, một số trường nội dung bị che và có thể bị dọn cùng session. Worker phải đưa observation, nội dung cần lưu và kết quả thực thi vào kho của sản phẩm. \[S27\]

Lợi thế của cách kết hợp này là tận dụng nền hội thoại và vận hành đã có, trong khi giữ dữ liệu dự án độc lập với model và công cụ điều khiển. Các luồng thu thập, chuẩn hóa, khử trùng lặp, kiểm quyền và hàng đợi dùng code xác định; LLM tập trung vào ngữ nghĩa, tổng hợp và soạn trả lời.

## Hiện trạng mã nguồn làm cơ sở

Đối chiếu main d9ebc747 và PR 18 tại head 1fb002fb0d404c39d775864478f2dd57e79eb921. Main còn scaffold; nhánh PR đã có auth/workspace, provider, hộp thư, đăng bài, queue và webhook. Các quan sát trong phần này gắn với revision đó, không phải chứng nhận chạy production. \[S18\] \[S19\]

Tuyến polling SocialAPI gọi danh sách conversation với limit 50, lấy conversation.id và last_message rồi lưu bằng onConflictDoNothing. Suy luận từ code: tin mới của conversation cũ có thể bị bỏ qua ở tuyến này. Webhook là tuyến riêng; không kết luận mọi tin mới đều mất. Cần tách ID conversation và message, cursor/backfill, versions và độ bao phủ. \[S20\] \[S21\]

Inbox sync cắt nội dung ở 10.000 ký tự trước lưu và chưa có archive nguyên bản riêng. Migration phải giữ nguồn, mức đầy đủ và ý nghĩa ID cũ; không gắn nhãn các dòng last_message thành toàn bộ lịch sử hội thoại. Contract SocialProvider hiện chưa có phương thức reply; thao tác handled hiện chỉ đánh dấu xử lý. \[S21\] \[S41\]

Giữ metadata trạng thái trung thực: API đang nhận để xử lý chưa đồng nghĩa hoàn tất; ví dụ adapter hiện ánh xạ publishing thành published cần được sửa trước khi dùng làm căn cứ AI. SocialAPI còn cần đối chiếu tài liệu dịch vụ và thử trên tài khoản được chọn. \[S20\]

# 3 Nguồn dữ liệu và thứ tự tích hợp

| **Nguồn**            | **Thông tin cần lưu**                                                                                      | **Ưu tiên**                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Một kênh tin nhắn    | Conversation và message IDs, người tham gia, thời gian, nội dung gốc, phiên bản, attachment trong phạm vi. | MVP                                |
| GitHub và Git        | Issue, PR, review, commit, check, release; nội dung và metadata theo đúng SHA.                             | MVP cho dự án pilot                |
| Thư mục công việc    | Bản file khi lưu, tài liệu và bản xuất; hash, phiên bản và liên kết dự án.                                 | MVP phạm vi hẹp                    |
| Phiên AI và trao đổi | Yêu cầu, quyết định, kết quả công cụ, báo cáo cuối phiên bằng import hoặc hook được hỗ trợ.                | Import MVP; tự động hóa sau        |
| Ứng dụng native      | Phần UI liên quan nhiệm vụ, app/window/account, observation trước và sau hành động.                        | Một workflow Windows               |
| Trang web nghiên cứu | Nội dung lưu tại thời điểm đọc, URL, tiêu đề, ngày thu và dự án.                                           | Lưu chủ động trước                 |
| VPS và vận hành      | Phiên bản đang chạy, deployment receipt và quan sát hoạt động.                                             | Khi cần trả lời tiến độ triển khai |
| Các kênh và máy khác | Lịch sử và tác vụ thuộc phạm vi đã chọn.                                                                   | Giai đoạn hoàn thiện               |

Danh mục nguồn phải xác định mức lưu cho Git và CI: metadata, nội dung file và diff, log, artifact và file phát hành. Mỗi nhóm ghi rõ lưu bản nội dung hay chỉ lưu tham chiếu; SHA hoặc URL không được coi là bản sao nội dung. MVP ưu tiên lịch sử và source file trong phạm vi repo đã chọn, nội dung PR và review, cùng log hoặc artifact cần để chứng minh các câu hỏi thí điểm. Git LFS, submodule và build binary phải có mục thu riêng nếu được chọn. Nhóm chưa tải đủ nội dung mang nhãn chỉ có metadata và nằm ngoài độ bao phủ nội dung đầy đủ.

## Lấy lịch sử rồi cập nhật liên tục

Khi kết nối một nguồn, hệ thống lấy lịch sử còn truy cập được từ API của từng đối tượng, sau đó cập nhật tăng dần bằng webhook hoặc polling và định kỳ đối soát. GitHub Events API chỉ cung cấp tối đa 300 sự kiện trong 30 ngày, nên không đủ làm kho lịch sử dài hạn. GitHub cũng không tự gửi lại webhook thất bại. \[S07\] \[S08\]

Mỗi connector lưu checkpoint, số đối tượng đã nhập, thời điểm đồng bộ thành công, lỗi và khoảng lịch sử chưa có. Sự kiện được nhận lại phải được khử trùng lặp; sự kiện đến muộn không được tự làm lùi trạng thái mới hơn. Lưu bản bằng chứng nhận được ngay, không chỉ một URL trỏ đến nguồn.

## Bản ghi phiên và nội dung trình duyệt

Claude Code là ví dụ có hook và transcript_path được công bố; collector phải xử lý việc transcript có thể chưa chứa thông điệp cuối tại thời điểm Stop. Đây là tích hợp theo sản phẩm cụ thể, không phải một cách đọc mọi ứng dụng chat. \[S09\]

Lịch sử trình duyệt chỉ giúp tìm URL, tiêu đề và lần truy cập; nó không lưu toàn văn trang đã xem. MVP cần nút Lưu vào dự án để lưu nội dung hiện có và nguồn gốc. Thu tự động toàn bộ site là phạm vi quyền khác, được xử lý sau. \[S10\]

Các nguồn chưa có API hoặc export ổn định sẽ được gắn nhãn mức hỗ trợ. Quan sát màn hình chỉ phản ánh phần nhìn thấy, không được coi là bản sao đầy đủ của tài liệu, cuộc hội thoại hoặc trạng thái máy chủ.

# 4 Trải nghiệm người dùng

## Tổng quan công việc

Màn hình đầu trả lời ba việc thực dụng: hôm nay cần chú ý gì, dự án nào đang bị chặn và điều gì thay đổi kể từ lần xem trước. Mỗi mục có thời điểm dữ liệu được cập nhật và đường mở về bằng chứng. Nguồn đang mất kết nối được hiện cùng thông tin dự án, không ẩn trong trang cài đặt.

## Hồ sơ từng sản phẩm

Mỗi hồ sơ có mục tiêu, giai đoạn MVP hoặc hoàn thiện hoặc tối ưu, trạng thái đã xác minh, việc còn mở, quyết định đang hiệu lực, tài liệu và phiên làm việc liên quan. Trạng thái code, CI, merge, release và production được lưu riêng; không ép tất cả thành một phần trăm hoàn thành khó kiểm chứng.

## Dòng thời gian và sổ quyết định

Người dùng có thể lọc theo dự án, nguồn và thời gian; mở lại bản tài liệu hoặc phát biểu tại thời điểm đó. Quyết định có liên kết thay thế quyết định cũ, lý do, nguồn xác nhận và thời gian hiệu lực. Một đề xuất của AI chưa được chấp nhận vẫn nằm ở nhóm đề xuất.

## Hỏi đáp và bàn giao

Các câu hỏi mẫu gồm Vì sao chọn phương án này, Lần trước đang vướng ở đâu, Từ tuần trước đã thay đổi gì và Chuẩn bị ngữ cảnh để tiếp tục X-BOSS. Câu trả lời nêu kết luận, dẫn chứng, độ mới của nguồn và phần còn thiếu. Gói bàn giao chứa các liên kết và trích đoạn liên quan thay vì đẩy toàn bộ lịch sử nhiều năm vào một prompt.

## Lập kế hoạch từ tình trạng thực tế

AI đọc mục tiêu và quyết định hiện hành, kiểm tra bằng chứng tiến độ, tìm khoảng trống rồi đề xuất thứ tự công việc cùng điều kiện hoàn thành. Nghiên cứu bên ngoài có nguồn và ngày kiểm tra riêng; thông tin công khai mới không tự ghi đè quyết định nội bộ đã được người dùng xác nhận.

## Hộp thư và thiết bị

Hộp thư đặt cạnh ngữ cảnh dự án, bản nháp, bằng chứng và trạng thái gửi. Người dùng có thể sửa bản nháp hoặc đặt phạm vi tự trả lời theo cuộc hội thoại và loại nội dung. Trang Thiết bị hiển thị máy đã ghép nối, app được hỗ trợ, công việc đang chạy và điểm cần tiếp quản. Mọi nguồn thu cho workspace cá nhân được giữ riêng theo mặc định.

# 5 Kiến trúc dữ liệu và bộ nhớ

Backend Social Manager nhận dữ liệu từ các connector và collector; worker Windows bổ sung dữ liệu và thao tác app. Kiểm phạm vi rồi lưu bản gốc trước chuẩn hóa, nhận diện dự án, lập chỉ mục hoặc tổng hợp. Postgres giữ metadata và trạng thái; kho blob giữ bằng chứng lớn. Lịch sử quan trọng ghi thêm phiên bản; các bảng nghiệp vụ vẫn có thể cập nhật bình thường, không cần áp dụng event sourcing phân tán cho toàn bộ hệ thống. \[S13\]

| **Lớp**                | **Dữ liệu**                                            | **Nguyên tắc**                                            |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| Bằng chứng gốc         | File, nội dung phiên, payload API, ảnh được chọn lưu.  | Giữ bản thu nhận, nguồn, hash và metadata.                |
| Lịch sử sự kiện        | Tạo sửa xóa ở nguồn, quyết định, PR, CI và deployment. | Ghi thêm diễn biến, chống trùng, giữ thứ tự nguồn khi có. |
| Tri thức và trạng thái | Hồ sơ, khẳng định, quyết định hiện hành, bản tổng hợp. | Mọi nội dung dẫn xuất có căn cứ và có thể tính lại.       |
| Chỉ mục tìm kiếm       | Toàn văn, đoạn trích, vector và cache.                 | Có thể dựng lại; không phải bản duy nhất của nội dung.    |

Bản tóm tắt không thay thế bản gốc. Khi AI tổng hợp sai, người dùng sửa kết luận và hệ thống lưu một phiên bản mới. Khi đổi model hoặc bộ trích xuất, có thể xử lý lại từ bằng chứng mà không phải xin lại lịch sử đã mất ở dịch vụ nguồn.

## Dữ liệu tối thiểu cho một bản ghi

| **Nhóm trường**  | **Trường đề xuất**                                                            | **Mục đích**                                                 |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Định danh        | workspace_id, project_id, source_id, object_id, version_id, device_id         | Nhận diện cùng một đối tượng qua nhiều lần nhập.             |
| Thời gian        | occurred_at, observed_at, source_timezone                                     | Tách lúc sự việc xảy ra và lúc hệ thống biết việc đó.        |
| Bằng chứng       | source_uri, content_hash, blob_ref, evidence_ids                              | Mở lại bản nội dung đã tạo ra kết luận.                      |
| Hiệu lực         | valid_from, valid_to, superseded_by                                           | Phân biệt quyết định hiện hành và lịch sử.                   |
| Nguồn khẳng định | observed, reported, inferred, proposed, disputed                              | Không biến lời báo cáo hay suy luận thành sự thật.           |
| Xử lý và quyền   | schema_version, extractor_version, model_id, scope_id, deletion_state         | Tái lập, nâng cấp và thực thi phạm vi dữ liệu.               |
| Hành động        | action_id, draft_hash, conversation_id, receipt_id, verification_evidence_ids | Liên kết yêu cầu, nội dung được phép gửi và kết quả thực tế. |

Thời gian lưu ở UTC và hiển thị theo Asia/Ho_Chi_Minh; vẫn giữ timezone gốc nếu có. Dữ liệu từ máy có đồng hồ sai được đánh dấu và xử lý bằng metadata nguồn. Không mặc định bản nhập sau là quyết định đúng hơn.

## Nhận diện dự án

Ưu tiên ánh xạ xác định được từ URL repo, thư mục gốc, ID phiên và cấu hình nguồn. AI chỉ bổ sung gợi ý khi thiếu metadata. Các tên như X-BOSS và xboss có thể là bí danh; quan hệ này có thể sửa và được ghi lại. Dữ liệu chưa rõ dự án được đưa vào hộp chờ phân loại, không âm thầm gán sang dự án gần giống.

Một tài liệu hoặc hội thoại có thể liên quan nhiều dự án; giữ identity nguồn và các liên kết riêng. Bộ lọc truy hồi phải kiểm người dùng, workspace, dự án và quyền nguồn trước khi đưa dữ liệu cho model. Quyền xem một bằng chứng và quyền gửi nội dung đó ra một cuộc hội thoại được kiểm tra riêng.

## Luồng trả lời và thực thi

Tin đến được lưu nguyên bản, khử trùng lặp và gắn account/conversation/project trước khi AI xử lý. AI lấy ngữ cảnh đã lọc quyền, soạn bản nháp có evidence, rồi áp chính sách hành động. Bản nháp và người nhận phải được cố định bằng identity và hash khi tạo intent; trước gửi kiểm tra tin mới, người dùng đã trả lời hay sửa nháp và trạng thái target.

Ghi intent cùng việc cần xử lý trong một transaction thông qua adapter tương thích hoặc bảng outbox. pg-boss giao job ít nhất một lần nên handler có thể chạy lại khi crash; giữ action ledger độc lập với retention của job. Transactional outbox giải quyết bàn giao dữ liệu và công việc, còn tác dụng gửi ra ngoài vẫn cần idempotency hoặc đối soát. \[S29\] \[S30\]

| **Trạng thái nghiệp vụ** | **Ý nghĩa**                                       | **Bước tiếp theo**                                   |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------- |
| draft                    | Bản nháp đã được tạo và có phiên bản.             | Sửa hoặc kiểm phạm vi quyền.                         |
| queued                   | Intent bền vững, đủ điều kiện thực thi.           | Worker nhận việc với lease.                          |
| dispatching              | Đã bắt đầu gọi dịch vụ hoặc thao tác UI.          | Đọc kết quả; lưu mốc dispatch.                       |
| confirmed                | Có receipt từ dịch vụ hoặc bằng chứng UI phù hợp. | Ghi rõ mức xác nhận; không suy ra người nhận đã đọc. |
| send_unknown             | Có thể đã gửi nhưng chưa xác minh được.           | Đối soát trước khi cân nhắc gửi lại.                 |
| blocked hoặc failed      | Thiếu điều kiện hoặc có bằng chứng lỗi.           | Giữ nguyên ngữ cảnh và hướng xử lý.                  |

Với UI, ok true chưa chứng minh hành động nghiệp vụ thành công. Kiểm đúng account/thread, nội dung, thời điểm và trạng thái hiển thị sau thao tác. Khi response mất sau dispatch, không dùng retry queue thông thường để bấm gửi lại. Bỏ qua các sự kiện do chính agent tạo khi xét yêu cầu trả lời; debounce cụm tin liên tiếp và ngăn hai tác vụ sửa cùng draft. \[S26\]

# 6 Kiểm chứng trạng thái và tìm kiếm

| **Kết luận**              | **Bằng chứng cần có**                                     | **Không được suy ra từ**                 |
| ------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| Agent báo hoàn tất        | Báo cáo hoặc thông điệp của phiên agent.                  | Không tự coi là triển khai thành công.   |
| Kiểm tra đạt              | Kết quả các check cần thiết trên đúng phiên bản hoặc SHA. | Màu xanh của một phiên hoặc commit khác. |
| Đã merge                  | Trạng thái PR và commit đích được nguồn xác nhận.         | Lời đề nghị merge hoặc CI đạt.           |
| Đã deploy                 | Bản ghi triển khai có môi trường, phiên bản và kết quả.   | PR merged hoặc release tag đơn lẻ.       |
| Production đang hoạt động | Quan sát vận hành phù hợp, kèm thời điểm.                 | Một lần deploy thành công trong quá khứ. |

Ví dụ kiểm thử bắt buộc: chat ghi đã xong, PR đã merge nhưng chưa có bằng chứng VPS chạy bản đó. Hồ sơ phải giữ ba trạng thái này riêng biệt và báo chưa có nguồn xác nhận triển khai. Quy tắc CI xanh rồi merge rồi deploy của người dùng được mô hình hóa bằng các mốc có bằng chứng, không bằng một nhãn hoàn tất duy nhất.

Đối với dữ liệu mâu thuẫn, hệ thống trình bày các nguồn và phạm vi mà mỗi nguồn chứng minh. API CI là căn cứ cho kết quả job; phát biểu trực tiếp của người dùng là căn cứ cho quyết định sản phẩm. Không dùng một thứ hạng nguồn duy nhất để phán xét mọi loại thông tin.

## Quy trình truy vấn

Truy vấn bắt đầu bằng lọc dự án, phạm vi quyền, thời gian và trạng thái xóa. Bắt đầu bằng tìm kiếm chính xác và toàn văn; có thể bổ sung tìm theo ý nghĩa khi bộ thử chứng minh lợi ích. Đọc lại bằng chứng đã xếp hạng trước khi tạo câu trả lời. Các câu hỏi cấu trúc như PR đã merge hay bản nào đang chạy được trả lời từ bảng trạng thái có nguồn, không chỉ từ vector.

Kiểm thử tiếng Việt có dấu và không dấu, tên riêng, tên repo, mã lỗi và SHA. Dùng tìm kiếm chính xác và full-text trong Postgres, lựa chọn cấu hình tách từ và chuẩn hóa bằng bộ thử tiếng Việt. GIN là loại chỉ mục được tài liệu PostgreSQL ưu tiên cho text search. Nếu semantic retrieval cải thiện chất lượng, thêm pgvector trong cùng Postgres; khi đổi embedding, xây chỉ mục có phiên bản, không trộn vector khác không gian. \[S31\] \[S15\]

Một câu trả lời có căn cứ vẫn có thể sai diễn giải. Bộ đánh giá phải kiểm tra cả tính đúng của nội dung và việc nguồn thật sự chứng minh phát biểu, thay vì chỉ đếm số đường dẫn xuất hiện.

# 7 Lưu trữ nhiều năm và quyền sở hữu dữ liệu

## Chính sách giữ lịch sử

Giữ dài hạn bằng chứng đã thu trong phạm vi được chọn, các phiên bản, quyết định và lịch sử hành động. Thay chính sách xóa inbox mặc định sau 365 ngày của PR 18 đối với dữ liệu công việc cần lưu; không tắt việc dọn phiên đăng nhập và mã xác minh hết hạn. Khử trùng lặp nội dung giống hệt nhưng giữ metadata của từng lần xuất hiện. \[S22\]

Ảnh màn hình có hai chế độ thu: theo sự kiện hoặc theo khoảng thời gian cấu hình. Mọi ảnh đã chọn lưu đều theo chính sách giữ dài hạn. Chụp theo sự kiện không được quảng bá là bản ghi từng khung hình của mọi hoạt động. Khi dung lượng gần đầy, hệ thống cảnh báo, tạm dừng hoặc chuyển sang kho đã cấu hình; không âm thầm xóa lịch sử.

Sự kiện một tài liệu bị xóa ở nguồn khác với yêu cầu người dùng xóa khỏi kho lịch sử. Với kho cá nhân hợp lệ, bản lưu cũ có thể được giữ và gắn nhãn nguồn đã xóa. Khi người dùng yêu cầu purge, nội dung phải được gỡ khỏi bản gốc, chỉ mục, bản tổng hợp, cache và các thiết bị theo chính sách đồng bộ; backup xử lý theo lịch xóa đã công bố.

## Sao lưu và phục hồi

MVP cần một bản chính và ít nhất một bản sao lưu mã hóa ở vị trí độc lập; phương án vận hành hướng đến ba bản ở hai loại nơi lưu, trong đó một bản ngoài máy chính. Các bản backup quay vòng có thể được thay thế, còn kho lịch sử chính vẫn giữ nội dung đã cấu hình.

Backup Postgres phải nhất quán và đi kèm danh mục blob bất biến, hash, schema, cấu hình cần phục hồi và khóa đã được bảo vệ. pg_dump tạo snapshot nhất quán của database; cần lưu riêng các đối tượng cấp cluster cần thiết như roles. Bản sao blob phải chứa đủ mọi blob được manifest của snapshot tham chiếu. Khi yêu cầu RPO chặt hơn, đánh giá base backup và WAL/PITR. \[S39\] \[S40\]

Mục tiêu ban đầu là sao lưu hằng ngày và kiểm thử phục hồi trước khi dùng thường xuyên. Sau phục hồi, phải đọc được bản gốc, dựng lại tìm kiếm và trả lời được câu hỏi kiểm chứng. Các yêu cầu xóa trước đó phải được áp lại trước khi đưa kho phục hồi vào sử dụng.

Với kho đối tượng có versioning, xóa một tên đối tượng có thể chỉ thêm delete marker trong khi phiên bản cũ vẫn còn. Chính sách purge phải xử lý từng phiên bản và vòng đời backup; không hứa xóa tức thì khỏi thiết bị đang offline. \[S14\]

## Xuất dữ liệu và thay công nghệ

Gói export gồm manifest có phiên bản schema, sự kiện và metadata dạng JSONL hoặc JSON, text UTF-8, file gốc, hash và liên kết bằng chứng. Gói export mã hóa có hướng dẫn phục hồi khóa. Chỉ mục tìm kiếm được phép bỏ và dựng lại; hồ sơ và bằng chứng không được phụ thuộc một model hoặc nhà cung cấp duy nhất.

Nhiều thiết bị gửi sự kiện và blob theo ID/hash qua API về kho chính. MVP có một worker Windows; bổ sung local outbox/cache khi phải chịu mất kết nối. Dùng checkpoint, nhận lại an toàn và đồng bộ trạng thái xóa. Không dùng đồng bộ thư mục để chia sẻ file database đang mở giữa các máy.

# 8 Phạm vi thu thập và bảo vệ dữ liệu

Collector hoạt động trong danh sách app, repo, thư mục và website được chọn. Có nút tạm dừng nhìn thấy được và trạng thái rõ ràng về nguồn đang được thu. Mật khẩu, token, khóa bí mật và ứng dụng ngoài phạm vi phải được loại trừ trước khi ghi khi có thể; bộ lọc được kiểm tra trên cả ảnh, text, log và bản export.

Âm thanh là một nguồn riêng và không thuộc cấu hình MVP mặc định. Thu bản đã lưu, API và transcript được hỗ trợ được ưu tiên; không cần keylogger để đạt mục tiêu hiểu dự án. Nội dung chưa được lưu hoặc chưa hiển thị sẽ được ghi rõ là ngoài độ bao phủ.

Mã hóa đường truyền, volume dữ liệu và backup; quản lý khóa API riêng với nội dung nghiệp vụ. PR hiện mã hóa credential nhưng việc mã hóa toàn bộ dữ liệu lưu trữ cần được cấu hình và kiểm chứng khi triển khai. Worker giữ credential thiết bị bằng cơ chế phù hợp của hệ điều hành; quyền thiết bị có thể thu hồi. Phương án khôi phục khóa phải được thử cùng backup. \[S38\]

AI cục bộ và AI cloud là hai cấu hình xử lý khác nhau. Nếu dùng cloud, chỉ gửi những trích đoạn trong phạm vi cho phép và cần cho tác vụ; hiển thị nhật ký dữ liệu được gửi. Việc thu ở máy cục bộ không đồng nghĩa mọi bước tổng hợp cũng chạy offline.

Nội dung tài liệu, trang web và tin đến là dữ liệu, không tự cấp quyền cho agent hay mở rộng nguồn thu. Chính sách hành động được thực thi bằng code theo người dùng, workspace, thiết bị, app, tài khoản, cuộc hội thoại và loại tác vụ. Có thể cấu hình một lần cho phạm vi tự động; trường hợp vượt phạm vi giữ lại bản nháp hoặc tác vụ cụ thể để xử lý.

## Phạm vi cá nhân và nhóm

Workspace cá nhân chỉ chủ tài khoản truy cập theo mặc định. Nguồn của thành viên không tự được chia sẻ vì cùng workspace. Worker thuộc người dùng và thiết bị; task mang scope nguồn, app và cuộc hội thoại. Quyền đọc và quyền gửi được kiểm tra tại service, không chỉ thể hiện bằng lời nhắc cho model.

Tách quyền thao tác thành đọc/tổng hợp, soạn nháp và thực hiện trong phạm vi. Phạm vi đã cấp được duy trì qua các lần chạy; trường hợp vượt phạm vi đưa ra bản nháp hoặc kết quả cụ thể để người dùng quyết định. Người dùng có thể dừng collector, dừng worker và thu hồi thiết bị.

# 9 Công nghệ và cách tổ chức triển khai

| **Phần**             | **Lựa chọn chốt**                                  | **Cách áp dụng**                                                                                                                                          |
| -------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Giao diện và backend | Next.js, React, TypeScript đang có                 | Giữ cấu trúc hiện tại; bổ sung Hộp thư, Dự án, Tri thức, Trợ lý, Lịch sử, Thiết bị. \[S19\]                                                               |
| Database             | PostgreSQL và Drizzle                              | Kho trung tâm cho nghiệp vụ, quyền, metadata, phiên bản và trạng thái thực thi.                                                                           |
| Hàng đợi             | pg-boss đang có                                    | Ingest, tổng hợp, tạo nháp và đối soát; action ledger tách khỏi vòng đời job. \[S29\]                                                                     |
| Bằng chứng lớn       | Kho blob bền vững theo hash                        | Có thể bắt đầu bằng volume riêng có backup; adapter cho object storage khi cần.                                                                           |
| Đăng nhập và quyền   | Better Auth và workspace hiện có                   | Mở rộng quyền dự án, nguồn riêng tư, thiết bị và hành động.                                                                                               |
| AI                   | Một orchestrator; Vercel AI SDK dưới model adapter | Ưu tiên thư viện TypeScript cho model, streaming và tool calls; quyền, trạng thái và bộ nhớ thuộc X-Working. Ghim bản tương thích trước tích hợp. \[S54\] |
| Windows companion    | Tiến trình riêng gọi Agent Desktop                 | Chủ động nối HTTPS về hub; kiểm scope, target, version và kết quả. \[S24\] \[S25\]                                                                        |
| Tìm kiếm             | Postgres trước, pgvector khi có lợi                | Đo chất lượng tiếng Việt và câu hỏi thực; không buộc thêm một database riêng. \[S31\] \[S15\]                                                             |
| Browser theo nhu cầu | agent-browser dưới adapter                         | Chỉ triển khai nếu workflow pilot cần web app; giữ cùng kênh thử, scope và action ledger. \[S50\] \[S51\]                                                 |

Tổ chức thành các module rõ ràng trong cùng repo: knowledge, conversations, ai, actions và desktop. Tận dụng providers, auth, db và jobs đang có. Web/API và worker nền dùng chung code/domain; có thể chạy cùng tiến trình lúc thử và tách worker server thành process riêng khi vận hành cần. Worker Windows luôn chạy tại phiên desktop phù hợp, không nằm trong request web trên VPS Linux.

Sau khi contract và schema ổn định, có thể phát triển song song nguồn dữ liệu, kho bằng chứng/tìm kiếm và giao diện. Một người chịu trách nhiệm tích hợp và nghiệm thu luồng xuyên suốt. Agent hỗ trợ phát triển không đồng nghĩa phải vận hành nhiều LLM agent cho mỗi tin nhắn; chỉ thêm song song khi có công việc độc lập và lợi ích đo được.

Duy trì kiểm tra tự động theo thay đổi và audit tổng hợp tại các mốc giai đoạn. Tuân thủ CI đạt rồi mới merge; chỉ triển khai sau merge. Bản phát hành của chính hệ thống cũng lưu phiên bản, kết quả kiểm tra và cách quay lui.

## Kết nối worker với hub

Worker Windows chủ động kết nối HTTPS về hub bằng danh tính thiết bị gắn workspace. Backend giao task có ID, thời hạn, account/app/conversation và nội dung đã định phiên bản. Worker xác minh phạm vi và target, thực hiện tuần tự các thao tác tranh chấp input, gửi observation/receipt rồi nhận xác nhận lưu. Ghim version công cụ và hạn chế capabilities ở adapter; MCP chỉ là giao diện gọi công cụ. \[S25\]

Worker chạy trong phiên desktop tương tác của người dùng; bản Windows của Agent Desktop không hỗ trợ locked desktop, UAC secure desktop hoặc Session 0. Tác vụ API có thể tiếp tục trên hub khi máy cá nhân không sẵn sàng. Tác vụ UI được giữ với trạng thái unavailable hoặc waiting_user rồi tiếp tục khi đủ điều kiện. \[S28\]

Snapshot chỉ phản ánh cây UI được ứng dụng cung cấp. Đọc nội dung chat phải giữ static text, không áp dụng interactive-only máy móc. Gắn coverage và các khoảng chưa quan sát; không coi snapshot complete là toàn bộ lịch sử nguồn. Chỉ thu ảnh trong phạm vi cấu hình khi cần bằng chứng hoặc app không cung cấp đủ văn bản. \[S42\]

# 10 Lộ trình theo ba giai đoạn

Ước lượng giả định một lập trình viên toàn thời gian có năng lực full stack, AI hỗ trợ, nền Social Manager được kiểm chứng, có quyền tiếp cận một kênh thật và máy Windows thử. Không bao gồm mọi kênh, mọi app hoặc thương mại hóa đa tổ chức. Thời gian tính từ lúc bắt đầu triển khai phạm vi tích hợp, cần hiệu chỉnh sau thử nghiệm connector và worker.

| **Giai đoạn**             | **Ước lượng lập kế hoạch** | **Kết quả**                                                                                              |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| MVP dùng thử và chỉnh sửa | 4 đến 6 tuần               | Một dự án, một kênh, nguồn repo/file; hỏi đáp có nguồn, nháp, gửi có kiểm chứng và một workflow Windows. |
| Sản phẩm hoàn thiện       | Thêm 4 đến 6 tuần          | Lịch sử cũ, attachment, edit/delete, nhiều nguồn, quyền chi tiết, offline và vận hành.                   |
| Tối ưu                    | Thêm 2 đến 3 tuần          | Đo và giảm chi phí/độ trễ; mở rộng nền tảng hoặc thành phần theo kết quả pilot.                          |

## Giai đoạn MVP

- Tuần 1: rà nền PR 18, chốt kênh và bộ câu hỏi; thử read/reply contract và app Windows; sửa conversation/message identity, retention và kho gốc.

- Tuần 2: hoàn thiện ingest/checkpoint, liên kết dự án và nhập GitHub/file; timeline, coverage và export/backup ban đầu.

- Tuần 3: tìm kiếm, hồ sơ dự án, tổng hợp có căn cứ và bản nháp; bắt đầu dùng hằng ngày.

- Tuần 4: reply workflow, action intent, xác minh, xử lý send_unknown và worker Windows cho một nhiệm vụ.

- Tuần 5 đến 6 nếu cần: hoàn tất thử nghiệm thực, sửa lỗi, kiểm tra phạm vi, crash recovery, restore và nghiệm thu trước giai đoạn hai.

Hoàn thành MVP và vòng sửa theo phản hồi trước khi mở rộng giai đoạn hai. Việc mở ứng dụng được hoặc trả lời vài câu mẫu chưa đủ để kết thúc MVP.

## Giai đoạn sản phẩm hoàn thiện

Bổ sung nguồn và kênh theo nhu cầu thật; nhập lịch sử cũ, attachment và edit/delete; hoàn thiện private source permissions, tự trả lời theo phạm vi, thiết bị offline/reconnect, cập nhật worker và tiếp quản. Giữ export/backup/restore hoạt động liên tục. macOS/Linux chỉ được đưa vào phạm vi phát hành sau khi thử đúng ứng dụng và môi trường mục tiêu.

## Giai đoạn tối ưu

Đo thời gian tìm kiếm, chất lượng trích xuất, chi phí mỗi câu hỏi và khối lượng dữ liệu mới mỗi ngày. Chỉ lập chỉ mục lại phần thay đổi; dùng model nhỏ cho phân loại phù hợp; cache có version; đưa tác vụ nặng vào thời điểm ít ảnh hưởng công việc. Chỉ thêm graph khi bộ câu hỏi quan hệ nhiều bước cho thấy lợi ích.

# 11 Danh sách công việc cho MVP

| **Mã** | **Hạng mục và đầu ra**                                                                  | **Phụ thuộc** |
| ------ | --------------------------------------------------------------------------------------- | ------------- |
| M01    | Cập nhật đặc tả, ADR và phạm vi một dự án/kênh; giữ mốc code nền và bộ câu hỏi chuẩn.   | Khởi đầu      |
| M02    | Thử connector thật và Agent Desktop trên Windows; ghi ma trận khả năng cùng giới hạn.   | M01           |
| M03    | Schema conversation/message/version/source/evidence; giữ đúng ngữ nghĩa dữ liệu cũ.     | M01           |
| M04    | Kho bản gốc, hash, checkpoint, chống trùng và retention theo lớp dữ liệu.               | M03           |
| M05    | Đồng bộ một kênh, phân trang/backfill trong phạm vi API, event edit/delete được hỗ trợ. | M02 M04       |
| M06    | GitHub/file/import phiên; khai mức lưu blob/diff/log/artifact và phần chỉ có metadata.  | M04           |
| M07    | Project links, private scopes, timeline, coverage và nguồn bị gián đoạn.                | M05 M06       |
| M08    | Tìm kiếm, hồ sơ, quyết định và AI trả lời có bằng chứng.                                | M07           |
| M09    | Bản nháp, policy, action ledger, outbox và provider reply contract.                     | M02 M08       |
| M10    | Ghép nối thiết bị; worker Windows nhận task có scope và trả observation/receipt.        | M02 M09       |
| M11    | Xác minh gửi; send_unknown và đối soát; không tự trả lời tin của chính agent.           | M09 M10       |
| M12    | Export/backup/restore/purge, kiểm scope và trạng thái xóa xuyên các lớp.                | Làm từ M04    |
| M13    | Pilot ít nhất bảy ngày, 50 câu hỏi và các ca thực thi bắt buộc; sửa và nghiệm thu.      | M08 M11 M12   |

M05 và M06 có thể làm song song sau M04. M12 đi cùng các chức năng dữ liệu. M02 phải xác minh ít nhất một đường đọc và một đường gửi; nếu app UI không đáp ứng, chọn kênh thử phù hợp và ghi rõ giới hạn, không trình diễn một app mẫu rồi suy ra hỗ trợ mọi app. Các thay đổi được chia thành PR theo mục tiêu dữ liệu, AI, reply và worker.

# 12 Tiêu chí nghiệm thu và bộ câu hỏi chuẩn

Ngưỡng sau đây là mục tiêu thử nghiệm đề xuất. Chúng cần được đo trên dữ liệu và thiết bị thực tế; không được trình bày như tỷ lệ thành công đã đạt.

| **Tiêu chí**                   | **Mục tiêu cho MVP**                                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Câu trả lời đúng có bằng chứng | Ít nhất 45 trong 50 câu chuẩn đúng nội dung và có nguồn phù hợp; công bố riêng từng nhóm câu hỏi.                                                                                         |
| Trạng thái quan trọng          | Không có ca nhầm CI đạt thành đã deploy, đề xuất thành quyết định hoặc báo cáo agent thành hoàn tất trong tập kiểm thử bắt buộc.                                                          |
| Dữ liệu không đủ               | Tất cả ca thiếu nguồn hoặc nguồn mâu thuẫn đã cài trong bộ thử phải được nhận diện và nêu rõ.                                                                                             |
| Bằng chứng truy nguyên         | Mở được đúng phiên bản bằng chứng đã thu dù URL nguồn không còn hoạt động. Mất bản đã lưu hoặc sai hash là lỗi nghiệm thu. Nội dung chưa từng thu đủ phải được đánh dấu thiếu bằng chứng. |
| Nhập và retry                  | Ngắt mạng, nhận event trùng và nhận muộn không làm mất đối tượng trong tập kiểm tra hoặc nhân đôi kết quả.                                                                                |
| Lịch sử quyết định             | Xem được quyết định hiện hành và bản cũ đúng khoảng hiệu lực; nhập muộn không làm sai lịch sử.                                                                                            |
| Lưu và phục hồi                | Export/import và backup/restore giữ được nội dung, liên kết bằng chứng, quyền và trạng thái xóa đã thử.                                                                                   |
| Phạm vi thu                    | Nguồn ngoài danh sách không xuất hiện trong raw, text, index hoặc export của bộ kiểm thử loại trừ.                                                                                        |
| Sử dụng thực tế                | Dùng ít nhất bảy ngày, tìm lại quyết định và tiếp tục được một việc đang dở từ gói bàn giao.                                                                                              |
| Gửi tin và khôi phục           | Không có ca gửi nhầm người, gửi trùng hoặc báo đã gửi khi chưa xác minh trong bộ thử bắt buộc; crash sau dispatch được đưa vào đối soát.                                                  |
| Worker và người dùng           | Đổi cửa sổ/chat, sửa nháp, máy khóa hoặc app đăng xuất được phát hiện đúng; tác vụ không tự đổi đích hoặc nâng quyền.                                                                     |
| Tách phạm vi                   | Không lẫn dữ liệu giữa workspace/project/nguồn riêng; dữ liệu đọc được không mặc định được gửi cho mọi người nhận.                                                                        |

Bộ 50 câu gồm 15 câu tình trạng có cấu trúc, 10 câu lý do quyết định, 10 câu diễn biến và phiên bản, 5 câu bàn giao, cùng 10 câu thiếu dữ liệu hoặc mâu thuẫn. Kết quả cần có người kiểm tra bằng nguồn, tránh dùng chính model tạo câu trả lời làm trọng tài duy nhất.

- X-Templates đang ở giai đoạn nào theo bằng chứng đã có và nguồn nào còn thiếu?

- PR cụ thể đã merge chưa; check đạt thuộc SHA nào?

- Có nguồn xác nhận phiên bản đang chạy trên VPS hay mới chỉ có kết quả CI?

- Vì sao đã chọn một hướng thiết kế; quyết định nào thay thế hướng trước?

- Tài liệu thay đổi điều gì giữa hai phiên bản và ai hoặc nguồn nào tạo thay đổi?

- Phiên làm việc gần nhất còn dở việc gì; gói bàn giao cần những nguồn nào?

- Nếu nguồn ngừng đồng bộ từ hôm qua, câu trả lời phải hiện dữ liệu tính đến thời điểm nào?

- Sau khi xóa một nguồn theo yêu cầu, AI có còn trả lời từ cache hoặc bản tóm tắt cũ không?

- Người dùng đã trả lời trong lúc AI đang soạn thì tác vụ có còn gửi một câu trùng nữa không?

- Mất kết nối ngay sau gửi có được ghi là chưa rõ và đối soát thay vì gửi lại không?

- Sau khi ngắt kết nối tài khoản, lịch sử được chọn lưu còn truy lại đúng không?

Độ bao phủ được tính trên tập nguồn đã cấu hình và có mẫu số kiểm chứng được, không phải phần trăm mọi hoạt động trên máy. Độ mới đo riêng từng nguồn. Hiệu năng và tài nguyên được đo trong pilot trước khi chốt ngưỡng phát hành cho máy đích.

# 13 Dung lượng và chi phí vận hành

Các phép tính sau dùng đơn vị thập phân và 250 ngày làm việc mỗi năm. Đây là mô hình minh họa để chọn chế độ thu, chưa phải số liệu máy của người dùng. Chưa tính chỉ mục, metadata, backup hoặc tăng trưởng nội dung theo thời gian.

| **Giả định thu mỗi ngày làm việc**                     | **Dung lượng một năm** |
| ------------------------------------------------------ | ---------------------- |
| 1000 bản ghi text mới, trung bình 4 kB                 | 1 GB                   |
| 50 phiên bản file mới, trung bình 1 MB                 | 12,5 GB                |
| 100 ảnh được thu theo sự kiện, trung bình 250 kB       | 6,25 GB                |
| Tổng ba nhóm trên                                      | 19,75 GB               |
| Chỉ ảnh mỗi 10 giây, 8 giờ mỗi ngày, trung bình 200 kB | 144 GB                 |
| Chỉ ảnh mỗi giây, 8 giờ mỗi ngày, trung bình 200 kB    | 1,44 TB                |

Kịch bản ba nhóm đầu tương đương khoảng 98,75 GB bằng chứng trong năm năm. Nếu lưu ba bản độc lập có cùng dung lượng thì riêng phần đó khoảng 296,25 GB, trước chỉ mục và các phiên bản backup bổ sung. Kịch bản ảnh mỗi giây tương đương khoảng 7,2 TB trong năm năm cho một màn hình, trước các phần khác.

Lưu dài hạn dữ liệu đã thu không bắt buộc phải lấy mọi khung hình. Khuyến nghị thu theo sự kiện có ngữ cảnh, kết hợp dữ liệu gốc đầy đủ từ API và file. Người dùng vẫn có thể chọn lưu ảnh dày hơn; dung lượng và phạm vi thực tế phải được hiển thị.

Chi phí cần theo dõi tách riêng: ổ đĩa và backup, máy hoặc VPS, gọi model, OCR/embedding, truyền dữ liệu và giấy phép thành phần. Không gắn một mức tiền cố định trước khi đo số tài liệu mới, số câu hỏi và lượng ảnh trong bảy ngày sử dụng.

Tối ưu chi phí bằng hash và version để không xử lý lại nội dung không đổi; chỉ gửi phần liên quan cho AI; cache kết quả theo phiên bản; giới hạn ngân sách theo dự án. Không giảm chi phí bằng cách xóa bằng chứng mà chính sách đã yêu cầu giữ.

# 14 Rủi ro cần kiểm chứng sớm

| **Rủi ro**                          | **Ảnh hưởng**                                          | **Cách kiểm chứng hoặc xử lý**                                                      |
| ----------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Nguồn chỉ cho lịch sử hữu hạn       | Thiếu diễn biến cũ nhưng dashboard tưởng đầy đủ.       | Backfill theo API đối tượng; công bố mốc bắt đầu và khoảng thiếu.                   |
| Collector ghi ngoài phạm vi         | Dữ liệu nhạy cảm lọt vào raw hoặc export.              | Kiểm tra trước khi bật, cả ảnh/text/log; collector độc lập có thể thay thế.         |
| OCR tiếng Việt hoặc UI tùy biến sai | Trích xuất nhầm tên, số hoặc ngữ cảnh.                 | Tập mẫu tiếng Việt và đối chiếu bản gốc; ưu tiên nguồn cấu trúc.                    |
| Nhầm dự án hoặc quyết định          | Kế hoạch dựa trên thông tin sai.                       | Metadata xác định được, hộp chờ phân loại, sửa có lịch sử.                          |
| Mất mạng hoặc máy ngủ               | Nguồn cũ, event đến muộn hoặc thiếu.                   | Outbox, checkpoint, đối soát và chỉ báo độ mới.                                     |
| Đầy ổ hoặc mất khóa                 | Ngừng thu hoặc không đọc được lịch sử.                 | Cảnh báo sớm, backup độc lập và diễn tập khôi phục khóa.                            |
| Thay đổi giấy phép hoặc API         | Không thể tiếp tục dùng thành phần như dự kiến.        | Adapter và contract riêng; ghi version; không phụ thuộc một collector.              |
| Tóm tắt làm mất chi tiết            | Không sửa được kết luận hoặc giải thích quyết định cũ. | Giữ bản gốc; summary và vector là dữ liệu dựng lại được.                            |
| Gửi không rõ kết quả                | Retry mù có thể tạo tin trùng.                         | Intent bền vững, receipt, trạng thái send_unknown và đối soát trước lần gửi mới.    |
| Worker dùng nhầm cửa sổ             | Sai người nhận hoặc thay đổi không đúng mục tiêu.      | Gắn app/account/thread, đọc lại target; điều phối input vật lý và hỗ trợ tiếp quản. |
| Model ghi nhớ thiếu                 | Fact tóm tắt làm mất bối cảnh.                         | Giữ nguồn nguyên bản; memory có version và evidence; xem lại dữ liệu gốc khi cần.   |

Ba kiểm chứng quan trọng nhất trước khi mở rộng là: nguồn có đủ dữ liệu để trả lời các câu hỏi thật không; lịch sử có phục hồi và export độc lập được không; và lớp thu thập có giữ đúng phạm vi mà không ảnh hưởng công việc hằng ngày không.

# 15 Cải thiện từ kho stored

Đã quét toàn bộ catalog tại commit aaf39157906cb4e985ce8e023c3b6ca548802978: 1.577 hồ sơ, 34 chuyên mục và 69 category. Phần giới thiệu README vẫn ghi 1.040 hồ sơ; số 1.577 được tính từ mảng projects và khớp meta.count. Đọc sâu các nhóm liên quan tới memory/tài liệu, agent/browser, giao thức, eval, quyền, hợp đồng và vận hành; kiểm lại tài liệu hoặc mã nguồn của các thành phần được chọn. Phạm vi này là rà danh mục và kiểm chứng ứng viên, không phải chạy thử toàn bộ 1.577 dự án. \[S43\] \[S44\]

Kết quả giữ nền Next.js, Postgres, pg-boss và Agent Desktop, đồng thời làm cụ thể hơn chất lượng dữ liệu, khả năng thực thi và phép đo. Lưu bản gốc độc lập model, thời gian hiệu lực, phạm vi nguồn, quyền/xóa và bộ 50 câu vốn đã có trong kế hoạch; đây là các quyết định được nghiên cứu mới củng cố. Những thay đổi bên dưới là phần bổ sung.

| **Cải thiện**                           | **Giá trị trực tiếp**                                                    | **Phạm vi**                         |
| --------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| Nguồn tri thức stored                   | Hỏi và so sánh công cụ trên hồ sơ có nguồn, revision và tuổi bằng chứng. | Importer thuộc nguồn GitHub MVP.    |
| Tài liệu có locator và chất lượng xử lý | Mở lại đúng trang/đoạn; biết tài liệu mới đọc được một phần.             | Contract MVP; parser theo corpus.   |
| Khả năng theo nguồn và thiết bị         | Chọn đúng đường API/browser/native, biết giới hạn thật.                  | Contract MVP; browser có điều kiện. |
| Task tiếp tục được và có phiên bản      | Tải lại UI hoặc nâng cấp hub không làm mất hay lặp hành động.            | MVP.                                |
| Context gọn và playbook                 | Lưu đầy đủ nhưng chỉ đưa phần cần dùng vào model.                        | MVP với ba quy trình nhỏ.           |
| Eval và đo vận hành tách tầng           | Biết lỗi ở nguồn, tìm kiếm, câu trả lời hay thực thi; đo chi phí thực.   | MVP; dashboard lớn sau.             |

## 15.1 Dùng stored làm một nguồn tri thức của X-Working

stored giữ vai trò kho hồ sơ và đánh giá theo WORKFLOW.md; code tích hợp đặt trong X-Working. Importer đọc data/projects.json cùng hồ sơ Markdown được dẫn tại cùng một commit, lưu snapshot và liên kết nguồn. Dùng id của thực thể làm khóa trong phạm vi nguồn, vì một upstream có thể có nhiều hồ sơ sản phẩm/plugin/skill; repo không phải khóa duy nhất. Nội dung nghiên cứu được xử lý như dữ liệu, không tự cấp quyền cài plugin hoặc chạy lệnh. \[S43\] \[S44\] \[S45\]

| **Nhóm dữ liệu**    | **Trường cần giữ**                                            | **Ý nghĩa**                                                  |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Định danh           | source_id, entity_id, profile_path, profile_anchor            | Theo dõi đúng một hồ sơ qua nhiều lần cập nhật.              |
| Nguồn và thời gian  | source_commit, blob_hash, retrieved_at, last_verified_at      | Ngày tải catalog khác ngày kiểm chứng hồ sơ.                 |
| Mức bằng chứng      | verification_level, verified_ref, sources, verification_scope | Phân biệt đọc docs, đọc code, chạy kiểm và quan sát sử dụng. |
| Quyết định ứng dụng | project_id, decision, reason, evidence_ids, status            | Tách được khuyến nghị khỏi đã tích hợp và đã vận hành.       |

Khi catalog đổi, tạo snapshot mới và cập nhật projection theo entity_id; hồ sơ bị gỡ khỏi catalog hiện hành được ghi trạng thái, còn snapshot lịch sử vẫn phục vụ câu hỏi theo thời điểm. Giữ nguyên giá trị verification_level gốc và ánh xạ có version nếu X-Working dùng hệ phân loại khác. Hồ sơ chưa có ngày/mức kiểm để trống hoặc unassessed; không tự nâng mức khi nhập.

Các câu hỏi pilot có thể gồm: công cụ nào trong stored phù hợp nhập PDF của dự án; vì sao trước đây chọn pg-boss; đề xuất nào đã được thử ở X-Working; nhận định nào cần kiểm lại. Kết luận có liên kết về hồ sơ tại commit cụ thể và nguồn upstream. Với tài liệu SDK, lưu cả requested_version và served_version khi có: Context7 hiện có thể trả tài liệu phiên bản khác nếu bản yêu cầu chưa được index. \[S62\]

## 15.2 Nhập tài liệu có chất lượng và vị trí bằng chứng

Đặt hợp đồng dữ liệu trước khi chọn parser: mỗi lần xử lý ghi source version/hash, parser revision, model revision và config hash. Mỗi trang hoặc phần tài liệu có trạng thái success, partial, failed hoặc unprocessed; lưu số trang đã xử lý và cảnh báo. Bằng chứng có locator trang, section/block và bbox khi nguồn cung cấp. Với HTML, message hoặc code, dùng locator tương ứng thay vì tạo số trang giả.

Docling là ứng viên ưu tiên cho adapter tài liệu khi corpus pilot cần PDF/scan: DoclingDocument hỗ trợ cấu trúc, bảng, provenance và bounding box khi có. Kiểm mã converter cho thấy PARTIAL_SUCCESS vẫn là kết quả có thể được trả về; X-Working phải kiểm trạng thái thay vì coi không ném lỗi là đọc đủ. Đặt rõ quota file/trang, timeout, RAM/concurrency và quản lý model artifacts; tài liệu chính thức nêu model có thể được tải ở lần dùng đầu. \[S46\] \[S47\] \[S48\]

Khóa cache của một bước gồm source_hash cùng các revision/config mà bước đó phụ thuộc. Chunk, embedding, claim và summary giữ liên kết về processing run; đổi parser chỉ làm mới phần dẫn xuất bị ảnh hưởng. Giữ bản gốc bất biến theo hash và thực thi quyền/xóa xuyên qua các liên kết này. Bộ xử lý nặng chạy ngoài request web; không biến Python/parser thành một phần bắt buộc của mọi tác vụ.

Chia đoạn theo cấu trúc: hội thoại giữ message gốc và mở rộng vài lượt lân cận khi cần; tài liệu theo heading/block; bảng giữ cấu trúc hoặc locator; repo theo đường dẫn, symbol và SHA. Phần mở rộng ngữ cảnh vẫn qua lọc quyền và thời gian. MVP chỉ hỗ trợ định dạng thật của pilot; OCR nhiều loại tài liệu thuộc giai đoạn hoàn thiện nếu pilot chưa cần.

## 15.3 Danh mục khả năng và đường thực thi phù hợp

Bổ sung capability registry theo nguồn, tài khoản, adapter và thiết bị. Các khả năng có thể gồm read_thread, read_messages, backfill, read_attachment, reply và verify_send. Mỗi khả năng giữ trạng thái khả dụng, phạm vi được cấp, giới hạn lịch sử/phân trang, phiên bản adapter và mức bằng chứng kết quả. Tên nền tảng hoặc kết nối MCP thành công không đồng nghĩa mọi khả năng đều có.

Chọn API phù hợp trước; dùng browser adapter cho tác vụ web; dùng Agent Desktop cho app native hoặc phần UI cần thiết. Đây là định tuyến theo nhiệm vụ, không phải luôn chạy lần lượt mọi công cụ. Sau khi đã dispatch một hành động ghi mà kết quả chưa rõ, không tự chuyển adapter để gửi lại; mọi đường thực thi dùng cùng action_id và quy tắc đối soát.

agent-browser là ứng viên bổ sung cho Companion nếu workflow pilot cần web app. Với CDP, pin target/tab và kiểm account/thread trước bước ghi. Tài liệu hiện tại từ chối kết hợp allowed-domains với cdp, auto-connect, profile, restore hoặc saved state; không giả định một Chrome đang đăng nhập được bảo vệ bằng chính allowlist đó. Browser được quản lý từ đầu và browser gắn vào phiên có sẵn phải có contract khác nhau. \[S50\] \[S51\]

## 15.4 Task có sự kiện, tiếp tục được và tương thích phiên bản

Mỗi lượt có run_id; sự kiện UI có thứ tự để tải snapshot rồi nối tiếp từ cursor khi mất kết nối. Hiển thị bước thu thập, nguồn đã dùng, bản nháp, công việc chờ, kết quả và phần chưa xác minh. Học cách tổ chức sự kiện có kiểu của AG-UI; MVP có thể dùng SSE mỏng và component do ứng dụng kiểm soát. Giao thức streaming không tự cung cấp lưu trạng thái bền vững. \[S52\]

Thêm workflow_revision, step_id, protocol_version và schema_version vào các contract phù hợp. Task/receipt lưu draft_hash, policy revision, target identity và evidence IDs. Khi resume sau chờ, kiểm lại quyền hiện hành, người nhận, tin mới và nội dung đã sửa. Deploy phải còn đọc được task của bản đã phát hành hoặc có migration rõ; không ép task cũ chạy ngầm bằng logic mới.

Nút dừng gửi yêu cầu hủy tới server; đóng stream hoặc đóng tab không chứng minh tác vụ đã dừng. Phân biệt cancel_requested, cancelled và hành động đã dispatch đang đối soát. Tải lại giao diện đọc trạng thái đã lưu, không tạo lượt gửi mới. Kiểm cả companion cũ với hub mới trước phát hành khi đã có người dùng thiết bị.

## 15.5 Ngân sách context và ba playbook ban đầu

Tool lưu output đầy đủ trong phạm vi được phép rồi trả về ID, trích đoạn liên quan, mức đầy đủ và cursor lấy tiếp. Model chỉ nhận ngữ cảnh đúng dự án/tác vụ và tập tool phù hợp capability registry. Giới hạn context không làm cắt bản gốc. Code chặn bước mới khi hết ngân sách bước/thời gian/token/chi phí; vẫn lưu receipt và đối soát hành động đã dispatch.

- Playbook 1: tổng hợp tình hình dự án từ các thay đổi và bằng chứng gần nhất.

- Playbook 2: đọc hội thoại, lấy ngữ cảnh, tạo bản nháp và thực hiện phản hồi trong phạm vi đã cấp.

- Playbook 3: lưu một nguồn vào dự án, trích thông tin và tạo liên kết tra cứu.

Mỗi playbook có đầu vào, điều kiện kích hoạt, nguồn cần đọc, khả năng được dùng, đầu ra, bằng chứng hoàn tất, revision và ca nghiệm thu. Học progressive disclosure của Agent Skills: nạp metadata trước, hướng dẫn và tài nguyên khi cần. Quyền thực thi vẫn nằm ở code của X-Working; trường allowed-tools trong spec còn experimental và không thay được kiểm quyền. Recorder tạo playbook từ phiên làm mẫu để sau MVP. \[S53\]

## 15.6 Bộ đánh giá và vận hành có thể giải thích

Nâng bộ 50 câu thành dataset có version với case_id, loại câu, thời điểm, corpus revision, relevant_evidence_ids, đáp án kỳ vọng và điều kiện phải trả lời chưa đủ dữ liệu. Đo retrieval riêng với generation: Recall@k cho tìm bằng chứng; độ đúng và nguồn hỗ trợ cho câu trả lời. Nhóm thời gian, cập nhật kiến thức và abstention học từ LongMemEval, nhưng corpus nghiệm thu vẫn là dữ liệu tiếng Việt của pilot. \[S57\]

Promptfoo là lựa chọn chạy eval ở môi trường phát triển, không phải dịch vụ production bắt buộc. Adapter eval phải gọi pipeline retrieval/orchestrator thực của X-Working. Ghi model, prompt, tool, policy và dataset revision. Tách replay hồi quy khỏi các lần gọi model mới; tài liệu Promptfoo nêu cần no-cache khi mỗi lần lặp phải gọi provider thật. Không lấy kết quả cache để báo chất lượng biến thiên mới. \[S56\]

Dùng run_id/action_id để nối hub, queue và Companion. Log vận hành giữ status, latency, token, error và ID tham chiếu; nội dung gốc nằm ở kho bằng chứng có quyền. OpenTelemetry GenAI hiện có quy ước NO_CONTENT mặc định và opt-in riêng cho nội dung; cần pin revision vì bộ conventions còn Development. Kiểm bằng dữ liệu giả có dấu nhận diện để chắc nội dung không đi vào exporter ngoài ý muốn. \[S58\]

Bổ sung các chuỗi kiểm: webhook trùng hoặc đến sai thứ tự; thu hồi quyền giữa lúc chờ; sửa draft; đổi tab/thread; gửi xong mất ACK; source bị purge sau tạo summary; nâng hub trong khi companion cũ còn chạy. Dùng test runner hiện có trước. Schemathesis là lựa chọn khi contract OpenAPI đủ để sinh chuỗi thử; nó không tự định nghĩa kỳ vọng nghiệp vụ. \[S60\]

Khi cần gate OpenAPI, oasdiff phải có fail-on rõ; mặc định rỗng không làm CI thất bại. Đặt review false nếu chỉ cần so sánh trong CI. Diff contract bổ sung cho thử runtime, không thay kiểm phân quyền, idempotency hay tác dụng bên ngoài. \[S59\]

| **Chỉ số pilot**                      | **Cách dùng để quyết định**                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Tìm đúng nguồn và trả lời có căn cứ   | Phân biệt lỗi nhập dữ liệu, retrieval và generation; so cùng corpus trước khi thêm vector/reranker. |
| Thời gian tới bản nháp được chấp nhận | Tính cả thời gian sửa tay; không chỉ đo thời gian model trả token.                                  |
| Tác vụ được xác minh và send_unknown  | Theo dõi tỷ lệ hoàn tất, thời gian đối soát và nguyên nhân thất bại.                                |
| Chi phí trên công việc được chấp nhận | Tính token, retry, lượt sửa và xử lý tài liệu; lấy số pilot để chọn model/cache.                    |

## 15.7 Thành phần được chọn và điều kiện bổ sung

| **Thành phần**            | **Quyết định cho X-Working**                                                                                                                    | **Thời điểm**                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Vercel AI SDK             | Ưu tiên cho model adapter, streaming và tool calls trong TypeScript; state, policy và archive thuộc ứng dụng. \[S54\]                           | Khi triển khai AI MVP.               |
| assistant-ui              | Tham khảo hoặc dùng phần UI chat khi tiết kiệm công; tránh thêm cả hệ UI thứ hai trước khi cần. \[S55\]                                         | Tùy thiết kế giao diện.              |
| Docling                   | Parser qua adapter; giữ output trung gian, locator và trạng thái partial. \[S46\]                                                               | Theo corpus pilot hoặc giai đoạn 2.  |
| agent-browser             | Công cụ web bổ sung cho Agent Desktop, dùng chung policy/action ledger. \[S50\] \[S51\]                                                         | Chỉ khi workflow pilot cần.          |
| Promptfoo                 | Eval phát triển với dữ liệu và phiên bản rõ; có thể dùng harness tương đương đang có. \[S56\]                                                   | MVP.                                 |
| OpenTelemetry             | Lấy schema và instrument mức cần thiết; chưa dựng backend observability riêng. \[S58\]                                                          | MVP cơ bản, mở rộng sau.             |
| ActivityWatch             | Tham khảo/import metadata hoạt động để ghép timeline. Watcher theo dõi app, cửa sổ, tab, trạng thái AFK; không coi là archive nội dung. \[S61\] | Sau MVP, phạm vi bật rõ.             |
| Open Notebook             | Tham khảo UX tổ chức nguồn và hỏi đáp nghiên cứu; giữ Postgres/codebase hiện tại. \[S63\]                                                       | Tham khảo thiết kế.                  |
| Hindsight và graph memory | Chưa dùng làm lõi. Docs Hindsight Retain nêu chỉ giữ facts trích xuất, không giữ content nguyên văn. \[S49\]                                    | Chỉ thử khi eval chứng minh lợi ích. |

Không đưa thêm Temporal, LangGraph, graph DB, vector DB riêng, nền tảng low-code, Kubernetes hoặc dịch vụ logging lớn thành yêu cầu MVP. Mỗi thành phần chỉ được thêm khi có khoảng thiếu cụ thể, phép thử cùng baseline và chi phí vận hành chấp nhận được. Đây là lựa chọn phạm vi của X-Working, không phải kết luận các công cụ đó kém chất lượng.

## 15.8 Ghép cải thiện vào backlog hiện có

| **Backlog** | **Bổ sung cần làm**                                                               | **Điều kiện nghiệm thu**                                              |
| ----------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| M01–M04     | Contract nguồn/evidence, processing run, locator, capability và workflow version. | Không làm mất ý nghĩa dữ liệu cũ; xử lý partial rõ ràng.              |
| M05–M07     | Importer stored, source snapshot, danh mục khả năng và giới hạn từng nguồn.       | Đối chiếu đúng commit/ID; ngày tải không đổi ngày kiểm.               |
| M08         | Model adapter, retrieval có nhãn nguồn, context budget và playbook tổng hợp.      | Trả lời có evidence; mở được bản gốc; không lẫn phạm vi.              |
| M09–M11     | Run events/resume, task tương thích, browser nếu cần, kiểm lại target trước ghi.  | Mất stream không tạo send mới; không đổi adapter khi send_unknown.    |
| M12–M13     | Truy vết dữ liệu dẫn xuất, eval có version, trace metadata và số đo outcome.      | Purge/restore và các ca trạng thái critical đạt; pilot đủ bằng chứng. |

Giữ ba giai đoạn và thứ tự dữ liệu → tri thức/AI → hành động → pilot. Các trường/contract tối thiểu được làm cùng hạng mục tương ứng; khả năng browser, OCR và dashboard mở rộng có điều kiện. Ước lượng 4–6 tuần MVP vẫn là giả định cần hiệu chỉnh sau spike connector/Windows, không được xem như bảo đảm mọi phần bổ sung đều miễn phí thời gian.

# 16 Các quyết định đã chốt

- Tên sản phẩm X-Working theo lựa chọn của chủ dự án; slug x-working; mô tả Trợ lý công việc có bộ nhớ dài hạn.

- Phát triển tiếp trong Social-Manager, tận dụng nền PR 18 và giữ một codebase có module rõ ràng.

- Next.js và Postgres là hub; Drizzle, Better Auth và pg-boss tiếp tục được dùng; worker Windows là tiến trình riêng.

- Lưu bản gốc và phiên bản dài hạn trong phạm vi đã chọn; summary, memory và index có thể dựng lại.

- Một orchestrator; API cho dữ liệu và hành động khi phù hợp; Agent Desktop cho app cần thao tác UI.

- Sửa conversation/message ingest và retention trước khi mở AI tự trả lời; xác minh kết quả riêng với việc gọi lệnh.

- MVP một người, một dự án, một kênh, một workflow Windows; nghiệm thu rồi mới mở rộng.

- CI đạt trên đúng phiên bản trước merge; deploy VPS sau merge; chia PR theo đầu ra có thể kiểm chứng.

- Nhập catalog stored theo commit làm nguồn tri thức; giữ ngày và mức kiểm chứng từng hồ sơ, không dùng ngày đồng bộ để nâng độ tin cậy.

- Bổ sung locator của bằng chứng, trạng thái xử lý tài liệu, capability registry, workflow revision và sự kiện UI có thể nối lại.

- Bộ 50 câu có nhãn bằng chứng và phiên bản; đo retrieval, câu trả lời, hành động và chi phí riêng. Telemetry chỉ chứa metadata theo mặc định.

- Các cải thiện được ghép vào M01–M13; browser, OCR và công cụ vận hành chỉ thêm theo nhu cầu pilot, giữ ba giai đoạn đã chốt.

Lát triển khai đầu tiên là cập nhật đặc tả và sửa nền dữ liệu: identity hội thoại/tin nhắn, lưu bản gốc, policy retention và ngữ nghĩa ngắt kết nối. Việc đổi tên repository được thực hiện cùng thay đổi có kiểm soát các remote, badge, tài liệu, CI, package và cấu hình triển khai; tên sản phẩm không bắt buộc phải thay ngay mọi đường dẫn đang được các phiên phát triển sử dụng.

# Nguồn nghiên cứu

Các nguồn dưới đây là tài liệu chính thức hoặc repository của dự án, được kiểm tra ngày 22 tháng 11 năm 2026. Khả năng và giấy phép cần được kiểm tra lại trên phiên bản được chọn khi triển khai. Các lựa chọn kiến trúc, phạm vi, tiến độ và ngưỡng nghiệm thu trong kế hoạch là đề xuất thiết kế.

**\[S07\]** [<u>GitHub REST API endpoints for events</u>](https://docs.github.com/en/rest/activity/events)

**\[S08\]** [<u>GitHub Handling failed webhook deliveries</u>](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)

**\[S09\]** [<u>Claude Code Hooks reference</u>](https://code.claude.com/docs/en/hooks)

**\[S10\]** [<u>Chrome History API</u>](https://developer.chrome.com/docs/extensions/reference/api/history)

**\[S13\]** [<u>Microsoft Event Sourcing Pattern</u>](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)

**\[S14\]** [<u>Amazon S3 Deleting object versions</u>](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeletingObjectVersions.html)

**\[S15\]** [<u>pgvector Repository</u>](https://github.com/pgvector/pgvector)

**\[S18\]** [<u>Social Manager PR 18</u>](https://github.com/www-donghanhcungban-org/Social-Manager/pull/18)

**\[S19\]** [<u>Social Manager package tại head đã kiểm tra</u>](https://github.com/www-donghanhcungban-org/Social-Manager/blob/1fb002fb0d404c39d775864478f2dd57e79eb921/package.json)

**\[S20\]** [<u>Social Manager adapter SocialAPI</u>](https://github.com/www-donghanhcungban-org/Social-Manager/blob/1fb002fb0d404c39d775864478f2dd57e79eb921/src/providers/socialapi/index.ts)

**\[S21\]** [<u>Social Manager inbox service</u>](https://github.com/www-donghanhcungban-org/Social-Manager/blob/1fb002fb0d404c39d775864478f2dd57e79eb921/src/inbox/service.ts)

**\[S22\]** [<u>Social Manager retention service</u>](https://github.com/www-donghanhcungban-org/Social-Manager/blob/1fb002fb0d404c39d775864478f2dd57e79eb921/src/retention/service.ts)

**\[S24\]** [<u>Agent Desktop Introduction</u>](https://agent-browser.dev/desktop)

**\[S25\]** [<u>Agent Desktop MCP</u>](https://agent-browser.dev/desktop/guides/mcp)

**\[S26\]** [<u>Agent Desktop Observe act verify</u>](https://agent-browser.dev/desktop/guides/observe-act-verify)

**\[S27\]** [<u>Agent Desktop Traces</u>](https://agent-browser.dev/desktop/guides/traces)

**\[S28\]** [<u>Agent Desktop Windows</u>](https://agent-browser.dev/desktop/platforms/windows)

**\[S29\]** [<u>pg-boss Introduction</u>](https://pgboss.io/introduction)

**\[S30\]** [<u>AWS Transactional outbox pattern</u>](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)

**\[S31\]** [<u>PostgreSQL 16 Text search indexes</u>](https://www.postgresql.org/docs/16/textsearch-indexes.html)

**\[S32\]** [<u>Mem0 How it works</u>](https://docs.mem0.ai/core-concepts/how-it-works)

**\[S33\]** [<u>Letta Memory and dreaming</u>](https://docs.letta.com/configuration/memory)

**\[S38\]** [<u>Social Manager product specification</u>](https://github.com/www-donghanhcungban-org/Social-Manager/blob/1fb002fb0d404c39d775864478f2dd57e79eb921/PROJECT.md)

**\[S39\]** [<u>PostgreSQL 16 SQL dump</u>](https://www.postgresql.org/docs/16/backup-dump.html)

**\[S40\]** [<u>PostgreSQL 16 Backup and restore</u>](https://www.postgresql.org/docs/16/backup.html)

**\[S41\]** [<u>Social Manager provider contract</u>](https://github.com/www-donghanhcungban-org/Social-Manager/blob/1fb002fb0d404c39d775864478f2dd57e79eb921/src/providers/types.ts)

**\[S42\]** [<u>Agent Desktop Snapshots and refs</u>](https://agent-browser.dev/desktop/snapshots-and-refs)

**\[S43\]** [<u>stored Catalog tại commit đã rà</u>](https://github.com/www-donghanhcungban-org/stored/blob/aaf39157906cb4e985ce8e023c3b6ca548802978/data/projects.json)

**\[S44\]** [<u>stored Phương pháp và mức bằng chứng</u>](https://github.com/www-donghanhcungban-org/stored/blob/aaf39157906cb4e985ce8e023c3b6ca548802978/METHOD.md)

**\[S45\]** [<u>stored Phạm vi và quy trình</u>](https://github.com/www-donghanhcungban-org/stored/blob/aaf39157906cb4e985ce8e023c3b6ca548802978/WORKFLOW.md)

**\[S46\]** [<u>Docling Document và provenance</u>](https://docling-project.github.io/docling/concepts/docling_document/)

**\[S47\]** [<u>Docling Advanced options và giới hạn</u>](https://docling-project.github.io/docling/usage/advanced_options/)

**\[S48\]** [<u>Docling Converter tại revision đã đọc</u>](https://github.com/docling-project/docling/blob/0634e2f74561e5950d69b2cace67ef95400506ad/docling/document_converter.py)

**\[S49\]** [<u>Hindsight Retain và nội dung được lưu</u>](https://hindsight.vectorize.io/developer/api/retain)

**\[S50\]** [<u>agent-browser Security và giới hạn chế độ</u>](https://agent-browser.dev/security)

**\[S51\]** [<u>agent-browser CDP và pin tab</u>](https://agent-browser.dev/cdp-mode)

**\[S52\]** [<u>AG-UI Events</u>](https://docs.ag-ui.com/concepts/events)

**\[S53\]** [<u>Agent Skills Specification</u>](https://agentskills.io/specification)

**\[S54\]** [<u>Vercel AI SDK Introduction</u>](https://ai-sdk.dev/docs/introduction)

**\[S55\]** [<u>assistant-ui Overview</u>](https://www.assistant-ui.com/docs)

**\[S56\]** [<u>Promptfoo Test cases và repeat</u>](https://www.promptfoo.dev/docs/configuration/test-cases/)

**\[S57\]** [<u>LongMemEval Benchmark</u>](https://github.com/xiaowu0162/LongMemEval)

**\[S58\]** [<u>OpenTelemetry GenAI spans và content capture</u>](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md)

**\[S59\]** [<u>oasdiff GitHub Action</u>](https://www.oasdiff.com/docs/github-action)

**\[S60\]** [<u>Schemathesis Stateful testing</u>](https://schemathesis.readthedocs.io/en/stable/explanations/stateful/)

**\[S61\]** [<u>ActivityWatch Watchers</u>](https://docs.activitywatch.net/en/latest/watchers.html)

**\[S62\]** [<u>Context7 Requested và served version</u>](https://context7.com/docs/api-reference/context/get-documentation-context)

**\[S63\]** [<u>Open Notebook Repository</u>](https://github.com/lfnovo/open-notebook)
