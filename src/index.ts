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
    return issuer({
      storage: CloudflareStorage({ namespace: env.AUTH_STORAGE }),
      subjects,
      providers: {
        password: PasswordProvider({
          // 1. Halaman input email
          login: async (c, form, error) => {
            return htmlResponse(loginPage(error?.message))
          },
          
          // 2. Kirim kode OTP
          sendCode: async (email, code) => {
            console.log(`[DEV] Kode buat ${email}: ${code}`)
            // TODO: Ganti pake Resend/Twilio
            // await sendEmail(email, `Kode login lu: ${code}`)
          },
          
          // 3. Halaman input kode OTP  
          verify: async (c, form, error) => {
            return htmlResponse(verifyPage(error?.message))
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

// TEMPLATE HTML LU
function loginPage(error?: string) {
  return `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <title>Masuk READTalk</title>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen flex items-center justify-center antialiased">
  <div class="w-full max-w-sm p-6">
    <div class="text-center mb-8">
      <div class="text-3xl font-black mb-2">READTalk</div>
      <p class="text-zinc-400 text-sm">Login = Bawa temen, bukan bawa status</p>
    </div>
    
    ${error ? `<div class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-6 text-sm">${error}</div>` : ''}
    
    <form method="post" class="space-y-5">
      <div>
        <label class="text-sm text-zinc-400 mb-2 block">Email</label>
        <input 
          name="email" 
          type="email" 
          required
          placeholder="nama@email.com"
          class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 focus:outline-none focus:border-red-500 transition"
        />
      </div>
      <button 
        type="submit"
        class="w-full bg-red-600 hover:bg-red-500 rounded-lg px-4 py-3 font-semibold transition"
      >
        Kirim Kode Masuk
      </button>
    </form>
    
    <p class="text-xs text-zinc-600 text-center mt-8">
      Dengan masuk, lu setuju sama Syarat & Ketentuan READTalk
    </p>
  </div>
</body>
</html>`
}

function verifyPage(error?: string) {
  return `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <title>Kode Verifikasi</title>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen flex items-center justify-center antialiased">
  <div class="w-full max-w-sm p-6">
    <div class="text-center mb-8">
      <div class="text-3xl font-black mb-2">Cek Email</div>
      <p class="text-zinc-400 text-sm">Gue udah kirim kode 6 digit ke email lu</p>
    </div>
    
    ${error ? `<div class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-6 text-sm">${error}</div>` : ''}
    
    <form method="post" class="space-y-5">
      <input 
        name="code" 
        type="text" 
        required
        maxlength="6"
        placeholder="123456"
        class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-red-500 transition"
      />
      <button 
        type="submit"
        class="w-full bg-red-600 hover:bg-red-500 rounded-lg px-4 py-3 font-semibold transition"
      >
        Verifikasi & Masuk
      </button>
    </form>
    
    <form method="post" class="mt-4">
      <input type="hidden" name="action" value="resend" />
      <button type="submit" class="w-full text-zinc-500 hover:text-zinc-300 text-sm">
        Kirim ulang kode
      </button>
    </form>
  </div>
</body>
</html>`
}
