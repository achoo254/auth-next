# ADR 0016: Thu hồi grant `tunelo-agent` từ Chat và link điền sẵn mã theo IP

- Trạng thái: chấp nhận
- Ngày: 2026-11-12
- Phạm vi: `src/oidc/agent-grant-revocation.ts` (route `POST /api/tunelo-agent/grants/revoke`), `src/oidc/tunelo-agent-client.ts`
  (claim `grant_id`), `src/interactions/device-verify-page.ts` và `src/interactions/device-app-access.ts` (`sameIp`).
- Liên quan: ADR 0003 (client tĩnh), ADR 0013 (đơn tenant, không có API nội bộ nếu không có ADR mới); phía Chat:
  [ADR 0013 của `chat-next`](https://github.com/achoo254/chat-next/blob/main/docs/adr/0013-remote-machines.md), mục "Tài khoản là gốc
  tin cậy". Hợp đồng với client: [`integration-guide.md`](../integration-guide.md) mục 7.

## Bối cảnh

Tunelo 3.0 bỏ ghép thiết bị: tài khoản là gốc tin cậy giữa máy và thiết bị, và cài máy chỉ còn một lệnh cố định chạy
`tunelo login` (device flow của client `tunelo-agent`). Grant `tunelo-agent` vì thế là quyền mạnh nhất hệ thống: tunnel, Chat MCP,
Localman MCP, thêm máy vào tài khoản. Hai việc trước đây chưa có:

1. Xoá một máy trên web Chat chỉ làm Chat từ chối máy đó; grant ở IdP còn sống, refresh token của máy vẫn làm mới được, nên máy tự
   đăng ký lại. Chat không có cách nói với IdP grant nào là của máy nào.
2. `tunelo-agent` bị bỏ `verification_uri_complete` (luôn gõ mã) để một link điền sẵn mã bị chuyển tiếp không trao được grant đó.
   Cài một lệnh cần người dùng chỉ bấm "Đồng ý" trên trình duyệt của chính máy, không gõ gì.

## Quyết định

1. **Claim `grant_id`.** Mọi access token JWT cấp cho `tunelo-agent` mang `grant_id` của lần đăng nhập đó; không đổi qua các lần
   refresh, mỗi lần `tunelo login` mới là một grant mới. Không phải bí mật: không dùng được làm credential. Chat đọc nó từ token đã
   xác minh khi máy đăng ký và lưu theo máy.
2. **Route thu hồi công khai, chỉ Chat gọi được.** `POST /api/tunelo-agent/grants/revoke` nhận `{sub, grant_id}`, xác thực bằng
   client credentials sẵn có của `chat-web` (`client_secret_basic`), chỉ thu hồi grant `tunelo-agent` của đúng `sub`. Trả 204 cả
   khi grant đã mất (thu hồi, hết hạn, tài khoản đã xoá) để Chat thử lại an toàn; grant còn nhưng không khớp thì 404. Ghi audit
   `grant.revoked` với `cause: "machine-removed"`.
   - Không đặt dưới `/internal/`: nginx chặn `/internal/` từ internet và Chat gọi IdP qua URL công khai.
   - Không thêm khoá bí mật dùng chung mới: secret của `chat-web` đã có ở cả hai bên.
   - Không thêm `sid` hay gắn grant với phiên IdP: grant máy vẫn sống qua đăng xuất IdP như trước.
3. **Link điền sẵn mã chỉ khi trùng IP.** `tunelo-agent` nhận `verification_uri_complete` như client khác, nhưng trang mở từ link chỉ
   nhận mã điền sẵn khi IP trình duyệt trùng IP máy đã xin mã (dạng `::ffff:` của IPv4 coi là một). Khác IP (máy qua SSH, link bị
   gửi sang người khác) thì trang hiện ô gõ mã đang in trong terminal. Màn duyệt vẫn cảnh báo khi IP khác. `tunelo-cli` không đổi.

## Phương án đã cân nhắc

- Link điền sẵn mã: so IP (Jev chọn 0,65), bắt người dùng chọn số khớp với terminal (0,25), chỉ cảnh báo, hoặc giữ bỏ hẳn link. Chọn
  số chặn được cả cùng NAT nhưng thêm một bước cho mọi lần cài; chỉ cảnh báo thì người dùng bấm qua.
- Máy bị xoá: chỉ để Chat từ chối (máy tự quay lại bằng refresh), hoặc thu hồi grant ở IdP (Jev chọn 0,95, cùng với bắt máy chứng
  minh giữ khoá khi đăng ký lại phía Chat).

## Hệ quả

- Máy bị xoá trên web (hoặc tự `tunelo logout`) phải `tunelo login` lại và chủ bấm Đồng ý mới quay về được. Access token đã cấp
  vẫn sống tới hết hạn (tối đa 15 phút), nên Chat vẫn phải tự từ chối máy đã xoá.
- Cùng NAT (cùng mạng nhà, công ty) vẫn nhận được link điền sẵn: chấp nhận.
- Đổi client gọi route hay thêm loại grant thu hồi được là sửa `agent-grant-revocation.ts` và ADR này; Chat cấu hình URL bằng
  `TUNELO_GRANT_REVOKE_URL`.
