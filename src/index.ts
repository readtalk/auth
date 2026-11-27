import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";
import { Hono } from "hono";
import { cors } from "hono/cors";

const subjects = createSubjects({
  user: object({
    id: string(),
    email: string(),
  }),
});

const app = new Hono();
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-User-Id', 'X-Session-Id', 'X-Chat-Id'],
}));

// --- persis kayak global: GET /settings ---
app.get('/settings', async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
  const token = authHeader.replace("Bearer ", "");
  try {
    const payloadBase64 = token.split(".")[1];
    const payload = JSON.parse(atob(payloadBase64));
    const userId = payload.properties?.id || payload.sub;
    if (!userId) return c.json({ success: false, error: "Invalid token" }, 401);

    const user = await c.env.USER_DB.prepare(
      `SELECT * FROM user WHERE id = ?`
    ).bind(userId).first();

    if (!user) return c.json({ success: false, error: "User not found" }, 404);
    return c.json({ success: true, user });
  } catch (error) {
    console.error("Settings fetch error:", error);
    return c.json({ success: false, error: "Failed to fetch settings" }, 500);
  }
});

// --- persis kayak global: POST /settings ---
app.post('/settings', async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
  const token = authHeader.replace("Bearer ", "");
  try {
    const payloadBase64 = token.split(".")[1];
    const payload = JSON.parse(atob(payloadBase64));
    const userId = payload.properties?.id || payload.sub;
    if (!userId) return c.json({ success: false, error: "Invalid token" }, 401);

    const { username, yourname, date_of_birth, avatar, header, headline, about, socials, location } = await c.req.json();

    if (!username || !yourname || !date_of_birth) {
      return c.json({ success: false, error: "Username, yourname, and date_of_birth are required" }, 400);
    }
    const usernameRegex = /^[A-Za-z0-9_]{1,14}$/;
    if (!usernameRegex.test(username)) {
      return c.json({ success: false, error: "Username must be 1-14 characters, only A-Z, 0-9, and underscore" }, 400);
    }

    const currentUser = await c.env.USER_DB.prepare(
      `SELECT username FROM user WHERE id = ?`
    ).bind(userId).first();

    const isUsernameChanged = currentUser && currentUser.username !== username;

    await c.env.USER_DB.prepare(
      `UPDATE user SET username = ?, yourname = ?, date_of_birth = ?, avatar = ?, header = ?, headline = ?, about = ?, socials = ?, location = ?, username_updated_at = CASE WHEN ? = 1 THEN unixepoch() ELSE username_updated_at END WHERE id = ?`
    ).bind(
      username, yourname, date_of_birth,
      avatar || null, header || null, headline || null, about || null, socials || null, location || null,
      isUsernameChanged ? 1 : 0,
      userId
    ).run();

    return c.json({ success: true });
  } catch (error) {
    console.error("Settings update error:", error);
    return c.json({ success: false, error: "Failed to update settings" }, 500);
  }
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id, X-Session-Id, X-Chat-Id',
        }
      });
    }

    // --- persis kayak global: /settings dilempar ke Hono ---
    if (url.pathname === '/settings') {
      return app.fetch(request, env, ctx);
    }

    if (url.pathname === "/") {
      url.searchParams.set("redirect_uri", url.origin + "/callback");
      url.searchParams.set("client_id", "your-client-id");
      url.searchParams.set("response_type", "code");
      url.pathname = "/authorize";
      return Response.redirect(url.toString());
    } else if (url.pathname === "/callback") {
      return Response.json({
        message: "OAuth flow complete!",
        params: Object.fromEntries(url.searchParams.entries()),
      });
    }

    return issuer({
      storage: CloudflareStorage({ namespace: env.USER_KV }),
      subjects,
      providers: {
        password: PasswordProvider(
          PasswordUI({
            sendCode: async (email, code) => {
              console.log(`Sending code ${code} to ${email}`);
            },
            copy: { input_code: "Code (check Worker logs)" },
          }),
        ),
      },
      theme: {
        title: "Auth",
        primary: "#000000",
        favicon: "https://raw.githubusercontent.com/readtalk/auth/refs/heads/main/public/favicon.ico",
        logo: {
          dark: "https://raw.githubusercontent.com/readtalk/auth/refs/heads/main/public/logo.svg",
          light: "https://raw.githubusercontent.com/readtalk/auth/refs/heads/main/public/logo.svg",
        },
      },
      success: async (ctx, value) => {
        return ctx.subject("user", {
          id: await getOrCreateUser(env, value.email),
          email: value.email,
        });
      },
    }).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

async function getOrCreateUser(env: Env, email: string): Promise<string> {
  const result = await env.USER_DB.prepare(
    `INSERT INTO user (email) VALUES (?) ON CONFLICT (email) DO UPDATE SET email = email RETURNING id;`
  ).bind(email).first<{ id: string }>();
  if (!result) throw new Error(`Unable to process user: ${email}`);
  return result.id;
}
