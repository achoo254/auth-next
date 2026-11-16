# ADR 0014: Số liệu tăng trưởng cho chương trình trên cùng máy chủ

- Trạng thái: chấp nhận
- Ngày: 2026-10-31
- Phạm vi: route `GET /internal/growth-numbers` (`src/usage/growth-numbers.ts`), nginx `infra/nginx/auth.hoandat.com.conf`.
- Liên quan: ADR 0011 (`client_usage`), ADR 0013 (đơn tenant, không có API nội bộ nếu không có ADR mới).

## Bối cảnh

Đại ca đặt mục tiêu tới 31/12/2026: 500 tài khoản Hoandat và ít nhất 100 người dùng thường xuyên trên cả hệ sinh
thái. Tiểu Đệ (`tieu-de-next`, bot marketing chạy trên cùng máy chủ `.65`) phải thấy tiến độ mỗi ngày để chọn việc
và báo cáo. Hôm nay chỉ có CLI `growth-report` (ADR 0011), phải chạy tay và đọc thẳng MongoDB của IdP.

Ba cách đã cân nhắc (Jev chọn, đại ca duyệt 31/10/2026):

| Cách | Jev |
|---|---|
| Route chỉ đọc, chỉ trả lời chương trình trên cùng máy, nginx chặn từ internet | 0,94 |
| Route chỉ đọc có khoá bí mật chung trong env của hai dịch vụ | 0,04 |
| Người dùng MongoDB chỉ đọc cho bot đọc thẳng database `auth` | 0,02 |

## Quyết định

1. Route `GET /internal/growth-numbers` trả JSON đếm số, không có gì về một người cụ thể: tổng tài khoản, tài khoản
   mới trong 24 giờ và 7 ngày, số tài khoản vào app trong 14 ngày, số người dùng thường xuyên (vào app ở ít nhất 3
   ngày Sài Gòn khác nhau trong 14 ngày, theo `client_usage`). Tài khoản người duyệt App Store bị loại như
   `growth-report`. Phiên của app không quay lại IdP thì không thấy, nên số người thường xuyên là mức sàn.
2. Hai lớp chặn: nginx trả 404 cho mọi đường `/internal/` từ internet; route chỉ trả lời khi `req.ip` là loopback
   (Express chỉ tin proxy loopback, nên `X-Forwarded-For` giả từ ngoài không đổi được `req.ip`). Không có khoá bí mật
   mới.
3. Không thêm API nội bộ nào khác theo ADR này. Route mới cùng loại cần ADR riêng.

## Hệ quả

- Tiểu Đệ gọi `http://127.0.0.1:4500/internal/growth-numbers` với header `Host` của IdP mỗi ngày.
- Sửa nginx trên `.65` cùng lần deploy có route (`infra/deploy.sh` không chép nginx; xem `docs/deployment-guide.md`).

## Bổ sung 16/11/2026: nguồn đăng ký và kích hoạt

Thêm trường (không đổi trường cũ; Tiểu Đệ kiểm chúng), cùng route, cùng hai lớp chặn (`src/usage/growth-funnel.ts`):

- `signupSources.last7d` / `last30d`: tài khoản mới từ 00:00 Sài Gòn của 7 (30) ngày gần nhất, kể cả hôm nay, gộp theo
  `{client, utmSource, utmCampaign, count}` từ `signupSource` của tài khoản (`src/accounts/signup-source.ts`); tài khoản
  trước 16/11/2026 không có nguồn nên ra `null`. `newLast7d` cũ vẫn tính 7×24 giờ lùi từ lúc gọi, nên tổng `count` của
  `last7d` và `newLast7d` không nhất thiết khớp nhau.
- `activation`: cohort là tài khoản tạo trong 30 ngày Sài Gòn trọn vẹn kết thúc 8 ngày trước (từ 00:00 ngày hôm nay − 37
  tới trước 00:00 ngày hôm nay − 7), để ai trong cohort cũng đã qua đủ ngày thứ 7; `cohortSignedUp`/`cohortActivated`
  đếm trên cohort đó, `activatedTotal` trên mọi tài khoản. Kích hoạt là có lượt vào app (không tính trang của IdP, như
  `regular14d`) ở ngày Sài Gòn thứ 1 tới 7 sau ngày tạo tài khoản. Người duyệt App Store bị loại.
- Giới hạn: kích hoạt đọc từ `client_usage`, mà TTL xoá lượt vào app sau 400 ngày (ADR 0011). Tài khoản kích hoạt hơn
  400 ngày trước sẽ rơi khỏi `activatedTotal`; chấp nhận vì mục tiêu tính tới 31/12/2026 và `client_usage` mới có từ ADR 0011.
  Cần số trọn đời thì lưu `activatedAt` trên tài khoản (chưa làm).
- Thẻ UTM lặp lại trên chính authorization request bị `invalid_request` như mọi tham số lặp của `oidc-provider`;
  `/account?signup=1` chỉ chuyển tiếp giá trị đầu tiên.
