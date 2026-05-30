import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";

const subjects = createSubjects({
  user: object({ id: string() }),
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return issuer({
      storage: CloudflareStorage({
        namespace: env.AUTH_STORAGE,
      }),

      subjects,

      providers: {
        password: PasswordProvider(
          PasswordUI({
            sendCode: async (email, code) => {
              console.log(email, code);
            },
          })
        ),
      },

      success: async (ctx, value) => {
        const userId = await getOrCreateUser(env, value.email);

        // 🔥 langsung return subject (JWT issued internally oleh OpenAuth)
        return ctx.subject("user", {
          id: userId,
        });
      },
    }).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

async function getOrCreateUser(env: Env, email: string) {
  const res = await env.AUTH_DB.prepare(
    `INSERT INTO user (email)
     VALUES (?)
     ON CONFLICT(email) DO UPDATE SET email=email
     RETURNING id`
  )
    .bind(email)
    .first<{ id: string }>();

  return res!.id;
}
