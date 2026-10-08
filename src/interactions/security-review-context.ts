import type { Request, Response } from "express";
import type { AccountDocument } from "../accounts/user-model.js";

export const REVIEW_EXPIRED_MESSAGE =
	"Tài khoản vừa thay đổi trong lúc rà soát nên phiên rà soát này đã hết hạn. Hãy đăng nhập lại bằng mật khẩu mới để rà soát tiếp.";

/** Who is reviewing, where the page lives, and what its forms are bound to. */
export interface ReviewContext {
	readonly account: AccountDocument;
	/** URL of the review page; actions are under it. */
	readonly base: string;
	/** CSRF scope of the review's forms. */
	readonly csrfScope: string;
	/** Security version the review's token was checked at (for guarded writes). */
	readonly version: number;
	/** The review token's own fields (parked sign-in methods, interaction uid). */
	readonly data: Readonly<Record<string, string>>;
	/**
	 * Re-stamps this review's own token with the version its own write just
	 * produced; if anything else changed the account too, the token dies.
	 */
	renew(producedVersion: number): Promise<boolean>;
	/** The reviewer's own IdP session, kept when the review signs everything else out. */
	readonly keepSessionUid?: string;
	/** Uses up this review's token. */
	consume(): Promise<void>;
}

export type LoadReview = (
	req: Request,
	res: Response,
) => Promise<ReviewContext | undefined>;
