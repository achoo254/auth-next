---
phase: 4
title: "Kênh phát hành có chữ ký"
status: done
priority: P2
effort: "L"
dependencies: [3]
---

# Phase 04: Kênh phát hành có chữ ký

## Goal

hoandat công bố bản phát hành của bundle (phiên bản ghim của bốn image cùng ghi chú nâng cấp). Image và manifest đều có chữ ký. Bản cài tự host kéo bản mới khi operator chọn và từ chối bản không có chữ ký hợp lệ. Không có traffic nào đi từ hoandat vào bản cài.

## Bối cảnh đã đo

- Jev chọn kênh phát hành có chữ ký với độ tin thấp nhất trong các quyết định (0,70; tải tay 0,30). Xem lại sau tenant tự host đầu tiên.
- Mã nguồn ba repo ở GitLab nội bộ (`gitlabs.inet.vn`); chưa có registry image công khai cho bản cài bên ngoài.

## Files to Create / Modify

- Create pipeline phát hành (CI của từng repo): build image, ký (cosign với khoá của hoandat), đẩy lên registry mà tenant tải được.
- Create manifest phát hành: phiên bản bundle, digest của bốn image, phiên bản schema dữ liệu tối thiểu, ghi chú nâng cấp; manifest ký.
- Create lệnh `update` trong bundle: tải manifest, kiểm chữ ký và digest, hỏi operator, backup Mongo và Postgres của chính bản cài, kéo image, chạy migration, khởi động lại; lỗi thì quay về phiên bản trước.
- Modify `deploy/self-hosted/.env.example`: URL kênh phát hành và khoá công khai kiểm chữ ký (cấu hình, không cố định trong code).

## Steps

1. Chốt registry và nơi công bố manifest (cần user quyết: registry GitLab nội bộ mở cho tenant hay registry công khai).
2. Ký image và manifest trong CI; khoá ký phát hành tách khỏi mọi khoá ký token.
3. Lệnh `update` với backup trước và quay về khi lỗi.
4. Thử nâng cấp một bản cài từ phiên bản N lên N+1 có migration.

## Validation

- Manifest hoặc image bị sửa thì `update` từ chối và không đổi gì.
- Nâng cấp lỗi giữa chừng thì bản cài quay về phiên bản cũ với dữ liệu nguyên vẹn.
- Bản cài không mở cổng nào cho hoandat; mọi lần nâng cấp do operator khởi động.

## Risk / Rollback

- Rủi ro: lộ khoá ký phát hành thì kẻ khác phát được bản giả. Khoá chỉ ở CI, có quy trình xoay và danh sách khoá thu hồi trong manifest.
- Lùi: operator tải tay và cài một phiên bản cụ thể (luôn còn được, phương án 0,30 của Jev).

## Tiến độ (17/10/2026)

Quyết định (user chọn, Jev tư vấn; ADR 0007 §6): image dựng sẵn trên GHCR ký cosign keyless (Jev 0,91); quyền tải riêng từng tenant qua gateway làm cửa registry (Jev 1,00, sau khi kiểm GHCR chỉ xác thực bằng token classic của một tài khoản). Manifest riêng bỏ: một phiên bản là cùng tag trên sáu image, mỗi image ký theo digest.

Đã làm và kiểm:

- Image dùng chung mọi domain: localman-next không phải sửa (web đã đọc tenant qua `GET /api/v1/tenant`); chat-next `3236784` (web đọc tenant từ `chat.<domain>`, test web 411/411, lint, typecheck sạch); bundle `78385c4` (bỏ `DOMAIN` khỏi Dockerfile, map cổng chat `default 4600`, `nginx -t` qua).
- Gateway: `src/tenants/release-registry.ts`, `release-upstream.ts`, `pull-tokens.ts`; token tải cấp khi đổi gói, sổ tenant chỉ giữ SHA-256; bản cài ghi `<ENROLLMENT_KEY_PATH>.registry.json`. Test `tenant-release-registry.test.ts` (router thật, GHCR giả: 401 Basic, chỉ tenant `self_hosted` với token hiện hành, manifest/tag relay có `Accept`, blob 307 về CDN, chỉ sáu image, token GHCR cache) và thêm vào `tenant-enrollment.test.ts` (token mới mỗi lượt đổi, chỉ lưu hash). Cổng: lint, typecheck, check:tokens sạch; `pnpm test` 571/571; e2e 11/11.
- Phát hành: `.github/workflows/selfhosted-release.yml` (actionlint sạch), `images/bundle.Dockerfile`, `compose.release.yaml`, `update.sh` (shellcheck sạch; sửa sau rà soát: nguồn mật khẩu, tự ghi đè, mẫu kiểm sức khoẻ, backup lần đầu).

Chưa kiểm (cần user):

- Chạy workflow lần đầu: cần secret `SELFHOSTED_SOURCES_TOKEN` (fine-grained, đọc contents của localman-next, chat-next) trên repo hoandat-auth; chạy là đẩy package lên GHCR của tài khoản.
- Bật cửa registry trên production: `RELEASE_REGISTRY_OWNER`, `RELEASE_REGISTRY_TOKEN` (token classic `read:packages`) trong `.env` của .65 và deploy.
- `update.sh` đầu-cuối trên một bản cài đã enrollment (cần gateway thật, tức phase 03 phần IP công khai). Điểm chưa chắc: cosign kiểm chữ ký qua tên registry của gateway trong khi chữ ký ghi tên `ghcr.io/...` (cosign mặc định không so `docker-reference`, cần đo).

## Đổi thiết kế: image công khai (17/10/2026)

User xác nhận trực tiếp (sau khi phiên inet-gitlab-ba chuyển lời): khi các repo chuyển sang public, image `selfhosted-*` trên GHCR cũng public. Cửa registry trên gateway, token tải riêng từng tenant, `RELEASE_REGISTRY_*` và tệp `registry.json` của bản cài đã gỡ khỏi code (lấy lại các file từ `78385c4`). `update.sh` kéo thẳng từ `ghcr.io/achoo254` bằng token ẩn danh của GHCR, đi theo phân trang `Link` của danh sách tag (đã thử trên `sigstore/cosign/cosign`: 3 trang, 300 tag; digest qua `HEAD manifests`), và vẫn từ chối image không do workflow phát hành ký. ADR 0007 §6 và `docs/self-hosted-install.md` đã sửa theo.

Các repo đã public (17/10/2026): Actions chạy được, workflow đọc localman-next và chat-next bằng token của chính nó (bỏ secret `SELFHOSTED_SOURCES_TOKEN`). Còn chờ: chạy workflow lần đầu rồi đổi sáu package sang public (chỉ qua giao diện web); `update.sh` đầu-cuối cần bản cài đã enrollment với gateway thật.

## Nghiệm thu (17/10/2026)

- Workflow `selfhosted-release` chạy lần đầu cho `0.1.0` (localman-next `ab09998`, chat-next `3236784`): lượt 1 hỏng vì `actions/checkout` coi SHA rút gọn là tên nhánh (workflow giờ từ chối SHA rút gọn, `a16f603`); lượt 2 thành công trong khoảng 4 phút. Sáu package `selfhosted-*` public ngay (repo public); kéo ẩn danh tag `0.1.0` trả 200 cả sáu.
- `cosign verify` (v3.1.3) với danh tính `https://github.com/achoo254/hoandat-auth/.github/workflows/selfhosted-release.yml@…`: cả sáu image đạt; danh tính khác bị từ chối.
- Box 183: `update.sh 0.1.0` trên bản cài của lượt nghiệm thu phase 03 (thêm `compose.override.yaml` cho cổng 8080/8443 và CA LAB): kiểm chữ ký sáu image (cosign v2.4.1 trong container, qua tên `ghcr.io/achoo254`), backup Mongo và Postgres vào `data/backups/20261017-160719`, chạy stack theo digest; bộ kiểm từng app đạt như lượt build tại chỗ (issuer đúng domain, Localman và Chat chuyển sang IdP của domain). Image dùng chung mọi domain chạy đúng trên `selfhost-lab.example.org`.
- Chưa thử: lùi tự động khi stack không lên (chỉ đọc mã).
