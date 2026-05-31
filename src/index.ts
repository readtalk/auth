Oh jadi ada kekurangan di sini?????

/**
 * READTalk - OpenAuth Worker
 * 
 * Authentication server using OpenAuth.js
 * Handles user registration, login, and token verification
 *
 * @license MIT
 */

import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";

// ==================== TYPES ====================

interface Env {
	AUTH_STORAGE: KVNamespace;
	AUTH_DB: D1Database;
}

// ==================== SUBJECTS ====================

const subjects = createSubjects({
	user: object({
		id: string(),
		email: string(),
	}),
});

// ==================== MAIN WORKER ====================

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// ==================== HEALTH CHECK ====================
		if (url.pathname === "/health") {
			return new Response(JSON.stringify({ 
				status: "ok", 
				timestamp: new Date().toISOString(),
				services: {
					kv: !!env.AUTH_STORAGE,
					d1: !!env.AUTH_DB
				}
			}), {
				headers: { "Content-Type": "application/json" }
			});
		}

		// ==================== TOKEN VERIFICATION ENDPOINT ====================
		if (url.pathname === "/verify") {
			return handleVerify(request, env);
		}

		// ==================== USER INFO ENDPOINT ====================
		if (url.pathname === "/me") {
			return handleMe(request, env);
		}

		// ==================== DEMO REDIRECT (OPTIONAL) ====================
		if (url.pathname === "/") {
			const redirectUrl = new URL(url);
			redirectUrl.pathname = "/authorize";
			redirectUrl.searchParams.set("redirect_uri", url.origin + "/callback");
			redirectUrl.searchParams.set("client_id", "readtalk");
			redirectUrl.searchParams.set("response_type", "code");
			return Response.redirect(redirectUrl.toString());
		}

		if (url.pathname === "/callback") {
			return Response.json({
				message: "OAuth flow complete!",
				params: Object.fromEntries(url.searchParams.entries()),
			});
		}

		// ==================== OPEN AUTH SERVER ====================
		return issuer({
			storage: CloudflareStorage({
				namespace: env.AUTH_STORAGE,
			}),
			subjects,
			// ==================== ✅ CLIENTS REGISTRATION ====================
			clients: {
				"readtalk": {
					redirect_uris: [
						"https://readtalk.pages.dev/callback",
						// Untuk development lokal (opsional)
						"http://localhost:5173/callback"
					]
				}
			},
			// ==================== PROVIDERS ====================
			providers: {
				password: PasswordProvider(
					PasswordUI({
						sendCode: async (email, code) => {
							// TODO: Implement email sending via Resend or other service
							console.log(`📧 Verification code for ${email}: ${code}`);
							
							// For production, uncomment and configure Resend:
							// await fetch('https://api.resend.com/emails', {
							//   method: 'POST',
							//   headers: {
							//     'Authorization': `Bearer ${env.RESEND_API_KEY}`,
							//     'Content-Type': 'application/json'
							//   },
							//   body: JSON.stringify({
							//     from: 'noreply@readtalk.com',
							//     to: email,
							//     subject: 'Your READTalk Verification Code',
							//     html: `<p>Your verification code is: <strong>${code}</strong></p>`
							//   })
							// });
						},
						copy: {
							title: "READTalk Authentication",
							button_text: "Continue",
							input_code: "Verification code",
							input_email: "Email address",
						},
					}),
				),
			},
			theme: {
				title: "READTalk - Authentication",
				primary: "#000000",
				favicon: "https://readtalk.pages.dev/favicon.ico",
				logo: {
					dark: "https://readtalk.pages.dev/vite.svg",
					light: "https://readtalk.pages.dev/vite.svg",
				},
			},
			success: async (ctx, value) => {
				// Create or get user from database
				const userId = await getOrCreateUser(env, value.email);
				return ctx.subject("user", {
					id: userId,
					email: value.email,
				});
			},
		}).fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;

// ==================== HANDLERS ====================

/**
 * Verify JWT token and return user info
 * Called by Pages Functions via Service Binding
 */
async function handleVerify(request: Request, env: Env): Promise<Response> {
	try {
		const authHeader = request.headers.get("Authorization");
		const token = authHeader?.split(" ")[1];
		
		if (!token) {
			return new Response(JSON.stringify({ 
				valid: false, 
				error: "No token provided" 
			}), { 
				status: 401,
				headers: { "Content-Type": "application/json" }
			});
		}
		
		// Check if token exists in KV storage
		const sessionData = await env.AUTH_STORAGE.get(token);
		
		if (!sessionData) {
			return new Response(JSON.stringify({ 
				valid: false, 
				error: "Invalid or expired token" 
			}), { 
				status: 401,
				headers: { "Content-Type": "application/json" }
			});
		}
		
		// Parse session data (OpenAuth stores session info)
		let session;
		try {
			session = JSON.parse(sessionData);
		} catch {
			session = { userId: sessionData };
		}
		
		return new Response(JSON.stringify({ 
			valid: true,
			userId: session.userId || session.sub,
			email: session.email,
			token: token
		}), {
			headers: { "Content-Type": "application/json" }
		});
		
	} catch (error) {
		console.error("Verify error:", error);
		return new Response(JSON.stringify({ 
			valid: false, 
			error: "Verification failed" 
		}), { 
			status: 500,
			headers: { "Content-Type": "application/json" }
		});
	}
}

/**
 * Get current user info from token
 */
async function handleMe(request: Request, env: Env): Promise<Response> {
	try {
		const authHeader = request.headers.get("Authorization");
		const token = authHeader?.split(" ")[1];
		
		if (!token) {
			return new Response(JSON.stringify({ error: "No token" }), { 
				status: 401,
				headers: { "Content-Type": "application/json" }
			});
		}
		
		const sessionData = await env.AUTH_STORAGE.get(token);
		if (!sessionData) {
			return new Response(JSON.stringify({ error: "Invalid token" }), { 
				status: 401,
				headers: { "Content-Type": "application/json" }
			});
		}
		
		let session;
		try {
			session = JSON.parse(sessionData);
		} catch {
			session = { userId: sessionData };
		}
		
		// Get full user data from D1
		const user = await env.AUTH_DB.prepare(
			"SELECT id, email, created_at FROM user WHERE id = ?"
		).bind(session.userId || session.sub).first();
		
		return new Response(JSON.stringify({ user }), {
			headers: { "Content-Type": "application/json" }
		});
		
	} catch (error) {
		console.error("Me error:", error);
		return new Response(JSON.stringify({ error: "Internal error" }), { 
			status: 500,
			headers: { "Content-Type": "application/json" }
		});
	}
}

// ==================== DATABASE HELPERS ====================

/**
 * Get or create user by email
 */
async function getOrCreateUser(env: Env, email: string): Promise<string> {
	try {
		// Check if user exists
		const existing = await env.AUTH_DB.prepare(
			"SELECT id FROM user WHERE email = ?"
		).bind(email).first<{ id: string }>();
		
		if (existing) {
			console.log(`✅ User exists: ${existing.id} (${email})`);
			return existing.id;
		}
		
		// Create new user
		const result = await env.AUTH_DB.prepare(
			"INSERT INTO user (email) VALUES (?) RETURNING id"
		).bind(email).first<{ id: string }>();
		
		if (!result) {
			throw new Error("Failed to create user");
		}
		
		console.log(`🆕 New user created: ${result.id} (${email})`);
		return result.id;
		
	} catch (error) {
		console.error("Database error:", error);
		throw new Error(`Unable to process user: ${email}`);
	}
}
