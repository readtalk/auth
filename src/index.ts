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
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url)
    
    // 1. Kalo buka host doang, auto direct ke /password/authorize
    if (url.pathname === "/") {
      url.searchParams.set("redirect_uri", "https://chat.readtalk.workers.dev/callback")
      url.searchParams.set("client_id", "chat-readtalk")
      url.searchParams.set("response_type", "code")
      url.pathname = "/authorize"
      return Response.redirect(url.toString())
    }

    // 2. Callback dummy buat testing
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code")
      return new Response(`Login sukses! Code: ${code}`, {
        headers: { "Content-Type": "text/plain" }
      })
    }

    // 3. OpenAuth core
    return issuer({
      storage: CloudflareStorage({ namespace: env.AUTH_STORAGE }),
      subjects,
      
      // Whitelist client biar redirect_uri diterima
      clients: async (clientID) => {
        if (clientID === "chat-readtalk") {
          return {
            clientID: "chat-readtalk", 
            redirectURIs: ["https://chat.readtalk.workers.dev/callback"],
          }
        }
      },

      providers: {
        password: PasswordProvider({
          // LOGIN: /password/authorize
          login: async (c, formData, error) => {
            return htmlResponse(renderPage('login', formData, error?.message))
          },
          
          // REGISTER: /password/register 
          register: async (c, formData, error) => {
            return htmlResponse(renderPage('register', formData, error?.message))
          },
          
          // KIRIM KODE OTP
          sendCode: async (email, code) => {
            console.log(`[READTalk] OTP ${email}: ${code}`)
          },
          
          // VERIFY KODE: /password/verify
          verify: async (c, formData, error) => {
            return htmlResponse(renderPage('verify', formData, error?.message))
          },
          
          // LUPA PASSWORD: /password/change
          change: async (c, formData, error) => {
            return htmlResponse(renderPage('change', formData, error?.message))
          },
        }),
      },
      
      success: async (ctx, value) => {
        const userId = await getOrCreateUser(env, value.email)
        return ctx.subject("user", { 
          id: userId, 
          email: value.email 
        })
      },
    }).fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>

async function getOrCreateUser(env: Env, email: string): Promise<string> {
  const result = await env.AUTH_DB.prepare(
    `INSERT INTO user (email) VALUES (?) 
     ON CONFLICT (email) DO UPDATE SET email = email 
     RETURNING id;`
  ).bind(email).first<{ id: string }>()
  
  if (!result) throw new Error(`Gagal bikin user: ${email}`)
  return result.id
}

function htmlResponse(html: string) {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

// 1 FUNGSI BUAT SEMUA HALAMAN - ALA WHATSAPP
function renderPage(
  type: 'login' | 'register' | 'verify' | 'change', 
  formData?: FormData, 
  error?: string
) {
  // WAJIB: bawa state OpenAuth biar nggak diem
  const hidden = formData? Array.from(formData.entries())
   .map(([k, v]) => `<input type="hidden" name="${k}" value="${v}"/>`)
   .join('') : ''
  
  const emailValue = formData?.get('email') || ''
  
  const config = {
    login: {
      title: 'Enter your email',
      subtitle: 'READTalk will need to verify your email.',
      label: 'Email address',
      placeholder: 'nama@email.com',
      input: 'email',
      button: 'Next'
    },
    register: {
      title: 'Create your account', 
      subtitle: 'Enter your email to get started with READTalk.',
      label: 'Email address',
      placeholder: 'nama@email.com',
      input: 'email',
      button: 'Next'
    },
    verify: {
      title: 'Verify your email',
      subtitle: 'Enter the 6-digit code we sent to your email',
      label: '',
      placeholder: '------',
      input: 'code',
      button: 'Verify'
    },
    change: {
      title: 'Reset password',
      subtitle: 'Enter your email to receive a reset code.',
      label: 'Email address', 
      placeholder: 'nama@email.com',
      input: 'email',
      button: 'Send Code'
    }
  }[type]

  return `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.title}</title>
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
   .subtitle { text-align: center; font-size: 14px; color: #8e8e93; line-height: 1.4; margin-bottom: 48px; }
   .input-label { font-size: 14px; color: #1c1c1e; margin-bottom: 8px; text-align: center; }
    input {
      width: 100%; border: none; border-bottom: 2px solid #25d366;
      padding: 8px 0; font-size: 17px; outline: none; text-align: center;
    }
    input[name="code"] { font-size: 24px; letter-spacing: 8px; }
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
   .link-row { text-align: center; margin-top: 16px; font-size: 14px; }
   .link-row a { color: #007aff; text-decoration: none; }
  </style>
</head>
<body>
  <div class="header"><div class="dots">⋮</div></div>
  <div class="container">
    <h1>${config.title}</h1>
    <p class="subtitle">${config.subtitle}</p>
    ${error? `<div class="error">${error}</div>` : ''}
    <form method="post" id="authForm">
      ${hidden}
      ${config.label? `<div class="input-label">${config.label}</div>` : ''}
      <input 
        name="${config.input}" 
        type="${config.input === 'email'? 'email' : 'text'}"
        required
        maxlength="${config.input === 'code'? '6' : ''}"
        placeholder="${config.placeholder}"
        value="${config.input === 'email'? emailValue : ''}"
        id="mainInput"
        autocomplete="${config.input === 'email'? 'email' : 'one-time-code'}"
        inputmode="${config.input === 'code'? 'numeric' : 'email'}"
      />
      ${type === 'login'? `<div class="link-row"><a href="/password/register">Create account</a> · <a href="/password/change">Forgot email?</a></div>` : ''}
      ${type === 'register'? `<div class="link-row"><a href="/password/authorize">Already have account?</a></div>` : ''}
      <button type="submit" class="next-btn" id="nextBtn" ${config.input === 'code'? '' : 'disabled'}>${config.button}</button>
    </form>
  </div>
  <script>
    const input = document.getElementById('mainInput');
    const btn = document.getElementById('nextBtn');
    const form = document.getElementById('authForm');
    
    function validate() {
      if (input.name === 'email') {
        return input.value.length > 5 && input.value.includes('@') && input.value.split('@')[1]?.includes('.');
      }
      if (input.name === 'code') {
        return input.value.length === 6;
      }
      return true;
    }
    
    function updateButton() {
      const valid = validate();
      btn.classList.toggle('active', valid);
      if (input.name === 'email') btn.disabled =!valid;
    }
    
    input.addEventListener('input', updateButton);
    input.addEventListener('paste', () => setTimeout(updateButton, 0));
    form.addEventListener('submit', (e) => { if (!validate()) e.preventDefault(); });
    
    updateButton();
    input.focus();
  </script>
</body>
</html>`
}
