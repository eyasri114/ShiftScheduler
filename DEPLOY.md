# Going live

The app runs on **Vercel** (free plan) and keeps using your **Supabase** project.
After this, every `git push` to GitHub updates the live site automatically.

## 1. Push alert keys (once)

In the project folder:

```bash
npx web-push generate-vapid-keys
```

Keep the two keys it prints. The **private key is a secret**: never commit it,
paste it in chat or share it. Add both to `.env.local` for local use:

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<Public Key>
VAPID_PRIVATE_KEY=<Private Key>
VAPID_SUBJECT=mailto:you@example.com
```

## 2. Vercel

1. Sign up at **vercel.com** with your GitHub account.
2. **Add New → Project**, pick the `ShiftScheduler` repository, **Import**.
3. Open **Environment Variables** and add all five:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | public key from step 1 |
   | `VAPID_PRIVATE_KEY` | private key from step 1 |
   | `VAPID_SUBJECT` | `mailto:` + your email |

4. **Deploy**. When it finishes you get an address like
   `https://shift-scheduler-xxxx.vercel.app`.

## 3. Supabase: allow the new address

**Authentication → URL Configuration**

- **Site URL**: your Vercel address.
- **Redirect URLs**: add `https://<your-address>/**` (keep the localhost one for development).

Without this, the confirmation email links point to localhost.

## 4. On the phones

- **Android (Chrome):** open the address → menu ⋮ → **Install app**.
- **iPhone (Safari, iOS 16.4+):** open the address → **Share** → **Add to Home Screen**,
  then open it from the home screen. (On iPhone, push alerts only work from the installed app.)
- In the app: the **bell** → **הפעלת התראות** (enable alerts) → **שליחת התראת בדיקה** (send test alert).

## 5. Before real employees use it

- **Email:** Supabase's built-in sender allows only a few emails an hour, and confirmation emails
  may land in spam. Connect a real sender under **Authentication → Emails → SMTP Settings**
  (for example Resend or Brevo, both have free plans).
- **Legal values:** the rest rules and the minors' hours are reasonable defaults, not legal
  advice. Have them checked against the Hours of Work and Rest Law and the Youth Employment Law.
- **Backups:** the Supabase free plan has no point-in-time restore; consider the Pro plan once
  real businesses depend on it.
