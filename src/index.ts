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
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		
		// Redirect root ke authorize (demo purpose)
		if (url.pathname === "/") {
			url.searchParams.set("redirect_uri", url.origin + "/callback");
			url.searchParams.set("client_id", "readtalk");
			url.searchParams.set("response_type", "code");
			url.pathname = "/authorize";
			return Response.redirect(url.toString());
		}
		
		// ❌ BLOK /callback DIHAPUS (biar redirect ke aplikasi kita)

		return issuer({
			storage: CloudflareStorage({
				namespace: env.AUTH_STORAGE,
			}),
			subjects,
			clients: {
				"readtalk": {
					redirect_uris: [
						"https://read.readtalk.workers.dev/callback",
						"http://localhost:5173/callback"
					]
				}
			},
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
				title: "Authentication",
				primary: "#FF0000",
				favicon: "https://raw.githubusercontent.com/readtalk/auth/refs/heads/main/public/favicon.ico",
				logo: {
					dark: "https://raw.githubusercontent.com/readtalk/auth/refs/heads/main/public/logo.svg",
					light: "https://raw.githubusercontent.com/readtalk/auth/refs/heads/main/public/logo.svg",
				},
			},
			success: async (ctx, value) => {
				return ctx.subject("user", {
					id: await getOrCreateUser(env, value.email),
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
		`,
	)
		.bind(email)
		.first<{ id: string }>();
	if (!result) {
		throw new Error(`Unable to process user: ${email}`);
	}
	console.log(`Found or created user ${result.id} with email ${email}`);
	return result.id;
}
