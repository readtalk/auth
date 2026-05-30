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

		// simple dev router (optional but safe)
		if (url.pathname === "/") {
			url.searchParams.set("redirect_uri", url.origin + "/callback");
			url.searchParams.set("client_id", "your-client-id");
			url.searchParams.set("response_type", "code");
			url.pathname = "/authorize";
			return Response.redirect(url.toString());
		}

		if (url.pathname === "/callback") {
			return Response.json({
				message: "OAuth flow complete!",
				params: Object.fromEntries(url.searchParams.entries()),
			});
		}

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
					})
				),
			},
			theme: {
				title: "Authentication",
				primary: "#FF0000",
				favicon: "https://readtalk.pages.dev/vite.svg",
				logo: {
					dark: "https://readtalk.pages.dev/vite.svg",
					light:
						"https://readtalk.pages.dev/vite.svg",
				},
			},
			success: async (ctx, value) => {
				const id = await getOrCreateUser(env, value.email);

				return ctx.subject("user", {
					id,
				});
			},
		}).fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;

async function getOrCreateUser(env: Env, email: string): Promise<string> {
	const result = await env.AUTH_DB.prepare(
		`
		INSERT INTO user (email)
		VALUES (?)
		ON CONFLICT (email) DO UPDATE SET email = email
		RETURNING id;
		`
	)
		.bind(email)
		.first<{ id: string }>();

	if (!result?.id) {
		throw new Error(`Unable to process user: ${email}`);
	}

	console.log(`User ready: ${result.id}`);

	return result.id;
}
