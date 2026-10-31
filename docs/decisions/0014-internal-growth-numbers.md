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
