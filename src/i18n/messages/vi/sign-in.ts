import type { enSignIn } from "../en/sign-in.js";
import type { Translation } from "../translation.js";

export const viSignIn: Translation<typeof enSignIn> = {
	"login.title": "Đăng nhập",
	"login.titleForApp": "Đăng nhập để tiếp tục tới {app}",
	"login.tagline": "Một tài khoản {brand} cho mọi ứng dụng.",
	"login.forDevice": "Đăng nhập để duyệt thiết bị.",
	"login.continueTo": "Để tiếp tục tới {app}.",
	"login.with": "Đăng nhập với {provider}",
	"login.noProvider":
		"Đăng nhập bằng Google, GitHub và Apple đang tạm tắt, nên chưa đăng nhập hay đăng ký được. Thử lại sau.",
	"login.firstTime":
		"Lần đầu đăng nhập bằng một trong các cách trên sẽ tạo tài khoản {brand} mới.",
	"login.cancel": "Huỷ đăng nhập",
	"signup.title": "Tạo tài khoản {brand}",
	"signup.pageTitle": "Đăng ký",
	"signup.subtitle":
		"Dùng chung cho mọi ứng dụng của {brandDomain}. Đăng ký bằng một trong các tài khoản dưới đây; {brand} không dùng mật khẩu và không gửi email.",
	"signup.with": "Đăng ký với {provider}",
	"signup.haveAccount": "Đã có tài khoản? {link}",
	"username.title": "Chọn username",
	"username.subtitle":
		"Tạo tài khoản {brand} bằng {provider} cho {email} (đã xác minh).",
	"username.reclaimWarning":
		"Email này đang gắn với một tài khoản {brand} khác nhưng chưa ai xác minh. Nếu đó là tài khoản của bạn và nó đã liên kết Google, GitHub hoặc Apple khác, hãy {link} rồi liên kết {provider} ở trang tài khoản. Nếu tiếp tục, email chuyển sang tài khoản mới; tài khoản kia giữ các cách đăng nhập khác của nó.",
	"username.existingAccount":
		"Đã có tài khoản {brand}? Đừng tạo tài khoản mới: hãy {link} (Google, GitHub hoặc Apple bạn đã dùng) rồi liên kết {provider} ở trang tài khoản. Với Apple, chọn ẩn email sẽ luôn ra địa chỉ mới nên không tự nhận ra tài khoản cũ.",
	"username.reclaimLink": "đăng nhập bằng cách đó",
	"username.label": "Username",
	"username.help":
		"3–30 ký tự: chữ thường, số và dấu gạch dưới. Người khác mời bạn bằng username này.",
	"username.submit": "Tạo tài khoản",
	"username.back": "Quay lại đăng nhập",
	"username.taken": "Username này đã có người dùng. Chọn username khác.",
	"username.invalid":
		"Username cần 3–30 ký tự gồm chữ thường, số hoặc dấu gạch dưới.",
	"username.emailTaken":
		"Email này vừa được dùng cho một tài khoản khác. Hãy đăng nhập bằng tài khoản đó.",
	"upstream.expired":
		"Phiên đăng nhập bằng {provider} đã hết hạn. Thử lại từ đầu.",
	"upstream.failed":
		"Không đăng nhập được bằng {provider}. Thử lại sau ít phút.",
	"upstream.link.ownedByOther":
		"Tài khoản {provider} này đã liên kết với một tài khoản {brand} khác.",
	"upstream.link.alreadyLinked":
		"Tài khoản đã liên kết một tài khoản {provider} khác. Huỷ liên kết đó trước.",
	"upstream.rejected.noVerifiedEmail":
		"Tài khoản này chưa có email đã xác minh, nên không dùng để đăng nhập {brand} được.",
	"upstream.rejected.disabled": "Tài khoản {brand} này đã bị khoá.",
	"upstream.rejected.otherProviderAccount":
		"Email này thuộc một tài khoản {brand} đã liên kết với tài khoản khác của cùng nhà cung cấp. Đăng nhập bằng tài khoản đã liên kết đó.",
	"upstream.rejected.other": "Không đăng nhập được.",
	"logout.title": "Đăng xuất",
	"logout.byApp": "{app} muốn đăng xuất bạn khỏi tài khoản {brand}.",
	"logout.question": "Đăng xuất khỏi tài khoản {brand} trên trình duyệt này?",
	"logout.confirm": "Đăng xuất",
	"logout.keep": "Không, giữ đăng nhập",
	"logout.help":
		"Đăng xuất ở đây cũng đăng xuất các ứng dụng web của {brandDomain} trên trình duyệt này. Thiết bị (CLI, ứng dụng trên điện thoại) vẫn giữ đăng nhập.",
	"logout.doneTitle": "Đã đăng xuất",
	"logout.done":
		"Bạn đã đăng xuất khỏi tài khoản {brand} trên trình duyệt này.",
	"logout.signInAgain": "Đăng nhập lại",
	"review.link": "Tài khoản dành cho người duyệt ứng dụng",
	"review.title": "Đăng nhập cho người duyệt ứng dụng",
	"review.subtitle":
		"Chỉ dành cho người duyệt của kho ứng dụng, với tài khoản demo trong ghi chú duyệt.",
	"review.email": "Email",
	"review.password": "Mật khẩu",
	"review.submit": "Đăng nhập",
	"review.failed": "Email hoặc mật khẩu không đúng.",
};
