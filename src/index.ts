import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";

const subjects = createSubjects({
	user: object({
		id: string(),
	}),
});

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		// =========================
		// 1. API ROUTES (CUSTOM API)
		// =========================
		if (url.pathname.startsWith("/api/")) {
			return handleAPI(request, env);
		}

		// =========================
		// 2. AUTH ROUTES (OPENAUTH)
		// =========================
		if (url.pathname.startsWith("/auth")) {
			return issuer({
				storage: CloudflareStorage({
					namespace: env.AUTH_STORAGE,
				}),
				subjects,
				providers: {
					password: PasswordProvider(
						PasswordUI({
							sendCode: async (email, code) => {
								console.log(`Sending code ${code} to ${email}`);
							},
							copy: {
								input_code: "Code (check Worker logs)",
							},
						}),
					),
				},
				theme: {
					title: "myAuth",
					primary: "#0051c3",
					favicon: "https://workers.cloudflare.com//favicon.ico",
					logo: {
						dark: "https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/db1e5c92-d3a6-4ea9-3e72-155844211f00/public",
						light: "https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/fa5a3023-7da9-466b-98a7-4ce01ee6c700/public",
					},
				},
				success: async (ctx, value) => {
					return ctx.subject("user", {
						id: await getOrCreateUser(env, value.email),
					});
				},
			}).fetch(request, env, ctx);
		}

		// =========================
		// 3. DEFAULT
		// =========================
		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
