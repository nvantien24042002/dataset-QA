# Terminology — Chuẩn thuật ngữ

Tài liệu này định nghĩa **chuẩn thuật ngữ** dùng trong toàn bộ tài liệu dự án (README, v1.md,
v2.md, docs/, phase docs). Mục tiêu: giữ một thuật ngữ duy nhất cho mỗi khái niệm, giữ các
khái niệm khác nhau tách bạch, và giữ nguyên các **canonical technical term** tiếng Anh.

## 1. Quy ước ngôn ngữ

- Diễn giải, mô tả, tiêu đề: viết bằng **tiếng Việt** kỹ thuật, chuyên nghiệp.
- **Canonical technical term** (thuật ngữ domain/code/API): **giữ nguyên tiếng Anh**, không dịch.
  Lần xuất hiện đầu có thể chú thích tiếng Việt trong ngoặc, ví dụ: "Review Item (đơn vị kiểm duyệt)".
- **Normative block** (schema, invariant, state diagram, ERD, API contract, Definition of Done):
  giữ nguyên văn tiếng Anh trong v2.md — không diễn dịch lại để tránh sai lệch yêu cầu.
- Không dùng lẫn lộn các từ đồng nghĩa cho cùng một khái niệm (ví dụ: chỉ dùng "Dataset Version",
  không dùng lẫn "round", "snapshot", "revision" để chỉ cùng một thứ).

## 2. Canonical technical term (giữ nguyên tiếng Anh)

| Term | Chú thích tiếng Việt (tham khảo) |
|---|---|
| Dataset | Tập dữ liệu (tập hợp logic) |
| Dataset Version | Phiên bản dataset (bất biến khi READY) |
| Dataset Version Lineage | Phả hệ version (parent/child) |
| Dataset Diff | So khác giữa hai version |
| Image | Ảnh |
| Annotation | Nhãn/chú thích trên ảnh |
| Geometry | Hình học |
| Bounding Box / BBox | Hộp bao |
| Point2D | Điểm 2D |
| Polygon | Đa giác |
| Segmentation | Phân vùng |
| Segmentation Polygon | Segmentation mã hoá bằng polygon |
| Segmentation RLE / RLE | Segmentation mã hoá bằng RLE |
| Fingerprint | Dấu vân (SHA-256 tất định) |
| QA Signal | Tín hiệu QA |
| QA Issue | Vấn đề QA do rule phát hiện |
| Review Queue | Hàng đợi kiểm duyệt |
| Review Item | Đơn vị kiểm duyệt |
| Review Status | Trạng thái kiểm duyệt |
| Review Decision | Quyết định kiểm duyệt |
| Reviewer | Người kiểm duyệt |
| Review Note | Ghi chú kiểm duyệt |
| Review History | Lịch sử kiểm duyệt (append-only) |
| Review Round | Vòng kiểm duyệt (gắn với một version) |
| Audit Event | Sự kiện audit |
| Audit Trail | Vết audit (append-only) |
| Export | Xuất kết quả |
| Export Job | Tác vụ export |
| Export Artifact | Sản phẩm export |

## 3. Enum giá trị (giữ nguyên tiếng Anh)

- **Review Status:** `UNREVIEWED`, `IN_REVIEW`, `REVIEWED`
- **Review Decision:** `ACCEPT`, `REJECT`, `NEEDS_FIX`
- **Dataset Version status:** `DRAFT`, `READY`, `ARCHIVED`
- **Geometry type:** `BBOX`, `POLYGON`, `SEGMENTATION`
- **Coordinate space:** `IMAGE_PIXEL` (gốc top-left)

## 4. Bảy phân biệt domain quan trọng (Critical distinctions)

1. **QA Issue ≠ Review Decision.** QA sinh ra *tín hiệu*; con người mới ra *quyết định*.
   QA severity không bao giờ tự động trở thành quyết định của con người.
2. **Annotation ≠ Review Item.** Review Item *tham chiếu* tới target (Image/Annotation), không
   nhúng (embed) geometry. Annotation không chứa review status/decision/reviewer/QA severity.
3. **Review Status ≠ Review Decision.** Status {UNREVIEWED, IN_REVIEW, REVIEWED} mô tả tiến trình;
   Decision {ACCEPT, REJECT, NEEDS_FIX} chỉ tồn tại khi đã REVIEWED.
4. **Review ≠ Annotation Mutation.** NEEDS_FIX không tự sửa annotation. Luồng: NEEDS_FIX → sửa bên
   ngoài → Dataset Version mới → QA mới → ngữ cảnh review mới. V2 **không phải** annotation editor.
5. **Review History ≠ Audit Trail.** Review History ghi lại các lần submit review của một Review Item;
   Audit Trail ghi lại các hành động nghiệp vụ ở phạm vi hệ thống. Cả hai đều append-only.
6. **Viewer ≠ Source of Truth.** Canonical geometry là nguồn chân lý; Viewer chỉ hiển thị/kiểm tra.
   Zoom/pan không làm thay đổi canonical coordinates.
7. **Dataset Version ≠ Review Round.** Version là snapshot bất biến của dữ liệu; Review Round là ngữ
   cảnh đánh giá gắn với một version. Quyết định ACCEPT cũ không tự động áp dụng cho version mới.

Tham chiếu invariant liên quan trong [v2.md](../v2.md) §23 (INV-01..INV-36).
