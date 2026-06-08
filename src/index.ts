import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";
import { Resend } from "resend";

const subjects = createSubjects({
  user: object({ 
    id: string(),
    email: string(),
  }),
});

interface Env {
  AUTH_DB: D1Database;
  AUTH_STORAGE: KVNamespace;
  RESEND_API_KEY: string;
}

async function getOrCreateUser(env: Env, email: string) {
  const result = await env.AUTH_DB.prepare(
    `INSERT INTO user (email) VALUES (?) 
     ON CONFLICT (email) DO UPDATE SET email = email 
     RETURNING id, email`
  ).bind(email).first<{ id: string; email: string }>();
  
  if (!result) throw new Error("Failed to create user");
  return result;
}

export default issuer({
  storage: CloudflareStorage({
    namespace: env.AUTH_STORAGE,
  }),
  subjects,
  providers: {
    password: PasswordProvider(
      PasswordUI({
        sendCode: async (email, code) => {
          // WAJIB ganti. Jangan console.log di prod
          const resend = new Resend(env.RESEND_API_KEY);
          await resend.emails.send({
            from: "READTalk <auth@readtalk.dev>",
            to: email,
            subject: "READTalk Login Code",
            html: `<p>Kode login lu: <strong>${code}</strong></p>`,
          });
        },
      }),
    ),
  },
  theme: {
    title: "READTalk",
    primary: "#FF0000",
    logo: {
      dark: "https://readtalk.vercel.app/brand-assets.png",
      light: "https://readtalk.vercel.app/brand-assets.png",
    },
  },  
  success: async (ctx, value) => {
    const user = await getOrCreateUser(ctx.env, value.email);
    return ctx.subject("user", {
      id: user.id,
      email: user.email,
    });
  },
});
