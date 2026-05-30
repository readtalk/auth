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
              input_code: "Verification Code",
            },
          }),
        ),
      },

      theme: {
        title: "READTalk Authentication",
        primary: "#ff0000",
        favicon: "https://readtalk.pages.dev/vite.svg",
        logo: {
          dark: "https://readtalk.pages.dev/vite.svg",
          light: "https://readtalk.pages.dev/vite.svg",
        },
      },

      success: async (ctx, value) => {
        const userID = await getOrCreateUser(env, value.email);

        return ctx.subject("user", {
          id: userID,
        });
      },
    }).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

async function getOrCreateUser(
  env: Env,
  email: string,
): Promise<string> {
  const result = await env.AUTH_DB.prepare(`
      INSERT INTO user (email)
      VALUES (?)
      ON CONFLICT (email) DO UPDATE SET email = email
      RETURNING id;
    `)
    .bind(email)
    .first<{ id: string }>();

  if (!result) {
    throw new Error(`Unable to process user: ${email}`);
  }

  console.log(
    `Found or created user ${result.id} with email ${email}`,
  );

  return result.id;
}
