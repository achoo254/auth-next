import type { enPush } from "../en/push.js";
import type { Translation } from "../translation.js";

export const viPush: Translation<typeof enPush> = {
	"push.newSignIn.title": "Đăng nhập mới",
	"push.newSignIn.body":
		"Tài khoản {brand} của bạn vừa được đăng nhập. Nếu không phải bạn, hãy mở app và đăng xuất phiên đó.",
	"push.providerLinked.title": "Đã thêm cách đăng nhập",
	"push.providerLinked.body":
		"{provider} giờ đăng nhập được vào tài khoản {brand} của bạn. Nếu không phải bạn, hãy huỷ liên kết trong app.",
	"push.providerUnlinked.title": "Đã gỡ cách đăng nhập",
	"push.providerUnlinked.body":
		"{provider} không còn đăng nhập được vào tài khoản {brand} của bạn.",
	"push.emailReclaimed.title": "Email đã bị gỡ",
	"push.emailReclaimed.body":
		"Email chưa xác minh của bạn đã bị gỡ khỏi tài khoản {brand} vì chủ của nó đã xác minh bằng {provider}.",
	"push.accessRevoked.title": "Đã thu hồi quyền truy cập",
	"push.accessRevoked.body":
		"{app} không còn quyền truy cập tài khoản {brand} của bạn.",
	"push.accessRevoked.bodyOther":
		"Một phiên, thiết bị hoặc ứng dụng vừa mất quyền truy cập tài khoản {brand} của bạn.",
};
