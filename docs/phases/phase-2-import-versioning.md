# Phase 2 — Dataset Import & Versioning

> **Trạng thái:** APPROVED / COMPLETE (đã duyệt / hoàn thành, bao gồm bản vá path-safety).
> **Loại tài liệu:** Bản ghi lịch sử triển khai (historical implementation record).
> Tài liệu này ghi lại trạng thái *cuối cùng đã được duyệt* của Phase 2; nó không phải đặc tả
> thay thế cho [v2.md](../../v2.md).

## 1. Mục tiêu

Cho phép import một dataset COCO thật (kèm file ảnh) thành một **Dataset Version** bất biến,
thông qua một pipeline nguyên tử (atomic): parse → validate → normalize → fingerprint → publish
→ persist → `READY`.

## 2. Phạm vi

- Đọc nguồn (SourceReader): `annotations.json` + file ảnh.
- Parse COCO (CocoParser) → COCO DTO.
- Chuẩn hoá (CocoNormalizer): COCO DTO → Canonical Domain Model.
- Validate: tồn tại file ảnh, khớp kích thước ảnh, tính hợp lệ tham chiếu, **an toàn đường dẫn**.
- Fingerprint tất định; publish nguyên tử ra filesystem + transaction SQLite; đánh dấu `READY`.
- Version hoá: cô lập giữa các version của cùng một dataset.

Ngoài phạm vi Phase 2: geometry algorithms (Phase 3), QA engine, review, viewer, export.

## 3. Những gì đã triển khai

- **SourceReader** [SourceReader.js](../../src/infrastructure/filesystem/SourceReader.js): đọc
  annotations và ảnh từ thư mục nguồn.
- **CocoParser** [CocoParser.js](../../src/infrastructure/coco/CocoParser.js): parse + kiểm tra
  cấu trúc COCO (JSON hợp lệ, có mảng annotations, image có `file_name`, annotation có `image_id`).
- **CocoNormalizer** [CocoNormalizer.js](../../src/infrastructure/coco/CocoNormalizer.js): COCO DTO
  → Canonical Model (bbox → `{x,y,width,height}`, polygon → POLYGON, RLE giữ nguyên; remap id ảnh/
  annotation; không gắn field review/QA). Chặn `file_name` không an toàn qua `assertSafeRelativePath`.
- **ImageProbe** [imageProbe.js](../../src/infrastructure/filesystem/imageProbe.js): đọc kích thước
  PNG/JPEG; ném lỗi với định dạng không hỗ trợ.
- **Fingerprint** [fingerprint.js](../../src/infrastructure/fingerprint.js): SHA-256 tất định trên
  JSON COCO đã sắp xếp khoá (categories, images + content hash, annotations), sắp theo COCO id.
- **DatasetValidator** [DatasetValidator.js](../../src/domain/dataset/DatasetValidator.js): kiểm tra
  tham chiếu (INVALID_IMAGE_REFERENCE, INVALID_CATEGORY_REFERENCE, DUPLICATE_ANNOTATION_ID).
- **ImportDatasetService** [ImportDatasetService.js](../../src/application/import/ImportDatasetService.js):
  điều phối pipeline; staging tạm → `storage.move` publish → transaction (upsert Dataset, tạo
  DatasetVersion DRAFT, ghi images/annotations, chuyển READY) → bù trừ `removeDir` nếu commit lỗi.
- **API dataset:** [datasets.js](../../src/api/routes/datasets.js) + controller + DTO:
  `GET /api/v2/datasets`, `GET /:id`, `GET /:id/versions`, `POST /:id/versions`,
  `GET /:id/versions/:versionId`.

## 4. Kiến trúc / Thiết kế

- ImportDatasetService chỉ phụ thuộc các abstraction được inject (constructor DI); composition root
  wiring hạ tầng cụ thể — giữ application service không import hạ tầng trực tiếp ([v2.md](../../v2.md) §15).
- Publish nguyên tử: staging trong `temp/`, chỉ move sang thư mục version sau khi validate thành công;
  transaction better-sqlite3 đảm bảo all-or-nothing.
- **Một version không bao giờ được đánh dấu `READY`** nếu thiếu file ảnh, sai kích thước, tham chiếu
  hỏng, hoặc transaction chưa commit.

## 5. Kiểm thử

- **Unit:** [cocoParser.test.js](../../test/unit/cocoParser.test.js),
  [cocoNormalizer.test.js](../../test/unit/cocoNormalizer.test.js),
  [datasetValidator.test.js](../../test/unit/datasetValidator.test.js),
  [imageProbe.test.js](../../test/unit/imageProbe.test.js),
  [pathSafety.test.js](../../test/unit/pathSafety.test.js),
  [geometry.test.js](../../test/unit/geometry.test.js),
  [versionStatus.test.js](../../test/unit/versionStatus.test.js).
- **Integration:** [importPipeline.test.js](../../test/integration/importPipeline.test.js),
  [imageAnnotationRepository.test.js](../../test/integration/imageAnnotationRepository.test.js).
- **E2E:** [datasets.api.test.js](../../test/e2e/datasets.api.test.js).
- Kết quả cuối cùng khi duyệt Phase 2: toàn bộ test xanh (bao gồm 10 test regression path-safety mới).

## 6. Bảo mật / Độ tin cậy

- **Path safety (INV-08):** `file_name` trong COCO có thể chứa traversal (`../../evil.png`,
  `..\..\evil.png`) hoặc đường dẫn tuyệt đối. Đã thêm domain guard
  [pathSafety.js](../../src/domain/dataset/pathSafety.js): `assertSafeRelativePath` (từ chối
  non-string/rỗng, tuyệt đối, segment `..`/`.`/rỗng) và `assertWithinDir` (đảm bảo đường dẫn chuẩn
  hoá vẫn nằm trong `images/` root của version). Được enforce ở biên import
  (ImportDatasetService), ở Image domain, và ở CocoNormalizer (defense-in-depth). Không làm yếu đi
  bảo vệ global-root sẵn có của LocalFileStorage.
- Publish nguyên tử + bù trừ khi commit lỗi → không để lại thư mục "READY" mồ côi.
- Fingerprint tất định để nhận dạng nội dung version.

## 7. Giới hạn đã biết

- Chưa hiện thực thuật toán geometry (diện tích, self-intersection, decode RLE) — thuộc Phase 3.
- **Ghi chú độ chính xác tài liệu:** tại thời điểm audit tài liệu, code Phase 2 đã hoàn thành/duyệt
  nhưng **chưa được commit vào git** (đang ở dạng modified/untracked). Đây là khác biệt cần lưu ý,
  không phải lỗi code.

## 8. Các file chính

- [src/application/import/ImportDatasetService.js](../../src/application/import/ImportDatasetService.js)
- [src/infrastructure/coco/](../../src/infrastructure/coco/)
- [src/infrastructure/filesystem/SourceReader.js](../../src/infrastructure/filesystem/SourceReader.js),
  [imageProbe.js](../../src/infrastructure/filesystem/imageProbe.js)
- [src/infrastructure/fingerprint.js](../../src/infrastructure/fingerprint.js)
- [src/domain/dataset/](../../src/domain/dataset/) (CanonicalDataset, DatasetValidator, Image,
  Category, pathSafety)
- [src/domain/geometry/Geometry.js](../../src/domain/geometry/Geometry.js) (factory/kiểu dữ liệu; thuật toán để Phase 3)

## 9. Tiêu chí nghiệm thu

- Import hợp lệ → version `READY` kèm file đã publish + manifest; staging tạm được tiêu thụ.
- Fingerprint tất định với nội dung giống nhau.
- Thiếu ảnh / sai kích thước / `file_name` traversal → **không** tạo dataset, không publish, không READY.
- Import lần hai cùng dataset → tạo version 2 cô lập.
- `npm test` và `npm run migrate` chạy được.

## 10. Trạng thái cuối

**APPROVED / COMPLETE** sau khi vá xong vấn đề an toàn đường dẫn ảnh (path-safety). Không có code
Phase 3 nào được thêm.

## 11. Phase tiếp theo

**Phase 3 — Geometry** (BBox, Polygon, Segmentation, RLE): **CHƯA BẮT ĐẦU**. Xem lộ trình trong
[v2.md](../../v2.md) §29.
