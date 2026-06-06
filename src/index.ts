import { issuer } from "@openauthjs/openauth"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import { PasswordProvider } from "@openauthjs/openauth/provider/password"
import { createSubjects } from "@openauthjs/openauth/subject"
import { object, string } from "valibot"

const subjects = createSubjects({
  user: object({ 
    id: string(),
    email: string() 
  }),
})

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url)
    
    // PUNYA LU - JANGAN DIUBAH
    if (url.pathname === "/") {
      url.searchParams.set("redirect_uri", url.origin + "/callback")
      url.searchParams.set("client_id", "your-client-id")
      url.searchParams.set("response_type", "code")
      url.pathname = "/authorize"
      return Response.redirect(url.toString())
    } else if (url.pathname === "/callback") {
      return Response.json({ 
        message: "OAuth flow complete!", 
        params: Object.fromEntries(url.searchParams.entries()), 
      })
    }
    
    // OPENAUTH - CUMA GANTI BAGIAN PasswordUI
    return issuer({
      storage: CloudflareStorage({ namespace: env.AUTH_STORAGE }),
      subjects,
      providers: {
        password: PasswordProvider({
          // HAPUS PasswordUI, GANTI INI
          login: async (c, formData, error) => {
            return htmlResponse(renderLogin(formData, error?.message))
          },
          sendCode: async (email, code) => {
            console.log(`Sending code ${code} to ${email}`)
          },
          verify: async (c, formData, error) => {
            return htmlResponse(renderVerify(formData, error?.message))
          },
        }),
      },
      // theme lu hapus aja, udah nggak kepake
      success: async (ctx, value) => {
        return ctx.subject("user", { 
          id: await getOrCreateUser(env, value.email),
          email: value.email 
        })
      },
    }).fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>

async function getOrCreateUser(env: Env, email: string): Promise<string> {
  const result = await env.AUTH_DB.prepare(
    `INSERT INTO user (email) VALUES (?) ON CONFLICT (email) DO UPDATE SET email = email RETURNING id;`
  ).bind(email).first<{ id: string }>()
  if (!result) throw new Error(`Unable to process user: ${email}`)
  return result.id
}

function htmlResponse(html: string) {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

// UI BARU - ALA WA TAPI EMAIL ONLY
function renderLogin(formData?: FormData, error?: string) {
  const hidden = formData? Array.from(formData.entries())
   .map(([k, v]) => `<input type="hidden" name="${k}" value="${v}"/>`)
   .join('') : ''
  
  const emailValue = formData?.get('email') || ''

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enter your email</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #fff; color: #1c1c1e; min-height: 100vh; display: flex; flex-direction: column;
    }
   .header { padding: 16px; display: flex; justify-content: flex-end; }
   .dots { font-size: 24px; color: #8e8e93; }
   .container { flex: 1; padding: 0 32px; max-width: 400px; margin: 0 auto; width: 100%; }
    h1 { font-size: 24px; font-weight: 400; text-align: center; margin-top: 40px; margin-bottom: 12px; }
   .subtitle { text-align: center; font-size: 14px; color: #8e8e93; margin-bottom: 48px; }
   .input-label { font-size: 14px; color: #1c1c1e; margin-bottom: 8px; text-align: center; }
    input[type="email"] {
      width: 100%; border: none; border-bottom: 2px solid #25d366;
      padding: 8px 0; font-size: 17px; outline: none; text-align: center;
    }
   .error {
      background: #ff3b30; color: white; padding: 12px; border-radius: 8px;
      font-size: 14px; margin-bottom: 24px; text-align: center;
    }
   .next-btn {
      position: fixed; bottom: 32px; left: 32px; right: 32px; max-width: 336px;
      margin: 0 auto; background: #e5e5ea; color: #8e8e93; border: none;
      border-radius: 24px; padding: 14px; font-size: 17px; font-weight: 500;
      transition: all 0.2s;
    }
   .next-btn.active { background: #25d366; color: white; }
  </style>
</head>
<body>
  <div class="header"><div class="dots">⋮</div></div>
  <div class="container">
    <h1>Enter your email</h1>
    <p class="subtitle">READTalk will need to verify your email.</p>
    ${error? `<div class="error">${error}</div>` : ''}
    <form method="post">
      ${hidden}
      <div class="input-label">Email address</div>
      <input 
        name="email" type="email" required
        placeholder="nama@email.com"
        value="${emailValue}"
        id="emailInput" autocomplete="email"
      />
      <button type="submit" class="next-btn" id="nextBtn" disabled>Next</button>
    </form>
  </div>
  <script>
    const input = document.getElementById('emailInput');
    const btn = document.getElementById('nextBtn');
    function validate() {
      return input.value.length > 5 && input.value.includes('@') && input.value.includes('.');
    }
    function updateButton() {
      const valid = validate();
      btn.classList.toggle('active', valid);
      btn.disabled =!valid;
    }
    input.addEventListener('input', updateButton);
    updateButton();
    input.focus();
  </script>
</body>
</html>`
}

function renderVerify(formData?: FormData, error?: string) {
  const hidden = formData? Array.from(formData.entries())
   .map(([k, v]) => `<input type="hidden" name="${k}" value="${v}"/>`)
   .join('') : ''

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your email</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #fff; color: #1c1c1e; min-height: 100vh;
    }
   .container { padding: 60px 32px 0; max-width: 400px; margin: 0 auto; }
    h1 { font-size: 24px; font-weight: 400; text-align: center; margin-bottom: 12px; }
   .subtitle { text-align: center; font-size: 14px; color: #8e8e93; margin-bottom: 48px; }
    input[type="text"] {
      width: 100%; border: none; border-bottom: 2px solid #25d366;
      padding: 8px 0; font-size: 24px; outline: none; text-align: center; letter-spacing: 8px;
    }
   .error {
      background: #ff3b30; color: white; padding: 12px; border-radius: 8px;
      font-size: 14px; margin-bottom: 24px; text-align: center;
    }
   .next-btn {
      position: fixed; bottom: 32px; left: 32px; right: 32px; max-width: 336px;
      margin: 0 auto; background: #25d366; color: white; border: none;
      border-radius: 24px; padding: 14px; font-size: 17px; font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Verify your email</h1>
    <p class="subtitle">Enter the 6-digit code we sent to your email</p>
    ${error? `<div class="error">${error}</div>` : ''}
    <form method="post">
      ${hidden}
      <input 
        name="code" type="text" required maxlength="6"
        placeholder="------" autocomplete="one-time-code" inputmode="numeric"
      />
      <button type="submit" class="next-btn">Verify</button>
    </form>
  </div>
</body>
</html>`
}
