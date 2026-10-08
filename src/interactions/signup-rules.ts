import { passwordProblem } from "../accounts/password-hasher.js";
import { isValidEmail, isValidUsername } from "../accounts/user-model.js";

/**
 * Which field is taken. Sign-up cannot hide that an email is in use (there
 * is no mail to confirm with), so it says which field to change; login and
 * password reset still never reveal whether an account exists.
 */
export const SIGNUP_TAKEN_MESSAGES: Readonly<Record<string, string>> = {
	email:
		"Email này đã có tài khoản. Hãy đăng nhập, hoặc dùng “Quên mật khẩu” nếu cần.",
	username: "Username này đã có người dùng. Chọn username khác.",
};

export const PENDING_SIGNUP_SECONDS = 30 * 60;

export function validationProblem(
	email: string,
	username: string,
	password: string,
	confirm: string,
): string | undefined {
	if (!isValidEmail(email)) return "Email không hợp lệ.";
	if (!isValidUsername(username)) {
		return "Username cần 3–30 ký tự gồm chữ thường, số hoặc dấu gạch dưới.";
	}
	return (
		passwordProblem(password) ??
		(password === confirm ? undefined : "Hai mật khẩu không khớp nhau.")
	);
}
