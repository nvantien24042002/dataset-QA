# Dataset QA

Công cụ kiểm định chất lượng (QA) cho **dataset Computer Vision 2D** được gán nhãn theo
định dạng **COCO JSON**.

Tài liệu này là điểm vào (entry point) của dự án. Thứ tự nguồn chân lý của tài liệu:
**README.md → [v1.md](v1.md) (SSOT cho V1) → [v2.md](v2.md) (SSOT cho V2) → [docs/](docs/)**.

---

## 1. Mục đích (Purpose)

Dự án cung cấp một công cụ chạy **cục bộ (local)** để phát hiện các vấn đề chất lượng
trong dataset gán nhãn COCO:

- **V1** là công cụ QA **rule-based, tất định (deterministic)** chạy hoàn toàn trên máy
  người dùng, kiểm tra metadata annotation (không đọc pixel ảnh, không AI/LLM, không cloud).
  V1 chỉ sinh ra *tín hiệu chất lượng tiềm năng* để con người xem xét — V1 không tự kết luận
  annotation đúng hay sai.
- **V2** phát triển V1 thành **công cụ Human Review 2D hướng production**: import dataset,
  version hoá bất biến, chạy QA, dựng Review Queue, và cho phép Reviewer ra quyết định
  (ACCEPT / REJECT / NEEDS_FIX) trên một 2D Viewer. V2 là công cụ review, **không phải**
  annotation editor.

Nguyên tắc cốt lõi: **QA tạo ra tín hiệu; con người tạo ra quyết định.**

## 2. Trạng thái hiện tại (Current status)

| Phase | Nội dung | Trạng thái |
|---|---|---|
| Phase 1 | Foundation (project structure, SQLite, repositories, FileStorage) | **COMPLETE** |
| Phase 2 | Dataset Import & Versioning (COCO Parser, Canonical Model, Dataset Version) | **APPROVED / COMPLETE** |
| Phase 3 | Geometry (BBox, Polygon, Segmentation, RLE) | **NOT STARTED** |

Chi tiết triển khai từng phase: xem [docs/phases/](docs/phases/).

> Lưu ý: phần "§31. V2 Status" trong [v2.md](v2.md) mô tả mức độ hoàn chỉnh của **đặc tả**,
> không phải mức độ hoàn chỉnh của code. Trạng thái code thực tế được ghi trong `docs/phases/`.

## 3. V1 so với V2 (V1 vs V2)

| Khía cạnh | V1 | V2 |
|---|---|---|
| Mục tiêu | QA rule-based tất định | Human Review 2D hướng production |
| Đầu vào | COCO JSON (metadata) | COCO dataset + file ảnh thật |
| Đầu ra | Kết quả QA (JSON) | QA Issue → Review Queue → Review Decision → Export |
| Lưu trữ | Cục bộ, nhẹ | SQLite + local filesystem |
| Con người | Đọc kết quả QA | Ra quyết định review trên 2D Viewer |
| Đặc tả (SSOT) | [v1.md](v1.md) | [v2.md](v2.md) |

## 4. Phạm vi V2 (V2 scope)

V2 tập trung vào: 2D bounding box, 2D polygon, segmentation (Polygon + RLE), 2D visualization,
QA tất định, luồng human review, dataset versioning, history/audit, và export.

**Ngoài phạm vi** V2 (giai đoạn đầu): AI/LLM, auto-labeling, tự động sửa annotation,
pose/keypoints, face landmarks, 3D/point cloud, tracking, logic ADAS chuyên biệt, tích hợp CVAT,
cộng tác đa người dùng thời gian thực, authentication/authorization, triển khai cloud, S3,
PostgreSQL, Kubernetes, mobile UI, và annotation editing.

## 5. Tổng quan kiến trúc (Architecture overview)

Kiến trúc phân tầng (xem [v2.md](v2.md) §15):

```text
Presentation → Application → Domain ← Infrastructure → Storage
```

- **Presentation:** API HTTP (Express) và UI trình duyệt (các phase sau).
- **Application:** các service điều phối use case (Import, Dataset, ...).
- **Domain:** business rule và invariant thuần, độc lập với COCO và hạ tầng.
- **Infrastructure:** repository (SQL chỉ nằm ở đây), COCO adapter, file storage.
- **Storage:** SQLite + local filesystem.

Quy tắc: tầng trong không phụ thuộc tầng ngoài; SQL chỉ tồn tại ở Infrastructure/Repository.

## 6. Khái niệm domain cốt lõi (Core domain concepts)

- **Dataset / Dataset Version:** Dataset là tập hợp logic; mỗi lần import tạo một Dataset Version.
  Version ở trạng thái `READY` là **bất biến (immutable)** — mọi thay đổi yêu cầu version mới.
- **Image / Annotation:** Annotation tham chiếu tới đúng một Image trong cùng version.
  Annotation **không** chứa review status/decision/reviewer hay QA severity.
- **Geometry:** BBox, Polygon, Segmentation (Polygon + RLE) trong không gian `IMAGE_PIXEL`,
  gốc toạ độ top-left. RLE được giữ nguyên semantics (Phase 3 mới hiện thực thuật toán).
- **QA Issue ≠ Review Decision:** QA sinh **tín hiệu**; con người sinh **quyết định**.
- **Review Item / Review Status / Review Decision:** Review Item (đơn vị kiểm duyệt) tham chiếu
  tới target (Image/Annotation), có Review Status {UNREVIEWED, IN_REVIEW, REVIEWED} và
  Review Decision {ACCEPT, REJECT, NEEDS_FIX}.
- **Fingerprint:** SHA-256 tất định trên nội dung COCO đã chuẩn hoá, dùng để nhận dạng version.

Bảng thuật ngữ đầy đủ và 7 phân biệt quan trọng: xem [docs/terminology.md](docs/terminology.md).

## 7. Các phase đã hoàn thành (Completed phases)

- **Phase 1 — Foundation:** cấu trúc dự án, SQLite + PRAGMA `foreign_keys=ON`, repository pattern,
  FileStorage/LocalFileStorage, `/api/health` (version "1.0") và `/api/v2/health`.
  Xem [docs/phases/phase-1-foundation.md](docs/phases/phase-1-foundation.md).
- **Phase 2 — Dataset Import & Versioning:** CocoParser, CocoNormalizer (COCO → Canonical Model),
  pipeline import nguyên tử (staging tạm → publish → transaction → READY), fingerprint tất định,
  cô lập version, và kiểm tra an toàn đường dẫn ảnh (path safety, INV-08).
  Xem [docs/phases/phase-2-import-versioning.md](docs/phases/phase-2-import-versioning.md).

## 8. Các phase sắp tới (Upcoming phases)

Theo lộ trình trong [v2.md](v2.md) §29:

- **Phase 3 — Geometry:** BBox, Polygon, Segmentation, RLE (thuật toán hình học). **Chưa bắt đầu.**
- **Phase 4 — QA Engine:** rule V1 + rule geometry 2D.
- **Phase 5 — Review Queue:** ReviewItem, state machine, history.
- **Phase 6 — 2D Viewer**, **Phase 7 — Review Workspace**, **Phase 8 — Export**, **Phase 9 — Integration/E2E**.

## 9. Cài đặt & chạy cục bộ (Local setup)

Yêu cầu: **Node.js 18 trở lên** (dùng test runner built-in và `fetch` toàn cục).

```bash
npm install          # cài dependency
npm run migrate      # khởi tạo/di trú schema SQLite
npm start            # chạy server tại http://localhost:3000 (đổi qua biến môi trường PORT)
```

Kiểm tra health endpoint (V1, được giữ nguyên):

```bash
curl http://localhost:3000/api/health
# { "ok": true, "status": "healthy", "version": "1.0" }
```

API V2 nằm dưới tiền tố `/api/v2` (ví dụ `GET /api/v2/health`, `GET /api/v2/datasets`).

## 10. Kiểm thử (Testing)

```bash
npm test
```

Test dùng test runner built-in của Node (`node --test`), SQLite in-memory (`:memory:`) và
`fetch` toàn cục. Bộ test gồm unit, integration, và e2e (API). Xem [test/](test/).

## 11. Cấu trúc repository (Repo structure)

```text
dataset-qa/
├── src/
│   ├── api/              # Presentation: routes, controllers, dto, middleware
│   ├── application/      # Application services (dataset, import, ...)
│   ├── domain/           # Domain thuần: dataset, annotation, geometry, version, errors
│   ├── infrastructure/   # Repository (SQL), coco adapter, filesystem, fingerprint
│   └── composition.js    # Composition root (wiring DI)
├── test/                 # unit / integration / e2e
├── docs/                 # Tài liệu bổ trợ (terminology, phases)
├── v1.md                 # SSOT cho V1
├── v2.md                 # SSOT cho V2
└── README.md
```

## 12. Bản đồ tài liệu (Documentation map)

| Tài liệu | Vai trò |
|---|---|
| [README.md](README.md) | Điểm vào, tổng quan dự án |
| [v1.md](v1.md) | **SSOT cho V1** — đặc tả công cụ QA rule-based |
| [v2.md](v2.md) | **SSOT cho V2** — đặc tả công cụ Human Review 2D |
| [docs/terminology.md](docs/terminology.md) | Chuẩn thuật ngữ + 7 phân biệt domain quan trọng |
| [docs/phases/phase-1-foundation.md](docs/phases/phase-1-foundation.md) | Bản ghi lịch sử Phase 1 |
| [docs/phases/phase-2-import-versioning.md](docs/phases/phase-2-import-versioning.md) | Bản ghi lịch sử Phase 2 |

Quy ước ngôn ngữ tài liệu: diễn giải bằng **tiếng Việt**, giữ nguyên các **canonical technical term**
tiếng Anh (Dataset, Annotation, Geometry, BBox, RLE, QA Issue, Review Item, ...). Các normative block
(schema, invariant, state diagram, API contract) trong v2.md được giữ nguyên văn tiếng Anh.
