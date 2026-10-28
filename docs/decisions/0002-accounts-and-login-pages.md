# ADR 0002: Tài khoản, trang đăng nhập và trang `/account`

- Trạng thái: chấp nhận; mục 3, 4, 8, 10 bị ADR 0004 thay một phần
- Ngày: 2026-10-08
- Phạm vi: phase 02 của IdP (tài khoản, đăng nhập không dùng email, quản lý tài khoản)

> Cập nhật 2026-10-10: IdP chỉ còn đăng nhập bằng Google/GitHub ([ADR 0004](0004-upstream-only-sign-in.md)). Phần về mật khẩu, mã khôi phục, khoá đăng nhập và cookie thiết bị (mục 3, 4), đặt lại mật khẩu và rà soát bảo mật (mục 8, 10) đã bị gỡ khỏi code; giữ ở đây làm lịch sử quyết định.

## Bối cảnh

Phase 01 dựng lõi OIDC với interaction trả 501. Phase 02 cần trang đăng nhập, đăng ký, consent, duyệt thiết bị, khôi phục tài khoản không qua email và trang tự quản lý tài khoản, trong khi vẫn giữ IdP là một process Node nhỏ, không có frontend build riêng.

## Quyết định

### 1. Trang render phía server, không JavaScript

- Mọi trang là HTML do Express render bằng template tự escape (`src/ui/html.ts`); không có bundler frontend, không inline script hay inline style, nên CSP chỉ cần `'self'`.
- Những chỗ thường cần JS đều làm bằng HTML thuần: tải mã khôi phục là link `data:` có thuộc tính `download`; "đã lưu mã" là checkbox `required` và server kiểm lại.
- Các trang mà `oidc-provider` tự render (nhập mã thiết bị, đăng xuất, lỗi) được thay qua hook của thư viện (`userCodeInputSource`, `logoutSource`, `renderError`...) bằng cùng layout.

### 2. `/account` dùng chính phiên của IdP, đăng nhập qua một client nội bộ

- `/account` đọc `Session` của `oidc-provider` từ cookie phiên (`provider.Session.get`), không có kho phiên thứ hai.
- Chưa đăng nhập thì `/account` khởi động một authorization request (Code + PKCE) của client tĩnh `hoandat-account`. Nhờ vậy đăng nhập vào trang tài khoản đi đúng một đường với mọi app (cùng trang, cùng khoá, cùng Google/GitHub). Code trả về không bao giờ được đổi; verifier PKCE bị bỏ ngay nên code vô dụng.
- Phương án bị loại: tự tạo phiên cho `/account` (phải nhân đôi logic đăng nhập và tự đồng bộ đăng xuất); ghi thẳng vào Session của thư viện (không phải API công khai).

### 3. CSRF và khoá đăng nhập

- CSRF: cookie HttpOnly chứa bí mật ngẫu nhiên theo trình duyệt; mỗi form mang HMAC (khoá đầu của `COOKIE_KEYS`) của bí mật đó và một phạm vi: uid interaction, uid phiên IdP, hoặc token reset. Token của interaction/phiên này không dùng được cho cái khác; xoay `COOKIE_KEYS` không làm hỏng form đang mở.
- Khoá (sửa sau review bảo mật): mỗi lượt thử được **giữ chỗ nguyên tử** (`findOneAndUpdate` với `$inc` và upsert, bỏ qua khoá đang hiệu lực) *trước* khi chạy argon2; lượt vượt ngân sách hoặc gặp khoá bị từ chối mà không kiểm mật khẩu. Nhờ vậy request song song cũng chỉ được kiểm tối đa 5 lượt; lượt thứ 5 sai thì khoá 15 phút; đúng thì bộ đếm của tài khoản về 0 và IP được trả lại một lượt. Áp chung cho mật khẩu, mã khôi phục và yêu cầu reset qua Telegram (tối đa 3 lần mỗi 15 phút, không bao giờ kéo dài cửa sổ).
- Bộ đếm theo `account._id` khi tài khoản tồn tại (username và email dùng chung một ngân sách), theo định danh đã chuẩn hoá khi không tồn tại, cộng một bộ đếm theo IP (IPv6 gom theo /64). Lưu trong MongoDB có TTL, restart không xoá khoá. Tài khoản không tồn tại cũng bị đếm và cũng chạy argon2.
- Trình duyệt từng đăng nhập thành công tài khoản giữ cookie thiết bị (HttpOnly, 90 ngày, tối đa 5 tài khoản). Chữ ký HMAC (`COOKIE_KEYS`) phủ cả id tài khoản, thời điểm cấp, một nonce ngẫu nhiên và **thế hệ thông tin đăng nhập** (`credentialsChangedAt`, đổi mỗi khi đặt/đổi mật khẩu), nên reset hay đổi mật khẩu làm mọi cookie cũ mất hiệu lực. Trình duyệt có cookie hợp lệ không dùng ngân sách của tài khoản mà có ngân sách riêng theo chữ ký cookie: sai 5 lần thì cookie đó mất quyền miễn (khoá 90 ngày, tức tới khi đăng nhập thành công lại và nhận cookie mới) và bị đếm như trình duyệt lạ. Ngân sách theo IP luôn áp dụng. Throttle reset qua Telegram không cho cookie miễn gì.

### 4. Bí mật dùng một lần lưu dạng hash

Mã liên kết Telegram, token reset mật khẩu, state OAuth và hồ sơ Google/GitHub đang chờ đều nằm trong `one_time_tokens`: khoá là SHA-256 của loại và giá trị, có `expiresAt` với TTL index, và lấy ra bằng `findOneAndDelete` để chỉ một request dùng được. Mã khôi phục là băm argon2id; kiểm luôn đúng 8 lần argon2 để thời gian không lộ số mã còn lại.

### 5. Mỗi thiết bị Tunelo một grant

`oidc-provider` mặc định dùng lại một grant cho mỗi cặp phiên trình duyệt và client. Khi duyệt thiết bị, IdP luôn tạo grant mới và ghi tên máy vào `grant_meta`, để trang `/account` liệt kê và thu hồi từng máy mà không ảnh hưởng máy khác.

### 6. Google/GitHub qua `openid-client`, sau một interface

- Plan ban đầu chọn `arctic`, nhưng npm đã đánh dấu `arctic` (và các gói `@oslojs` nó dùng) là "no longer supported". Jev (2026-10-08) quyết thay bằng `openid-client` v6: cùng tác giả với `oidc-provider`, được OpenID Foundation chứng nhận, và đã có trong repo.
- Google là OpenID Provider: Code + PKCE + state + nonce; `openid-client` kiểm ID token (issuer, audience, hạn, nonce). Chữ ký không kiểm vì token đến thẳng từ token endpoint qua TLS (OIDC Core 3.1.3.7). GitHub là OAuth 2.0 thuần: endpoint cấu hình tay, Code + PKCE + state, email đã xác minh lấy từ `/user/emails`.
- Metadata của hai provider ghi tĩnh trong code thay vì gọi discovery, để bắt đầu đăng nhập không phụ thuộc một request discovery. Đổi endpoint thì sửa hằng số `GOOGLE_SERVER`, `GITHUB_SERVER`.
- Chỉ `upstream-google.ts` và `upstream-github.ts` biết thư viện; phần còn lại dùng `UpstreamClient`.

### 7. Phiên trượt: 30 ngày không dùng, trần 90 ngày

- Jev (2026-10-08, 0.78) quyết: thay cho grant sống cứng 30 ngày, mỗi lần refresh thành công grant được gia hạn tới 30 ngày sau lần refresh đó, nhưng không quá 90 ngày kể từ lúc tạo grant (lúc đăng nhập). Refresh token mới sống `min(30 ngày, còn lại tới trần)`.
- Cách làm (đã đọc source `oidc-provider` 9.12.2): `ttl.RefreshToken` là hàm tính theo `iat` của grant trong context (dự phòng `iiat`, mốc của chuỗi xoay vòng). Việc gia hạn grant nằm trong hook `rotateRefreshToken`: thư viện gọi hook này sau khi refresh token và grant đã qua kiểm tra, trước khi phát token mới, và có `await`, nên grant (`exp` mới, `expiresAt` trong Mongo) được lưu trước khi trả response. Hook luôn trả `true`, nên xoay vòng và phát hiện dùng lại vẫn như cũ.
- Áp cho mọi grant có refresh token. Grant không có refresh vẫn hết sau 30 ngày. Refresh token của client MCP (không có `offline_access`) vẫn gắn với phiên trình duyệt (mặc định `expiresWithSession` của thư viện).
- Trần tính từ lúc tạo grant. Đăng nhập Tunelo CLI luôn tạo grant mới (mục 5), nên trần đúng bằng 90 ngày từ `tunelo login`; app web có grant mới theo mỗi phiên trình duyệt mới.

### 8. Đổi hoặc đặt lại mật khẩu thì thu hồi quyền, thao tác nhạy cảm cần đăng nhập gần đây

- Đặt lại mật khẩu (mã khôi phục, link Telegram, Google/GitHub) nghĩa là mật khẩu cũ có thể đã lọt: IdP thu hồi **mọi** phiên trình duyệt (kèm back-channel logout) và **mọi** grant của tài khoản (thiết bị Tunelo, ứng dụng, client MCP). Riêng đường mã khôi phục giữ lại phiên của chính trình duyệt đang đặt lại, vì interaction đang chạy cần nó.
- Đổi mật khẩu ở `/account` (Jev 0.80): luôn đăng xuất mọi trình duyệt khác; ô "Đăng xuất khỏi mọi thiết bị và ứng dụng" bật sẵn, tick thì thu hồi luôn mọi grant.
- Đổi/đặt mật khẩu, tạo lại mã khôi phục, liên kết hoặc huỷ Google/GitHub/Telegram cần `session.loginTs` trong 10 phút; quá hạn thì chuyển sang đăng nhập lại bằng authorization request của `hoandat-account` với `prompt=login`, rồi về `/account` để làm lại (form không được gửi lại tự động). Trang xác nhận gỡ quyền một app và "đăng xuất mọi phiên khác" cũng cần đăng nhập trong 10 phút nhưng hỏi lại ngay khi mở trang, rồi quay về đúng trang đó, để bấm nút là xong (28/10/2026: hỏi sau khi bấm nút khiến người dùng tưởng bị đăng xuất và thao tác bị mất). Các thay đổi đó, cùng việc email bị gỡ, được báo qua Telegram nếu đã liên kết.
- Liên kết Telegram cần bấm nút xác nhận trong chat sau `/start`, để một link bị lộ không tự gắn chat của người khác. Mã liên kết gắn với phiên IdP đã tạo ra nó: phiên đó đã kết thúc (đăng xuất, bị thu hồi) thì xác nhận bị từ chối. Đổi/đặt lại mật khẩu huỷ mọi token một lần của tài khoản (mã liên kết, link reset, liên kết Google/GitHub dở dang), nên kẻ đã cầm phiên bị đánh cắp không còn cách gắn Telegram của họ để nhận link reset về sau.
- Rà soát bảo mật bắt buộc (Jev 0.93): sau MỌI lần đặt lại mật khẩu (mã khôi phục, Telegram, Google/GitHub) tài khoản có `securityReviewPendingSince`. Mọi lần đăng nhập dừng ở trang "Rà soát bảo mật" trước khi interaction hoàn tất; một luật trong login prompt buộc cả phiên còn sống phải qua trang đăng nhập (không có đăng nhập ngầm), và `/account` chuyển sang đăng nhập. Trang liệt kê Google/GitHub đã liên kết kèm email/login provider ghi lại lúc liên kết (`providerDetails`; liên kết cũ hiện "không rõ"), chat Telegram (@username/tên), thời điểm tạo bộ mã khôi phục; mỗi mục có nút gỡ (gỡ được cả phương thức cuối vì vừa có mật khẩu mới) và nút tạo lại mã. Chỉ khi bấm "Tôi đã rà soát" cờ mới được xoá và đăng nhập mới hoàn tất. Trong lúc chờ rà soát, chỉ hai đường vào được trang rà soát: đăng nhập bằng **mật khẩu** (mật khẩu hiện tại là mật khẩu vừa đặt khi reset, chỉ người reset biết), hoặc chính trình duyệt vừa reset (luồng mã khôi phục tiếp tục ngay trong interaction; link reset Telegram và nhánh Google/GitHub chuyển thẳng tới `/reset/review` nhờ một token dùng một lần trong cookie HttpOnly, sống 30 phút). Đăng nhập Google/GitHub khi đang chờ rà soát bị từ chối, kể cả tự liên kết theo email, vì provider đó có thể chính là thứ kẻ xâm nhập đã thêm. `/account` luôn hiện danh tính provider và Telegram.
- Callback của `/account` chỉ hiện thông báo "đã xác nhận lại" khi `state` khớp nonce trong cookie mà chính trình duyệt đó nhận lúc bị chuyển đi đăng nhập.

### 9. Email chưa xác minh: người xác minh lấy lại (Jev 0.95, chọn reclaim)

- Đăng nhập/đăng ký Google/GitHub với email đã xác minh, mà email đó đang nằm trên một tài khoản có email **chưa** xác minh: IdP không liên kết vào tài khoản cũ (người chiếm trước có thể đặt sẵn mật khẩu hay Telegram). Người có email xác minh tạo tài khoản mới với email đó; email bị gỡ khỏi tài khoản cũ (`email` không còn, `reclaimedEmail` ghi lại địa chỉ và thời điểm), tài khoản cũ vẫn đăng nhập bằng username, thấy thông báo ở `/account` và nhận tin Telegram nếu có.
- Vì vậy `email` là tuỳ chọn trong model; unique index của email là partial (chỉ tính bản ghi có email). Email và username được chuẩn hoá trong `AccountRepository` cho mọi ghi và đọc.
- Nếu tài khoản cũ đúng là của người đó, họ đăng nhập bằng mật khẩu rồi liên kết Google/GitHub ở `/account` (liên kết chủ động không cần email trùng).
- Mỗi lần liên kết lưu email provider đã xác minh cho riêng provider đó. Gỡ một provider chỉ hạ `emailVerifiedBy` về null khi không còn provider nào khác đã xác minh đúng email đó; nếu còn thì chuyển sang provider kia.
- Rủi ro chấp nhận: email có thể bị nhà cung cấp cấp lại cho người khác (ví dụ Google Workspace của công ty cấp lại địa chỉ của nhân viên cũ, hoặc tên miền riêng hết hạn rồi bị người khác đăng ký). Người mới đó được Google/GitHub xác minh email nên có thể (a) tự liên kết vào tài khoản cũ khi tài khoản đó có email đã xác minh, hoặc (b) lấy lại email khỏi tài khoản có email chưa xác minh. Giảm thiểu: thông báo Telegram khi có liên kết mới hoặc email bị gỡ, `/account` hiện danh tính provider, và trang rà soát sau mỗi lần reset. Việc kiểm "provider account id" (`sub`) khác với lần liên kết trước không áp dụng được cho (a), vì đó là lần liên kết đầu.

### 10. Bất biến `securityVersion`: token cấp trước một thay đổi bảo mật không dùng được sau đó

- Tài khoản có `securityVersion` (số nguyên, mặc định 0), tăng ngay trong cùng câu lệnh cập nhật của tầng dữ liệu (`AccountRepository`, `AccountLinks`) mỗi khi: đặt/đổi/đặt lại mật khẩu, tạo lại mã khôi phục, liên kết hoặc gỡ Google/GitHub/Telegram, email bị lấy lại, bắt đầu hoặc kết thúc rà soát bảo mật.
- Token một lần chia hai loại theo kiểu (TypeScript không cho trộn): loại tự do (`upstream-state`, `upstream-pending`, không gắn tài khoản) và loại gắn tài khoản (`password-reset`, `telegram-link`, `upstream-link-state`, `signup-pending`, `review-pending`, `review-reset`). Loại gắn tài khoản chỉ đi qua `AccountTokens` (`src/accounts/account-tokens.ts`): khi cấp, đóng dấu `accountId`, `securityVersion` hiện tại và kênh (chat Telegram, hoặc id Google/GitHub) nếu có; khi dùng, `isTokenCurrent` kiểm tài khoản còn hoạt động, version không đổi và kênh vẫn còn liên kết. Sai thì token coi như hết hạn (trang reset trả 410). Không route nào tự kiểm.
- Kiểm token rồi ghi không được để hở giữa hai bước: `peek`/`take` trả về version đã kiểm, và thao tác ghi mà token cho phép (đặt mật khẩu qua reset, gỡ/liên kết phương thức trên trang rà soát hay ở `/account`, xác nhận liên kết Telegram, hoàn tất rà soát) truyền version đó xuống repository. Repository ghi có điều kiện `{ _id, securityVersion: v }` (`src/accounts/versioned-write.ts`, kết quả `GuardedWrite`); không khớp thì thao tác bị từ chối như token hết hạn (410). Route không tự viết điều kiện.
- Luồng tự làm tăng version (gỡ một mục hay tạo mã mới trong trang rà soát) đóng dấu lại chính token của mình bằng `renew`, nhưng chỉ khi version hiện tại đúng bằng version mà chính lệnh ghi có điều kiện vừa tạo ra; có thay đổi khác chen vào thì token cũng bị huỷ. Mọi token cũ khác vẫn chết. Luồng đặt lại mật khẩu cấp token rà soát sau khi version đã tăng.
- Trong lúc chờ rà soát, IdP không cấp link reset qua Telegram hay Google/GitHub (trả cùng câu trung tính như bình thường); chỉ mã khôi phục và mật khẩu mới dùng được. Hoàn tất rà soát thu hồi thêm một lần mọi phiên và grant khác, phòng trường hợp một lần đăng nhập đã qua bước kiểm mật khẩu ngay trước khi reset.
- Đã rà các trạng thái khác cùng loại: cookie thiết bị gắn `credentialsChangedAt` (mục 3); phiên trình duyệt và grant bị thu hồi khi đổi/đặt lại mật khẩu (mục 8) và lần nữa khi xong rà soát; CSRF gắn uid phiên/interaction/token nên chết theo chúng; nonce `reauth.` chỉ quyết định một dòng thông báo; device code đang chờ duyệt cần một phiên còn sống để duyệt, và device code đã duyệt chết theo grant; interaction đang dở thuộc phiên đã bị thu hồi thì `oidc-provider` từ chối ("session not found").

## Hệ quả

- Đăng ký buộc phải nói trường nào đã được dùng (email hay username): không có mail để xác nhận thì không giấu được. Mọi trang khác không tiết lộ tài khoản có tồn tại. Riêng việc đếm lượt theo tài khoản có một hệ quả nhỏ: người đã biết cả username lẫn email của một tài khoản có thể thử xen kẽ hai cái để biết chúng thuộc cùng một tài khoản.
- Thu hồi grant xoá refresh token và token opaque ngay, nhưng access token JWT (15 phút) vẫn hợp lệ tới khi hết hạn.
- Client tĩnh `hoandat-account` phải có mặt ở mọi môi trường (script seed client của phase 03 cần tính tới).
- Access token JWT (15 phút) không thu hồi được; mọi thứ khác (refresh token, token opaque, phiên, token một lần) mất hiệu lực ngay khi có thay đổi bảo mật.
