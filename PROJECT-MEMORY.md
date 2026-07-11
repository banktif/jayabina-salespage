# JAYACUCI — Project Memory

## TL;DR
Sales page cuci tangki air. Brand: JAYACUCI (Jaya Bina Services). Single page + booking + admin panel. Free.

## URLs
| Page | URL |
|------|-----|
| Sales page | https://cuci.jayabina.com |
| Editor | https://cuci.jayabina.com/editor |
| Admin panel | https://cuci.jayabina.com/admin |
| Test calendar | https://cuci.jayabina.com/test-cal.html |
| GitHub repo | https://github.com/banktif/jayaclean-salespage |

## Tech Stack (RM0)
- Hosting: GitHub Pages + Cloudflare CDN/DNS (proxy ON, orange cloud)
- Backend: Supabase (PostgreSQL + REST API)
- Images: Cloudinary (dkibczut)
- Payment: Bayarcash v3 (integrated via Supabase Edge Function `bayarcash` — solves CORS; PAT stored as Supabase secret)
- Editor: GrapesJS 0.21.13 + preset-webpage 1.0.3 (CDN)
- Fonts: Plus Jakarta Sans (admin) / Poppins (sales page)

## Credentials Location
All API keys, tokens, passwords are in the chat history. Ask user to re-provide or check dashboards:
- Supabase: https://thbscwlcyhcnqsppoyfn.supabase.co
- Bayarcash: https://console.bayar.cash
- Cloudinary: https://console.cloudinary.com (dkibczut)
- GitHub: account banktif, repo jayaclean-salespage

## Database (Supabase)
- Tables: bookings, slots
- RPC Functions: get_available_slots, check_slot, create_booking, create_bayarcash_payment (may need reload)
- PostgREST schema cache needs `NOTIFY pgrst, 'reload schema'` after migrations

## Admin Panel
- Password: Salman43! (hash: 6e5574b72c57535f)
- Brand: JAYACUCI, logo: JC
- Theme: light/dark/system, responsive (mobile <1024px, desktop >=1024px)
- Mobile: hamburger drawer + bottom nav 4 tabs
- Desktop: 260px sidebar + data table

## Sales Page (10 sections)
Hero (wudhu) → Masalah → Edukasi → Solusi → Proses (4 steps) → Kenapa Kami → Booking Form → FAQ → Tentang Kami → Final CTA
- 10 image placeholders [GAMBAR 1-10]
- Pricing: RM300 (deposit RM150, baki RM150)
- Coverage: Lembah Klang, max 4 slots/day (9am,11am,2pm,4pm)

## Colors
- Primary: #2E7D32 / #1B5E20
- Admin accent: #0ea364 (light) / #1db974 (dark)
- Yellow: #FFC107
- Admin BG: #f2f4f8 (light) / #0f1218 (dark)

## Pending Tasks
1. ~~Bayarcash auto-payment~~ DONE — Edge Function `supabase/functions/bayarcash` (create-intent + callback). TODO to go live: `supabase functions deploy bayarcash --project-ref thbscwlcyhcnqsppoyfn` + set secrets (BAYARCASH_PAT, BAYARCASH_PORTAL_KEY, BAYARCASH_API_SECRET, BAYARCASH_PAYMENT_CHANNEL, SITE_URL). Then in Bayarcash console rotate the leaked PAT.
2. Replace 10 image placeholders with real photos
3. ~~Replace WhatsApp placeholder number~~ DONE — now 60139373275 (index.html + success.html)
4. Enable HTTPS enforcement on GitHub Pages

## Payment Flow (Bayarcash)
- Browser: insert booking (pending) → POST {booking_id} to Edge Function `/create-intent`
- Function: reads booking from DB (service role, amount server-side = deposit RM150), calls Bayarcash v3 payment-intents, returns `url` → browser redirects
- Bayarcash → POST `/callback` (server-to-server): checksum HMAC-SHA256 verified → set payment_status=paid/failed, status=confirmed
- return_url → `success.html?order=<id>` polls booking.payment_status for live status
- Channel 5 = DuitNow (env BAYARCASH_PAYMENT_CHANNEL, override to 1 for FPX). Amount format = Ringgit string "150.00"

## File Structure (cuci-tangki/)
index.html, editor.html, admin.html, success.html, test-cal.html, CNAME, manifest.json, migration.sql
supabase/config.toml, supabase/functions/bayarcash/index.ts, supabase/migrations/*.sql
