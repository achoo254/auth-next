import type { enCommon } from "../en/common.js";
import type { Translation } from "../translation.js";

export const viCommon: Translation<typeof enCommon> = {
	"common.unknown": "không rõ",
	"common.back": "Quay lại",
	"common.backToAccount": "Về trang tài khoản",
	"common.cancel": "Huỷ",
	"common.continue": "Tiếp tục",
	"common.tryAgain": "Thử lại",
	"common.signedInAs": "Đang đăng nhập là {username}.",
	"common.tooManyRequests": "Quá nhiều yêu cầu. Thử lại sau ít phút.",
	"layout.brand": "Tài khoản",
	"layout.description":
		"Đăng nhập vào tài khoản và quản lý các ứng dụng, thiết bị đã kết nối với tài khoản.",
	"layout.language": "Ngôn ngữ",
	"layout.nav": "Điều hướng",
	"layout.ecosystem": "Một app của {brandDomain}",
	"layout.home": "Trang chủ",
	"client.external": "Ứng dụng bên ngoài",
	"client.quoted": "“{name}”",
	"client.externalNamed": "{name} (ứng dụng bên ngoài)",
	"error.title": "Không thể tiếp tục",
	"error.code": "Mã lỗi: {code}",
	"error.unsupportedStep": "Bước đăng nhập này chưa được hỗ trợ.",
	"error.interactionExpired":
		"Phiên đăng nhập đã hết hạn hoặc không còn hợp lệ. Quay lại ứng dụng và đăng nhập lại.",
	"error.otherInteraction":
		"Trang này thuộc về một phiên đăng nhập khác. Quay lại ứng dụng và đăng nhập lại.",
	"error.formExpired": "Biểu mẫu đã hết hạn. Tải lại trang rồi thử lại.",
	"error.consentMissing":
		"Không tìm thấy tài khoản hoặc ứng dụng của phiên này. Quay lại ứng dụng và đăng nhập lại.",
	"providerError.invalidRequest":
		"Yêu cầu đăng nhập không hợp lệ hoặc đã hết hạn. Quay lại ứng dụng và thử lại.",
	"providerError.invalidClient": "Ứng dụng yêu cầu đăng nhập không hợp lệ.",
	"providerError.invalidRedirectUri":
		"Địa chỉ quay về của ứng dụng không hợp lệ.",
	"providerError.unauthorizedClient":
		"Ứng dụng không được phép dùng cách đăng nhập này.",
	"providerError.accessDenied": "Yêu cầu đã bị từ chối.",
	"providerError.invalidScope": "Ứng dụng xin quyền không được hỗ trợ.",
	"providerError.invalidTarget":
		"Ứng dụng xin quyền cho một dịch vụ không được phép.",
	"providerError.loginRequired": "Bạn cần đăng nhập để tiếp tục.",
	"providerError.serverError": "Có lỗi phía máy chủ. Thử lại sau ít phút.",
	"providerError.unknown": "Không xử lý được yêu cầu. Thử lại sau ít phút.",
};
