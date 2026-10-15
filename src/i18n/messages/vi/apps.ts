import type { enApps } from "../en/apps.js";
import type { Translation } from "../translation.js";

export const viApps: Translation<typeof enApps> = {
	"apps.eyebrow": "Đăng nhập {brand}",
	"apps.title": "Một tài khoản cho mọi ứng dụng {brand}",
	"apps.subtitle":
		"Đăng nhập một lần bằng Google hoặc GitHub, rồi dùng cùng tài khoản đó trong mọi ứng dụng bên dưới.",
	"apps.trust.providers": "Đăng nhập bằng Google hoặc GitHub",
	"apps.trust.noPassword": "Không phải tạo hay nhớ mật khẩu",
	"apps.trust.control": "Bạn chọn ứng dụng nào được quyền truy cập",
	"apps.cta.account": "Quản lý tài khoản",
	"apps.cta.how": "Đăng nhập diễn ra thế nào",
	"apps.diagram.label":
		"Tài khoản {brand}, vào bằng Google hoặc GitHub, đăng nhập cho bạn vào {apps}.",
	"apps.list.title": "Ứng dụng bạn dùng được",
	"apps.kind.web": "Ứng dụng web",
	"apps.kind.mcp": "MCP server",
	"apps.kind.cli": "Dòng lệnh",
	"apps.signInLabel": "Cách đăng nhập",
	"apps.open": "Mở",
	"apps.localmanWeb.description":
		"Mock API và API client ngay trên trình duyệt.",
	"apps.localmanWeb.signIn": "Chọn Đăng nhập trên trang.",
	"apps.localmanMcp.description":
		"Cho công cụ AI như Claude Code làm việc với project Localman của bạn.",
	"apps.localmanMcp.signIn":
		"Thêm {address} vào công cụ AI làm MCP server, rồi duyệt những gì nó được làm ở trang cấp quyền.",
	"apps.tuneloCli.description": "Mở tunnel từ máy của bạn ra internet.",
	"apps.tuneloCli.signIn":
		"Chạy {command} trong terminal, rồi nhập mã nó hiện ở {device}.",
	"apps.tuneloWeb.description": "Tunnel của bạn trên trình duyệt.",
	"apps.tuneloWeb.signIn": "Chọn Đăng nhập trên trang.",
	"apps.chatWeb.description":
		"Nhắn tin nhanh, tìm lại lịch sử tin nhắn và dùng bot.",
	"apps.chatWeb.signIn": "Chọn Đăng nhập trên trang.",
	"apps.steps.title": "Đăng nhập diễn ra thế nào",
	"apps.steps.choose.title": "Chọn một ứng dụng",
	"apps.steps.choose.body":
		"Chọn Đăng nhập trên trang của nó, hoặc chạy {command} trong terminal.",
	"apps.steps.provider.title": "Tiếp tục với Google hoặc GitHub",
	"apps.steps.provider.body":
		"Tài khoản bạn đã liên kết sẽ đăng nhập cho bạn. Lần đầu, bạn chọn một tên đăng nhập.",
	"apps.steps.back.title": "Quay lại ứng dụng",
	"apps.steps.back.body":
		"Ứng dụng bên ngoài {brand}, như công cụ AI, sẽ hỏi bạn đồng ý trước.",
	"apps.manage":
		"Để xem hoặc gỡ các ứng dụng đang có quyền vào tài khoản, mở trang {account}.",
};
