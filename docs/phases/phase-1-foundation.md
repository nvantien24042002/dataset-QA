# Phase 1 — Foundation

> **Trạng thái:** COMPLETE (hoàn thành)
> **Loại tài liệu:** Bản ghi lịch sử triển khai (historical implementation record).
> Tài liệu này ghi lại những gì Phase 1 *đã* làm; nó không phải đặc tả thay thế cho
> [v2.md](../../v2.md). Không viết lại lịch sử để tuyên bố năng lực xuất hiện sớm hơn thực tế.

## 1. Mục tiêu

Thiết lập nền tảng (foundation) kỹ thuật cho toàn bộ dự án: cấu trúc thư mục theo kiến trúc
phân tầng, kết nối SQLite, repository pattern, lớp trừu tượng file storage, và các health endpoint.

## 2. Phạm vi

- Cấu trúc dự án theo [v2.md](../../v2.md) §19.
- Khởi tạo database SQLite (better-sqlite3) + migration schema.
- Repository pattern (BaseRepository và các repository con).
- FileStorage abstraction + LocalFileStorage.
- Health endpoint V1 (`/api/health`) và V2 (`/api/v2/health`).
- Composition root (wiring dependency injection).

Ngoài phạm vi Phase 1: import dataset, COCO parsing, geometry, QA, review, export.

## 3. Những gì đã triển khai

- **Persistence:** [db.js](../../src/infrastructure/persistence/sqlite/db.js) tạo kết nối
  better-sqlite3 và bật `PRAGMA foreign_keys = ON`; [migrate.js](../../src/infrastructure/persistence/sqlite/migrate.js)
  áp schema các bảng.
- **Repository:** [BaseRepository.js](../../src/infrastructure/repositories/BaseRepository.js) và
  các repository (Dataset, DatasetVersion, Image, Annotation) — SQL chỉ nằm ở tầng này.
- **File storage:** [FileStorage.js](../../src/infrastructure/filesystem/FileStorage.js) (interface)
  và [LocalFileStorage.js](../../src/infrastructure/filesystem/LocalFileStorage.js) (hiện thực trên
  filesystem cục bộ, có bảo vệ global-root).
- **Presentation:** Express app factory [app.js](../../src/app.js) với health routes; `/api/health`
  trả về `{ ok: true, status: "healthy", version: "1.0" }` (giữ nguyên từ V1, v1.md §22.1).
- **Composition root:** [composition.js](../../src/composition.js) wiring các dependency.

## 4. Kiến trúc / Thiết kế

Tuân theo chiều phụ thuộc của [v2.md](../../v2.md) §15: Presentation → Application → Domain ←
Infrastructure → Storage. SQL chỉ tồn tại ở Infrastructure/Repository; Application/Domain không
thực thi SQL trực tiếp và không phụ thuộc đường dẫn tuyệt đối của máy.

## 5. Kiểm thử

- [test/health.test.js](../../test/health.test.js) và [test/e2e/health.test.js](../../test/e2e/health.test.js):
  kiểm tra health endpoint (bao gồm version "1.0" của V1).
- [test/integration/schema.test.js](../../test/integration/schema.test.js): kiểm tra schema/migration.
- [test/integration/datasetRepository.test.js](../../test/integration/datasetRepository.test.js):
  kiểm tra repository qua abstraction.
- [test/unit/localFileStorage.test.js](../../test/unit/localFileStorage.test.js): kiểm tra
  LocalFileStorage (gồm bảo vệ global-root).
- Test dùng `node --test`, SQLite `:memory:`, và `fetch` toàn cục.

## 6. Bảo mật / Độ tin cậy

- `PRAGMA foreign_keys = ON` để đảm bảo ràng buộc tham chiếu ở DB.
- LocalFileStorage giới hạn thao tác trong global data root.
- Không lưu binary ảnh trong SQLite (INV-27).

## 7. Giới hạn đã biết

- Chưa có import dataset, COCO parsing, geometry, QA, review, export (thuộc các phase sau).
- UI trình duyệt chưa được xây dựng (phase sau).

## 8. Các file chính

- [src/app.js](../../src/app.js), [src/composition.js](../../src/composition.js)
- [src/infrastructure/persistence/sqlite/](../../src/infrastructure/persistence/sqlite/)
- [src/infrastructure/repositories/](../../src/infrastructure/repositories/)
- [src/infrastructure/filesystem/](../../src/infrastructure/filesystem/)
- [src/api/routes/health.js](../../src/api/routes/health.js)

## 9. Tiêu chí nghiệm thu

- SQLite kết nối được, schema áp thành công qua `npm run migrate`.
- Repository đọc/ghi qua abstraction, không rò rỉ SQL ra ngoài Infrastructure.
- Health endpoint V1 và V2 hoạt động; `npm test` xanh.

## 10. Trạng thái cuối

**COMPLETE.** Nền tảng sẵn sàng cho Phase 2 (Dataset Import & Versioning).
Commit liên quan: `9d16861 feat: complete phase 1 project initialization`,
`dfb5c24 feat: complete phase 1 foundation`.

## 11. Phase tiếp theo

**Phase 2 — Dataset Import & Versioning.** Xem
[phase-2-import-versioning.md](phase-2-import-versioning.md).
