import type { enApps } from "../en/apps.js";
import type { Translation } from "../translation.js";

export const viApps: Translation<typeof enApps> = {
	"apps.title": "Ứng dụng dùng tài khoản hoandat",
	"apps.subtitle":
		"Một tài khoản hoandat đăng nhập được mọi ứng dụng dưới đây, bằng Google hoặc GitHub.",
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
	"apps.manage":
		"Để xem hoặc gỡ các ứng dụng đang có quyền vào tài khoản, mở trang {account}.",
};
