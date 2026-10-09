import { Router } from "express";
import { pageTitle } from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";

export const PRIVACY_PATH = "/privacy";

/**
 * Public privacy policy. Google requires one before a "Sign in with Google"
 * app can leave testing; it states only what this service actually stores.
 */
export function renderPrivacyPage(host: string): string {
	return renderPage({
		title: "Chính sách quyền riêng tư",
		host,
		wide: true,
		body: html`${pageTitle(
			"Chính sách quyền riêng tư",
			"Áp dụng cho dịch vụ đăng nhập auth.hoandat.com. Cập nhật ngày 09/10/2026.",
		)}
<div class="prose" data-id="privacy-policy">
<h2>Dữ liệu được lưu</h2>
<ul>
<li>Tên đăng nhập, địa chỉ email, tên hiển thị và ảnh đại diện.</li>
<li>Mật khẩu ở dạng băm argon2id và mã khôi phục ở dạng băm; không lưu mật khẩu gốc.</li>
<li>Khi bạn đăng nhập bằng Google hoặc GitHub: mã định danh tài khoản ở nhà cung cấp, email đã xác minh, tên và ảnh đại diện mà nhà cung cấp trả về.</li>
<li>Khi bạn liên kết Telegram: mã chat và tên người dùng Telegram.</li>
<li>Phiên đăng nhập, thiết bị và ứng dụng bạn đã cấp quyền, kèm thời điểm sử dụng.</li>
<li>Nhật ký bảo mật (đăng nhập, đổi mật khẩu, liên kết hoặc gỡ phương thức đăng nhập) gồm địa chỉ IP và trình duyệt; IP và trình duyệt của sự kiện chưa gửi đi bị xoá sau 30 ngày.</li>
</ul>
<h2>Mục đích sử dụng</h2>
<p>Dữ liệu chỉ dùng để xác thực bạn, giữ phiên đăng nhập, khôi phục tài khoản và phát hiện truy cập bất thường. Dịch vụ không gửi email, không hiển thị quảng cáo và không bán dữ liệu.</p>
<h2>Chia sẻ</h2>
<p>Thông tin hồ sơ chỉ được cấp cho các ứng dụng do cùng chủ sở hữu vận hành (Localman, Tunelo) hoặc ứng dụng bạn đã đồng ý cấp quyền, trong phạm vi bạn đồng ý. Không chia sẻ cho bên thứ ba nào khác.</p>
<h2>Quyền của bạn</h2>
<p>Tại trang <a href="/account">Tài khoản</a>, bạn xem và sửa hồ sơ, gỡ liên kết Google, GitHub hoặc Telegram, thu hồi phiên và ứng dụng đã cấp quyền. Để xoá tài khoản, liên hệ quocdat254@gmail.com.</p>
<h2>Lưu trữ</h2>
<p>Dữ liệu nằm trên máy chủ tại Việt Nam do chủ sở hữu dịch vụ quản lý, có sao lưu hằng ngày giữ 14 ngày.</p>
</div>`,
	});
}

export function createPrivacyRouter(host: string): Router {
	const router = Router();
	const page = renderPrivacyPage(host);
	router.get(PRIVACY_PATH, (_req, res) => {
		res
			.status(200)
			.set("cache-control", "public, max-age=3600")
			.type("html")
			.send(page);
	});
	return router;
}
