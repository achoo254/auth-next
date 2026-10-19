---
phase: 5
title: "Chuyển tenant đang chạy trên hoandat"
status: done
priority: P2
effort: "XL"
dependencies: [2, 3]
---

# Phase 05: Chuyển tenant đang chạy trên hoandat

## Goal

Một tenant `active` trên hoandat chuyển sang bản cài tự host mà không mất tài khoản, project, tunnel, tin nhắn hay khoá ký. Token đã cấp vẫn dùng được sau khi đổi bản ghi A. Sau thời hạn giữ lại, không còn dữ liệu hay secret nào của tenant trên .65.

## Bối cảnh đã đo

- Dữ liệu tenant trên .65: database `auth` (`TENANT_COLLECTIONS`, `src/tenants/tenant-collections.ts`), MongoDB của Localman (41 model có `tenantId`, ADR 0003 của localman-next), Postgres `chat` (cột `tenant_id`, ADR 0010 của chat-next).
- Secret của tenant trong `tenant_secrets` niêm phong bằng `TENANT_SECRETS_KEY` (AES-256-GCM, AAD theo tenant và loại); token DNS niêm phong bằng RSA-OAEP-256 cho provisioner (mẫu để niêm phong lại cho bản cài).
- Backup `auth`: `infra/backup-auth-db.sh`, giữ 14 ngày, chỉ trên .65 (quyết định của user: không đề xuất off-site).
- Khoá ký của tenant sổ: một ES256, một RS256 (ADR 0006).

## Files to Create / Modify

- Create `scripts/export-tenant.ts` (hoandat-auth): xuất mọi document của tenant ở `TENANT_COLLECTIONS` (trừ token đã hết hạn), cùng secret của tenant giải niêm phong trong tiến trình rồi niêm phong lại bằng khoá công khai bản cài khai lúc enrollment; không bao giờ ghi secret dạng rõ ra đĩa hay log.
- Create `scripts/import-tenant.ts` (hoandat-auth, chạy ở bản cài): nhập dữ liệu, đổi `tenantId` sang id của tenant chính của bản cài, mở niêm phong secret bằng khoá riêng của bản cài, khoá ký giữ nguyên `kid`.
- Create lệnh export/import tương ứng ở localman-next (theo plugin `tenantScopePlugin`) và chat-next (theo `tenant_id`).
- Modify `src/tenants/enrollment-bundle.ts`, `enrollment-redeem.ts`: gói cho lượt chuyển mang khoá công khai của bản cài; đổi gói chuyển tenant `active` sang `self_hosted` chỉ sau khi import báo xong.
- Create `scripts/purge-tenant.ts` (và tương ứng ở hai repo kia): xoá dữ liệu và secret của tenant sau thời hạn giữ lại, báo số đếm theo collection/bảng.
- Modify `docs/deployment-guide.md`: quy trình chuyển (thứ tự, lệnh, kiểm).

## Steps

1. Định dạng export chung cho ba app (một tệp mỗi app, có phiên bản schema, có checksum); viết test round-trip export → import trên dữ liệu mẫu.
2. Niêm phong lại secret cho khoá công khai của bản cài; test rằng .65 không giữ được bản rõ nào.
3. Quy trình chuyển: backup ba database → đóng băng ghi của tenant (tenant chỉ đọc) → export → import → kiểm số đếm → đổi bản ghi A → đổi gói → `self_hosted` → mở lại.
4. Sau 14 ngày: purge trên .65, đếm lại bằng 0, huỷ khoá ký của tenant trên .65.

## Validation

- Round-trip trên bản sao dữ liệu thật của một tenant thử: số document/hàng trước và sau bằng nhau theo từng collection/bảng.
- Refresh token cấp trước lúc chuyển dùng được ở bản cài sau khi đổi bản ghi A; `kid` trong JWKS không đổi.
- Sau purge: mọi collection/bảng trên .65 đếm 0 cho `tenantId` đó; `tenant_secrets` không còn mục nào.

## Risk / Rollback

- Rủi ro lớn nhất: khoá ký tồn tại ở hai nơi hoặc mất. Khoá chỉ truyền niêm phong; .65 huỷ bản của mình ở bước purge, không sớm hơn.
- Ghi trong lúc export bị mất: đóng băng ghi của tenant trong cửa sổ chuyển.
- Lùi trước khi đổi bản ghi A: mở lại tenant trên hoandat, bỏ bản cài. Lùi sau khi đổi: trỏ lại bản ghi A về .65 trong 14 ngày giữ lại (dữ liệu trên .65 cũ hơn bản cài kể từ lúc chuyển; ghi rõ cho tenant).

## Kết quả (17/10/2026)

Cách làm đã chốt ở ADR 0007 §7 (user chọn chuyển trọn ba repo). Khác với phần "Files" ở trên: không đổi gói enrollment (tenant `migrating` tải gói như tenant mới và đổi gói sau khi trỏ bản ghi A); khoá công khai của bản cài là khoá chuyển riêng do `init.sh` sinh, không phải khoá enrollment.

- hoandat-auth `0d5f01f`: trạng thái `migrating` (`/claim` bắt đầu/huỷ, audit `tenant.migrating`, `tenant.migration_cancelled`), `scripts/export-tenant-secrets.ts` (JWE cho khoá chuyển, kèm `SESSION_KEY` của chat), `scripts/import-tenant.ts` (từ chối bản cài đã có tài khoản), `scripts/purge-tenant.ts`.
- hoandat-auth (commit kế tiếp): `deploy/self-hosted/migrate/` (`export-tenant.sh`, `export-chat.sh`, `chat-tables.sh`, `import-tenant.sh`, `purge-tenant.sh`, `purge-mongo-tenant.mjs`), khoá chuyển trong `init.sh`, Telegram của tenant chuyển trong `auth.env`, `infra/deploy.sh` đồng bộ `migrate/`, test `tenant-move-script`.
- localman-next `a5b9470`: `export-tenant.mjs`/`import-tenant.mjs`, niêm phong lại biến bí mật bằng khoá tạo cho lượt chuyển.
- chat-next: không sửa; dùng `-role reseal` có sẵn với `SESSION_KEY_PREVIOUS`.

Đã kiểm:
- hoandat-auth: lint, typecheck, 576/576 test, e2e 11/11, tokens; shellcheck sạch.
- Localman API: typecheck, 1409/1409 test; chạy thật `export-tenant` → `import-tenant` trên Mongo tạm: chỉ document của tenant sang, biến bí mật mở bằng keyring của bản cài, phiên không sang, nhập lần hai bị từ chối.
- Chat trên Postgres của LAB 183 (hai database tạm, dữ liệu tổng hợp của hai tenant): `export-chat.sh` → `chat.sql` → database mới: chỉ hàng của tenant sang, gắn `primary`, phiên không sang, sequence giữ, `server_epoch` tăng; `purge_chat_rows` xoá hết hàng của tenant, tenant kia còn nguyên.

Còn lại:
- Phát hành bản bundle mới (image có `import-tenant` của IdP và Localman) và deploy IdP, Localman lên .65 trước lượt chuyển thật.
- Chạy trọn trên một tenant thử (`inetdev.io.vn` hoặc domain thử) với VM công khai: refresh token cấp trước khi chuyển còn dùng được, `kid` không đổi; gộp vào phase 06.
