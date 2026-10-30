import type { enConsent } from "../en/consent.js";
import type { Translation } from "../translation.js";

export const viConsent: Translation<typeof enConsent> = {
	"consent.pageTitle": "Cấp quyền",
	"consent.titleForApp": "Cho phép {app} dùng tài khoản {brand} của bạn",
	"consent.titleExternal":
		"Cho phép một ứng dụng bên ngoài dùng tài khoản {brand} của bạn",
	"consent.redirect":
		"Sau khi cho phép, bạn được chuyển về {host} kèm mã để ứng dụng nhận token.",
	"consent.willBeAbleTo": "Ứng dụng sẽ được:",
	"consent.allow": "Cho phép",
	"consent.deny": "Từ chối",
	"consent.revokeHint":
		"Bạn có thể thu hồi quyền này bất cứ lúc nào ở trang tài khoản.",
	"consent.externalNotice":
		"Ứng dụng bên ngoài, không do {brandDomain} phát hành. Tên ứng dụng do chính nó tự khai và {brand} không kiểm tra ai đứng sau nó; chỉ cho phép nếu chính bạn vừa kết nối nó (ví dụ một coding agent dùng MCP).",
	"consent.lookalikeWarning":
		"Tên ứng dụng giống sản phẩm của {brandDomain} nhưng không phải, và nó chuyển bạn về một website chứ không phải máy của bạn. Chỉ cho phép nếu bạn nhận ra địa chỉ ở trên là của ứng dụng chính bạn vừa kết nối; nếu không, hãy từ chối.",
	"consent.credentialsWarning":
		"Cho phép tạo khoá truy cập và secret mới thay bạn. Chỉ cấp cho ứng dụng bạn tin tưởng.",
	"consent.botsAdminWarning":
		"Cho phép chuyển mọi tin gửi tới bot sang địa chỉ khác (webhook), cấp lại token và xoá bot. Chỉ cấp cho ứng dụng bạn tin tưởng.",
	"scope.openid": "Biết bạn là ai (mã định danh tài khoản {brand})",
	"scope.profile": "Xem tên, username và ảnh đại diện",
	"scope.email": "Xem địa chỉ email",
	"scope.offlineAccess":
		"Giữ đăng nhập khi bạn không mở ứng dụng (tối đa 30 ngày)",
	"scope.telegram": "Gửi thông báo tới chat Telegram bạn đã liên kết",
	"scope.mockRead":
		"Xem project mock trên Localman mà bạn có quyền truy cập, gồm resource, schema và dữ liệu",
	"scope.mockWrite":
		"Tạo, sửa, xoá project và resource mock trên Localman, sinh hoặc reset dữ liệu",
	"scope.clientRead":
		"Xem workspace và thành viên, collection, request và environment trong API client của Localman mà bạn có quyền truy cập, cùng cách chúng được chia sẻ (biến secret luôn bị che)",
	"scope.clientWrite":
		"Tạo, sửa, xoá, import collection và request, đặt biến environment và quản lý workspace trong API client của Localman",
	"scope.clientSend":
		"Gửi request thay bạn qua proxy của Localman, kể cả tới localhost qua Tunelo (tính vào hạn mức proxy)",
	"scope.credentialsWrite":
		"Tạo token truy cập cá nhân, secret của service account và access key trên Localman",
	"scope.tunnelsOpen": "Mở tunnel mới bằng tài khoản của bạn",
	"scope.tunnelsRead": "Xem danh sách tunnel của bạn",
	"scope.chatRead":
		"Xem danh sách cuộc trò chuyện, đọc và tìm tin nhắn trong các cuộc trò chuyện của bạn trên Chat, cùng thông tin người dùng và thành viên",
	"scope.chatWrite":
		"Gửi, sửa, xoá tin nhắn, đánh dấu đã đọc và thả cảm xúc trên Chat với tư cách của bạn",
	"scope.botsRead":
		"Xem bot của bạn trên Chat, cấu hình webhook và tình trạng giao tin (kể cả tin giao lỗi)",
	"scope.botsWrite":
		"Tạo bot, sửa thông tin và lệnh của bot, gửi lại hoặc bỏ các tin giao lỗi trên Chat",
	"scope.botsAdmin":
		"Đặt hoặc gỡ webhook, cấp lại token và xoá bot của bạn trên Chat",
	"scope.scribeRead":
		"Đọc bản ghi và tệp của bạn trên Scribe: bản chép lời, biên bản, bản dịch, người nói và dấu mốc, tìm kiếm và đặt câu hỏi trên chúng (chỉ đọc)",
	"scope.unknown": "Quyền “{scope}”",
	"device.input.title": "Đăng nhập thiết bị",
	"device.input.subtitle":
		"Nhập mã đang hiện trên máy (ví dụ trong cửa sổ dòng lệnh của tunelo).",
	"device.input.label": "Mã thiết bị",
	"device.error.noCode": "Hãy nhập mã đang hiện trên máy của bạn.",
	"device.error.notFound": "Mã không đúng. Kiểm tra lại mã trên máy của bạn.",
	"device.error.expired":
		"Mã đã hết hạn. Chạy lại lệnh đăng nhập trên máy để lấy mã mới.",
	"device.error.used": "Mã này đã được dùng. Chạy lại lệnh đăng nhập trên máy.",
	"device.error.aborted": "Đã từ chối. Máy kia sẽ không được cấp quyền.",
	"device.error.other": "Không xử lý được yêu cầu. Thử lại sau ít phút.",
	"device.confirm.title": "Kiểm tra mã thiết bị",
	"device.confirm.subtitle": "Yêu cầu từ {device}.",
	"device.confirm.help":
		"Chỉ tiếp tục nếu mã trên khớp với mã đang hiện trên máy của bạn.",
	"device.confirm.match": "Mã khớp, tiếp tục",
	"device.onMachine": "{app} trên máy {machine}",
	"device.unknownName": "không rõ tên",
	"device.genericLabel": "thiết bị",
	"device.success.pageTitle": "Đã cho phép thiết bị",
	"device.success.title": "Đã cho phép",
	"device.success.subtitle": "{device} đã đăng nhập vào tài khoản của bạn.",
	"device.success.alert":
		"Quay lại cửa sổ dòng lệnh, máy sẽ tự tiếp tục. Bạn có thể đóng trang này.",
	"device.success.manage": "Quản lý thiết bị ở trang tài khoản",
	"device.approve.title": "Duyệt thiết bị",
	"device.approve.question": "Cho phép {device}?",
	"device.approve.code": "Mã: {code}",
	"device.approve.ip": "yêu cầu từ IP {ip}",
};
