# AUTONOMOUS-PLAN.md — JAYABINA 100% Autonomous System (100 Job/Hari)

> **Status:** PLAN LOCKED — Owner Approved (2026-07-24)
> **Owner:** Abdul Latif / banktifweb@gmail.com
> **Tujuan:** Transform sistem JAYABINA ke fully autonomous handle 100 job/hari
> **Agents:** Baca fail ini SETIAP sesi baru — ini master plan untuk semua kerja autonomous

---

## ⛔ LOCKED DECISIONS (do not change without explicit owner instruction)

| # | Decision | Detail |
|---|----------|--------|
| 1 | Staff = 200 orang | Bukan 50. Kapasiti jauh lebih besar. |
| 2 | 3-mode job distribution | samarata / priority / area — admin pilih di Settings |
| 3 | Min 2 job per staff | Setiap staff dapat minimum 2 job sebelum round-robin ulang |
| 4 | Max job per staff configurable | Default 4-6, set via `profiles.max_jobs_per_day` |
| 5 | WA Chatbot priority tinggi | Customer boleh booking terus via WhatsApp tanpa website |
| 6 | Full email integration | Resend.com — parallel dengan WhatsApp |
| 7 | AI auto-verify photos | Auto-approve >80% confidence, flag <80% untuk admin |
| 8 | Staff workflow = 9-step wizard | Linear, satu arah, WA interactive buttons setiap step |
| 9 | Photos mandatory 2+2 | 2 before (wajib sebelum Start Job), 2 after (wajib sebelum Request Payment) |
| 10 | Quotation → Invoice → Receipt pipeline | Integrated dengan booking system |
| 11 | 10 time slots | 8am-5pm, per-slot dynamic capacity based on staff availability |
| 12 | Kawasan dropdown | Customer wajib pilih kawasan dalam booking form |

---

## 1. DATA ASAS

| Item | Value |
|------|-------|
| Staff | **200 orang** |
| Target job/hari | 100 |
| Kapasiti maksimum | 200 job/hari (200 staff × 10 slot) |
| Min job per staff | 2 |
| Max job per staff | Configurable (default 4) |
| Time slots | 10 (8am,9am,10am,11am,12pm,1pm,2pm,3pm,4pm,5pm) |
| Servis | Cuci Tangki Air (primary) + Tukar Atap + Mengecat |

---

## 2. ARKITEKTUR 7-LAYER AUTONOMOUS SYSTEM

```
╔═══════════════════════════════════════════════════════════════╗
║                   LAYER 1: INTAKE ENGINE                      ║
║  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ║
║  │Web Form  │  │WA Chatbot│  │Partner   │  │Recurring/    │  ║
║  │(sedia ada)│  │(booking  │  │API       │  │Subscription  │  ║
║  │          │  │ via chat) │  │(agent)   │  │(6-bulan)     │  ║
║  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘  ║
║       └──────────────┴────────────┴───────────────┘           ║
║                          ▼                                    ║
╠═══════════════════════════════════════════════════════════════╣
║                   LAYER 2: SMART SCHEDULER                     ║
║  ┌──────────────────────────────────────────────────────────┐ ║
║  │  Per-Slot Capacity │ Geo-Clustering │ Travel Time Est.   │ ║
║  └──────────────────────────────────────────────────────────┘ ║
╠═══════════════════════════════════════════════════════════════╣
║                   LAYER 3: JOB QUEUE / EVENT BUS               ║
║  ┌──────────────────────────────────────────────────────────┐ ║
║  │  Cloudflare Queues │ Dead Letter │ Retry (3x) │ Cron     │ ║
║  └──────────────────────────────────────────────────────────┘ ║
╠═══════════════════════════════════════════════════════════════╣
║              LAYER 4: AUTONOMOUS WORKFLOW ENGINE               ║
║  ┌──────────────────────────────────────────────────────────┐ ║
║  │  Quote → Booking → Pay → Confirm → Assign → Execute →    │ ║
║  │  Verify → Complete → Invoice → Receipt → Review → Rebook │ ║
║  └──────────────────────────────────────────────────────────┘ ║
╠═══════════════════════════════════════════════════════════════╣
║              LAYER 5: OMNICHANNEL NOTIFICATION                 ║
║  ┌────────────────┐  ┌────────────┐  ┌────────────────────┐  ║
║  │ WhatsApp Cloud │  │ Email      │  │ In-App (Customer   │  ║
║  │ API (24 seq)   │  │ (Resend)   │  │ Portal Notification)│  ║
║  └────────────────┘  └────────────┘  └────────────────────┘  ║
╠═══════════════════════════════════════════════════════════════╣
║              LAYER 6: MONITORING & RESILIENCE                  ║
║  ┌──────────────────────────────────────────────────────────┐ ║
║  │  Admin Dashboard │ Alert (WA to owner) │ Auto-Retry     │ ║
║  │  (#autopilot)    │ (failure detection) │ (idempotent)   │ ║
║  └──────────────────────────────────────────────────────────┘ ║
╠═══════════════════════════════════════════════════════════════╣
║              LAYER 7: CRM & LIFECYCLE                          ║
║  ┌──────────────────────────────────────────────────────────┐ ║
║  │  Segments │ Rebooking (6mo) │ Referral │ Win-back │ NPS  │ ║
║  └──────────────────────────────────────────────────────────┘ ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## 3. 3-MODE JOB DISTRIBUTION SYSTEM (core engine)

### Mode 1: SAMARATA (Equal Distribution)
- Semua 200 staff dapat job secara **round-robin**
- Algorithm: track `staff_job_count` hari ini → assign kepada staff dengan count terendah
- Minimum 2 job per staff sebelum ulang ke staff yang sama
- Bound: tak lebih `max_jobs_per_staff`

```
ALGORITHM:
1. Dapatkan semua staff active
2. Filter: yang belum capai max_jobs_per_staff
3. Sort: job_count_today ASC, last_assigned_at ASC
4. Assign kepada first staff dalam list
5. Kalau semua staff dah capai minimum 2 tapi belum max → continue round-robin
6. Kalau semua staff dah capai max → alert admin "all staff full"
```

### Mode 2: PRIORITY (Ranking 1→200)
- Admin set priority ranking 1 (tertinggi) sampai 200 (terendah)
- Staff #1 dapat job dulu sampai quota penuh → baru staff #2 → seterusnya
- Quota per staff: `profiles.max_jobs_per_day`
- Minimum 2 job per staff — kalau staff #1 dah 2 job, system terus bagi sampai max baru switch

```
ALGORITHM:
1. Dapatkan semua staff active, sorted by priority ASC
2. Untuk setiap staff (by priority):
   a. Kalau job_count_today < max_jobs_per_day → assign
   b. Kalau dah max → skip ke staff seterusnya
3. Kalau semua staff dah max → overflow alert admin
```

### Mode 3: KAWASAN TERDEKAT (Area-Based)
- Customer pilih kawasan dalam dropdown di booking form
- Filter staff by zone → guna sub-mode (samarata/priority) untuk pilih
- Kalau tiada staff di zone → auto-expand ke zone bersebelahan

```
ALGORITHM:
1. Customer pilih kawasan → dapatkan zone_id
2. Filter staff by zone_id + active + below max
3. Kalau filtered staff >= 1 → guna sub-mode untuk pilih
4. Kalau filtered staff = 0 → expand ke adjacent zones
5. Kalau still 0 → fallback ke Mode 1 (semua staff, semua zone)
```

### DB untuk distribution:
```sql
ALTER TABLE profiles ADD COLUMN priority INTEGER DEFAULT 999;
ALTER TABLE profiles ADD COLUMN max_jobs_per_day INTEGER DEFAULT 4;
ALTER TABLE profiles ADD COLUMN min_jobs_per_day INTEGER DEFAULT 2;
ALTER TABLE profiles ADD COLUMN job_count_today INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN last_assigned_at TEXT;

CREATE TABLE zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  adjacent_zones TEXT,
  display_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE staff_zones (
  staff_id TEXT NOT NULL REFERENCES profiles(id),
  zone_id TEXT NOT NULL REFERENCES zones(id),
  PRIMARY KEY (staff_id, zone_id)
);

-- app_settings keys
INSERT INTO app_settings VALUES ('distribution_mode', 'samarata');
INSERT INTO app_settings VALUES ('default_max_jobs_per_staff', '4');
INSERT INTO app_settings VALUES ('default_min_jobs_per_staff', '2');
```

---

## 4. SLOT SYSTEM REDESIGN

| Slot Masa | Kapasiti Staff | Max Job/Slot |
|-----------|-----------------|--------------|
| 8:00 AM | 20 | 20 |
| 9:00 AM | 20 | 20 |
| 10:00 AM | 25 | 25 |
| 11:00 AM | 25 | 25 |
| 12:00 PM | 20 | 20 |
| 1:00 PM | 20 | 20 |
| 2:00 PM | 25 | 25 |
| 3:00 PM | 25 | 25 |
| 4:00 PM | 15 | 15 |
| 5:00 PM | 5 | 5 |
| **TOTAL** | **200** | **200 max** |

Per-slot cap dynamic berdasarkan: number of available staff for that slot (tolak staff yg dah assigned ke slot sebelum + travel buffer 30 min).

Booking form tambah field: **Kawasan** (mandatory dropdown).

---

## 5. STAFF WORKFLOW — 9-STEP WIZARD

Ini adalah **core autonomous operations**. Staff portal (`worker/index.html`) direka semula sebagai step-by-step wizard.

```
┌─────────────────────────────────────────────────────────────┐
│  STAFF WORKFLOW WIZARD                     Job: JB-20260725 │
│                                                             │
│  ✅ STEP 1: Accept Job         ← WA auto: "Accept / Reject" │
│  ✅ STEP 2: Confirm Job        ← WA auto: 1 day before     │
│  ▶ STEP 3: Heading to Site     ← WA auto: morning of job   │
│  ⬜ STEP 4: Arrive at Site                                   │
│  ⬜ STEP 5: Take 2 Before Photos (MANDATORY)                │
│  ⬜ STEP 6: Start Job                                       │
│  ⬜ STEP 7: Take 2 After Photos (MANDATORY)                 │
│  ⬜ STEP 8: Request Payment    ← System auto-WA customer    │
│  ⬜ STEP 9: Finish Job                                      │
│                                                             │
│  [BUTTON AKTIF UNTUK CURRENT STEP SAHAJA]                   │
└─────────────────────────────────────────────────────────────┘
```

### Step Detail:

| Step | Nama | Trigger | Action | WA Automation | Lock Condition |
|------|------|---------|--------|---------------|----------------|
| 1 | **Accept Job** | System auto-assign | Staff klik Accept → job confirmed. Klik Reject → auto-reassign staff lain | WA hantar interactive buttons **"Terima Job" / "Tolak Job"** | — |
| 2 | **Confirm Job** | 1 hari sebelum tarikh job | Staff klik Confirm → sahkan kehadiran | WA auto hantar **"Confirm Hadir"** button 24h before | Step 1 accepted |
| 3 | **Heading to Site** | Pagi hari job | Staff klik → system track on-the-way | WA auto hantar **"Sedang Menuju ke Site"** button pagi | Step 2 confirmed |
| 4 | **Arrive at Site** | Staff sampai lokasi | Staff klik Arrive → GPS recorded | — | Step 3 done |
| 5 | **Take Before Photos** | Sampai site, sebelum kerja | **WAJIB 2 gambar.** Upload 2 before photos. Kalau tak cukup 2 → button next step disabled | — | Step 4 done |
| 6 | **Start Job** | Selepas upload 2 before photos | Staff klik Start → task status = in_progress, timer mula | WA notify customer: "Staff dah mula kerja" | Step 5: min 2 photos |
| 7 | **Take After Photos** | Selepas siap kerja | **WAJIB 2 gambar.** Upload 2 after photos. Kalau tak cukup 2 → button next step disabled. AI auto-verify | — | Step 6 done |
| 8 | **Request Payment** | Selepas upload 2 after photos | Staff klik → **System auto-WA customer link bayaran baki RM150.** Staff TUNGGU customer bayar on the spot | WA hantar payment link ke customer | Step 7: min 2 photos |
| 9 | **Finish Job** | Customer dah bayar + tunjuk bukti | Staff klik Finish → task complete, invoice auto-generate, receipt auto-generate | WA invoice + receipt ke customer | Step 8 done |

### WA Interactive Messages:

**Step 1 — WA to Staff (serta-merta lepas assigned):**
```
JAYABINA - Job Baru

Pelanggan: Ahmad (012-3456789)
Alamat: No 12, Jalan Melati, Setapak
Tarikh: 25/7/2026, 9:00 AM
Servis: Cuci Tangki Air

[✅ Terima Job]  [❌ Tolak Job]
```

**Step 2 — WA to Staff (24h sebelum job):**
```
JAYABINA - Peringatan Job Esok

Esok: Ahmad, Setapak, 9am

[✅ Confirm Hadir]
```

**Step 3 — WA to Staff (pagi job):**
```
JAYABINA - Job Hari Ini

Ahmad, Setapak, 9am

[🛵 Sedang Menuju ke Site]
```

**Step 8 — WA to Customer (bila staff klik Request Payment):**
```
JAYABINA - Bayaran Baki

Kerja cuci tangki anda telah selesai. Sila jelaskan baki:

Baki: RM150

[💳 Bayar RM150 Sekarang]
```

### WA Webhook Button Handler:
```
POST /api/wa-webhook (dari Meta webhook callback):
  Button "Terima Job"       → task.status = 'assigned'
  Button "Tolak Job"        → task.status = 'unassigned', auto-assign staff lain
  Button "Confirm Hadir"    → task.staff_confirmed_at = now
  Button "Menuju Site"      → task.heading_at = now
```

### DB untuk workflow:
```sql
ALTER TABLE tasks ADD COLUMN workflow_step INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN staff_accepted_at TEXT;
ALTER TABLE tasks ADD COLUMN staff_confirmed_at TEXT;
ALTER TABLE tasks ADD COLUMN heading_at TEXT;
ALTER TABLE tasks ADD COLUMN arrived_at TEXT;
ALTER TABLE tasks ADD COLUMN staff_rejected INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN before_photos_count INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN after_photos_count INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN payment_requested_at TEXT;
ALTER TABLE tasks ADD COLUMN customer_paid_on_site INTEGER DEFAULT 0;
```

---

## 6. QUOTATION → INVOICE → RECEIPT PIPELINE

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  QUOTATION   │ ──▶ │   BOOKING    │ ──▶ │   INVOICE    │ ──▶ │   RECEIPT     │
│  (sebut harga)│     │  (tempahan)  │     │  (invois)    │     │  (resit)     │
├──────────────┤     ├──────────────┤     ├──────────────┤     ├──────────────┤
│• Customer     │     │• Deposit RM150│    │• Senarai servis│   │• Deposit paid │
│  request quote│    │• Bayarcash    │     │• Deposit -150  │    │• Balance paid  │
│• Admin generate│   │               │     │• Baki RM150     │    │• Transaction#  │
│• Send WA+Email│    │               │     │• PDF download   │    │• PDF download  │
│• Accept → auto│    │               │     │                 │    │                │
│  create booking│   │               │     │                 │    │                │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

### Tables:
```sql
CREATE TABLE quotations (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  service_type TEXT NOT NULL,
  amount REAL NOT NULL,
  details TEXT,
  status TEXT DEFAULT 'draft', -- draft/sent/accepted/rejected/expired
  valid_until TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id),
  quotation_id TEXT REFERENCES quotations(id),
  number TEXT NOT NULL UNIQUE, -- INV-YYYYMMDD-XXX
  items TEXT NOT NULL, -- JSON
  subtotal REAL NOT NULL,
  deposit_paid REAL DEFAULT 0,
  balance_due REAL NOT NULL,
  status TEXT DEFAULT 'pending', -- pending/paid/cancelled
  pdf_url TEXT,
  sent_at TEXT,
  paid_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id),
  invoice_id TEXT REFERENCES invoices(id),
  number TEXT NOT NULL UNIQUE, -- RCP-YYYYMMDD-XXX
  payment_type TEXT NOT NULL, -- deposit/balance
  amount REAL NOT NULL,
  payment_method TEXT,
  transaction_ref TEXT,
  pdf_url TEXT,
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

Number formats: `QT-YYYYMMDD-XXX`, `INV-YYYYMMDD-XXX`, `RCP-YYYYMMDD-XXX`

---

## 7. WHATSAPP CHATBOT BOOKING

### Architecture:
```
Customer WA → Meta Webhook → Cloudflare Worker (wa-webhook)
                                   │
                         ┌─────────┼──────────┐
                         ▼         ▼          ▼
                    Intent       Slot        Booking
                    Parser      Checker      Creator
                         │         │          │
                         └─────────┼──────────┘
                                   ▼
                            WA Response
                         (interactive msg)
```

### Conversation Flow:
```
Customer: "nak cuci tangki"
Bot: "Pilih kawasan:" [Quick Reply: KL Utara, KL Pusat, PJ, Shah Alam, ...]
Customer: [klik KL Utara]
Bot: "Slot tersedia:" [Quick Reply: 9am, 11am, 2pm] (hanya slot available)
Customer: [klik 9am]
Bot: "Nama penuh?"
Customer: "Ahmad"
Bot: "Nombor telefon?"
Customer: "0123456789"
Bot: "Alamat penuh?"
Customer: "No 12, Jalan Melati, Setapak"
Bot: "Email? (taip 'skip' kalau tak ada)"
Customer: "skip"
Bot: "✅ Ringkasan: Cuci Tangki, 25/7/2026 9am, KL Utara. Deposit RM150.
      [Bayar RM150] [Batal]"
Customer: [klik Bayar RM150]
Bot: → Send Bayarcash payment link
Bot (after callback): "✅ Bayaran diterima! Staff kami akan datang 25/7/2026 9am."
```

### DB:
```sql
CREATE TABLE wa_conversations (
  id TEXT PRIMARY KEY,
  wa_phone TEXT NOT NULL,
  state TEXT NOT NULL,
  context TEXT,
  booking_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'active'
);
```

Fallback: Kalau bot stuck 3x → forward ke human (WhatsApp owner). Kalau idle > 30 min → "Taip 'sambung' untuk teruskan."

---

## 8. AUTOMATED NOTIFICATION PIPELINE (24 triggers)

| # | Trigger | Channel | Recipient |
|---|---------|---------|-----------|
| 1 | Booking created | WA + Email | Customer |
| 2 | Payment received | WA + Email + Receipt | Customer |
| 3 | 24h before job | WA | Customer |
| 4 | 2h before job | WA + Maps | Customer |
| 5 | Staff assigned (to customer) | WA | Customer |
| 6 | Staff on the way | WA live location | Customer |
| 7 | Staff arrived | WA | Customer |
| 8 | Job started | WA | Customer |
| 9 | Job completed | WA + Email + Invoice | Customer |
| 10 | Review request (24h later) | WA | Customer |
| 11 | Balance unpaid 24h | WA | Customer |
| 12 | Balance unpaid 72h | WA + Email | Customer |
| 13 | Rebooking 5 bulan | WA | Customer |
| 14 | Rebooking 6 bulan | WA + Email | Customer |
| 15 | Referral offer | WA | Customer |
| 16 | Birthday promo | WA + Email | Customer |
| 17 | Booking cancelled | WA + Email | Customer |
| 18 | Payment failed | WA | Customer |
| 19 | Staff new job alert | WA | Staff |
| 20 | Staff daily briefing (7am) | WA | Staff |
| 21 | Staff Accept/Reject prompt | WA (interactive) | Staff |
| 22 | Staff Confirm prompt (24h) | WA (interactive) | Staff |
| 23 | Staff Heading prompt (morning) | WA (interactive) | Staff |
| 24 | No-show alert | WA | Admin |
| 25 | Admin daily summary (9pm) | WA | Admin |
| 26 | Staff full quota alert | WA | Admin |

---

## 9. AI PHOTO VERIFICATION

- Guna **Cloudflare Workers AI** (`@cf/meta/llama-3.2-11b-vision-instruct`)
- Before photo: "Is there a water tank visible? YES/NO."
- After photo: "Does this water tank appear clean? YES/NO."
- Comparison: "Do these two photos show the same tank before/after cleaning? CLEANED/NOT_CLEANED/DIFFERENT_TANK."
- Confidence > 80% → auto-approve
- Confidence < 80% → flag untuk admin manual review
- Fail → reject, minta staff upload semula

---

## 10. ADMIN DASHBOARD — #autopilot TAB

```
┌─────────────────────────────────────────────────────────────┐
│  AUTOPILOT DASHBOARD                    [▶ RUNNING] [PAUSE] │
├─────────────┬─────────────┬─────────────┬──────────────────┤
│ JOB TODAY   │ PAYMENT     │ STAFF       │ QUEUE HEALTH     │
│ 87 / 100    │ 94% conv    │ 78% util    │ 2 failed         │
│ ████████░░  │ █████████░  │ ████████░░  │ ⚠ 2 in DLQ       │
├─────────────┴─────────────┴─────────────┴──────────────────┤
│                                                             │
│  LIVE JOB PIPELINE (Kanban)                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ PENDING  │ │CONFIRMED │ │IN PROG   │ │COMPLETED │      │
│  │   13     │ │   42     │ │   18     │ │   27     │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
│  DISTRIBUTION MODE: [SAMARATA ▼]  [PRIORITY ▼]  [AREA ▼]  │
│                                                             │
│  RECENT EVENTS (real-time):                                 │
│  • 10:32 - Booking JB-20260725-087 created (WA bot)        │
│  • 10:31 - Payment received JB-20260725-086                │
│  • 10:31 - AI verified photos ✅                           │
└─────────────────────────────────────────────────────────────┘
```

### Additional admin tabs:
- **#staff-priority** — drag-and-drop ranking 200 staff + quota settings
- **#quotations** — manage quotation lifecycle (draft → sent → accepted)
- **#invoices** — invoice management + resend
- **#receipts** — receipt history

---

## 11. CUSTOMER SELF-SERVICE PORTAL V2
`customer/index.html` upgrade:
- Lihat upcoming bookings
- Reschedule (drag to new date)
- Cancel booking (auto-refund policy)
- Lihat job history + before/after photos
- Bayar baki (online payment link)
- Lihat quotations, invoices, receipts
- Update profile (address, phone, preferred zone)
- Referral dashboard
- Rebooking one-click

---

## 12. ADDITIONAL FEATURES

### F12 — Smart Pricing Engine
Dynamic pricing: demand surge, location premium, first-time discount, service bundle

### F13 — Abandoned Booking Recovery
Track form abandonment → WA follow-up after 30 min + 24h

### F14 — Orphan Cleanup Cron
Every 15 min: expire pending_payment > 2 jam, clean stale conversations, retry failed events

### F15 — Rate Limiting & CAPTCHA
Per-IP: max 5 bookings/hour. Per-phone: max 3 bookings/day. Cloudflare Turnstile CAPTCHA.

### F16 — Multi-Service Expansion
Support cuci tangki + tukar atap + mengecat. Staff skill tagging.

### F17 — Payment Upgrade
FPX direct, auto-refund, partial payment, PDF receipt

### F18 — Real-Time GPS Tracking
Staff location sharing during job (auto-expire after complete)

### F19 — Analytics & Reporting
Conversion funnel + weekly auto-report WA to admin

### F20 — System Health Monitor
Health check + circuit breaker + degradation detection

### F21 — Partner/Agent API
API key auth, rate limiting, webhook for status updates

### F22 — Recurring Booking Engine
Auto-create booking every 6 months + WA notification

---

## 13. IMPLEMENTATION ROADMAP

### PHASE 1 (Week 1-2): Foundation
- DB migration (semua table baru)
- Slot system redesign (10 slot + per-slot cap)
- 3-mode distribution engine (samarata, priority, area)
- Booking form upgrade (kawasan dropdown)
- Quotation/Invoice/Receipt tables + basic CRUD

### PHASE 2 (Week 3-4): Autonomous Core
- Job queue system (Cloudflare Queues)
- 24-trigger notification pipeline
- Email infrastructure (Resend)
- 9-step staff workflow wizard (worker/index.html overhaul)
- WA interactive buttons (Accept/Reject, Confirm, Heading)
- Photo enforcement (min 2 before, min 2 after)
- Request Payment → auto-WA customer

### PHASE 3 (Week 5-6): Intelligence
- WhatsApp chatbot booking (full conversation flow)
- AI photo verification
- Autonomous dashboard (#autopilot tab)
- Orphan cleanup cron + rate limiting + CAPTCHA
- Invoice/Receipt PDF generation + auto-send

### PHASE 4 (Week 7-8): Growth
- Partner/agent booking API
- Customer self-service portal V2
- Recurring booking engine
- Smart pricing engine
- Abandoned booking recovery

### PHASE 5 (Week 9-10): Polish
- Real-time GPS tracking
- Payment upgrade (FPX + refund + receipt)
- Load testing (100 concurrent bookings)
- Security audit
- Documentation

---

## 14. FILE MAP — what will be touched

**⚠️ LOCKED FILES — NEVER TOUCH:**
- `site/layouts/partials/service-tank.html` (full lock)
- `site/layouts/partials/service-roof.html`
- `site/layouts/partials/service-paint.html`
- `site/layouts/index.html` (hero + final-cta locked)
- `portal-shared.css` + `theme.css` (design system)
- `admin/index.html` existing sections (design locked)

**NEW/MODIFIED FILES:**

| File | Change | Phase |
|------|--------|-------|
| `cf-api/src/db/schema.ts` | Tambah semua table baru | P1 |
| `cf-api/migrations/0004_autonomous.sql` | Migration SQL | P1 |
| `cf-api/src/routes/bookings.ts` | 3-mode distribution + slot cap | P1 |
| `cf-api/src/routes/slots.ts` | Per-slot capacity, 10-slot | P1 |
| `cf-api/src/routes/quotations.ts` | NEW — quotation CRUD | P1 |
| `cf-api/src/routes/invoices.ts` | NEW — invoice CRUD + PDF | P1 |
| `cf-api/src/routes/receipts.ts` | NEW — receipt CRUD + PDF | P1 |
| `cf-api/src/routes/distribution.ts` | NEW — 3-mode engine | P1 |
| `cf-api/src/routes/whatsapp.ts` | Cloud API + interactive buttons | P2 |
| `cf-api/src/routes/wa-webhook.ts` | NEW — Meta webhook handler | P2 |
| `cf-api/src/routes/wa-bot.ts` | NEW — chatbot conversation | P3 |
| `cf-api/src/routes/email.ts` | NEW — Resend integration | P2 |
| `cf-api/src/routes/ai-verify.ts` | NEW — AI photo verify | P3 |
| `cf-api/src/queue/producer.ts` | NEW — event producer | P2 |
| `cf-api/src/queue/consumer.ts` | NEW — event consumer | P2 |
| `cf-api/src/routes/analytics.ts` | NEW — analytics events | P2 |
| `cf-api/src/routes/partners.ts` | NEW — partner API | P4 |
| `cf-api/src/routes/subscriptions.ts` | NEW — recurring booking | P4 |
| `cf-api/src/cron/cleanup.ts` | NEW — orphan cleanup | P3 |
| `worker/index.html` | REDESIGN — 9-step wizard | P2 |
| `admin/index.html` | ADD #autopilot + #staff-priority tabs | P3,P4 |
| `admin/index.html` | ADD #quotations + #invoices + #receipts tabs | P5 |
| `customer/index.html` | UPGRADE — self-service V2 | P4 |
| `cf-api/wrangler.jsonc` | Queue + cron + secret bindings | P1 |

---

## 15. LOC ESTIMATE

### Existing Codebase: 8,450 LOC
| Component | LOC |
|-----------|-----|
| Backend (cf-api) | 3,912 |
| Admin panel | 1,761 |
| Worker panel | 714 |
| Customer panel | 312 |
| CSS | 1,181 |
| JS client | 348 |
| DB migrations | 222 |

### New Code: ~11,050 LOC
| Phase | Component | LOC |
|-------|-----------|-----|
| P1 | DB migration + schema | 250 |
| P1 | Slot system redesign | 200 |
| P1 | 3-mode distribution engine | 500 |
| P1 | Quotation/Invoice/Receipt routes | 600 |
| P1 | PDF generation | 200 |
| P1 | Admin UI (quotes/invoices/receipts) | 500 |
| P1 | Booking form kawasan dropdown | 250 |
| **P1 Subtotal** | | **2,500** |
| P2 | Job queue system | 400 |
| P2 | Notification pipeline | 500 |
| P2 | Email infrastructure | 350 |
| P2 | Staff workflow wizard (worker page) | 900 |
| P2 | WA interactive buttons | 300 |
| P2 | Photo enforcement | 150 |
| P2 | Workflow state machine | 300 |
| **P2 Subtotal** | | **2,900** |
| P3 | WhatsApp chatbot | 800 |
| P3 | AI photo verification | 300 |
| P3 | Autopilot dashboard | 800 |
| P3 | Cleanup cron + rate limit | 350 |
| P3 | Invoice/Receipt PDF + auto-send | 200 |
| **P3 Subtotal** | | **2,450** |
| P4 | Partner API | 400 |
| P4 | Customer portal V2 | 600 |
| P4 | Recurring booking | 400 |
| P4 | Smart pricing | 300 |
| P4 | Abandoned recovery | 250 |
| **P4 Subtotal** | | **1,950** |
| P5 | GPS tracking | 300 |
| P5 | Payment upgrade | 350 |
| P5 | Load testing + docs | 300 |
| **P5 Subtotal** | | **950** |
| **GRAND TOTAL NEW** | | **11,050** |
| **AFTER ALL** | | **~19,500 LOC (2.3x)** |

---

## 16. COST ESTIMATE (monthly, for 100 jobs/day)

| Service | Free Tier | Estimated Cost |
|---------|-----------|----------------|
| Cloudflare Workers | 100k req/day | **RM0** |
| Cloudflare Queues | 1M ops/month | **RM0** |
| Cloudflare D1 | 5GB + 5M reads | **RM0** |
| Cloudflare Workers AI | 10k req/month | **~RM10** |
| WhatsApp Cloud API | 1000 msg/month | **~RM80** |
| Resend Email | 100/day | **~RM20** |
| Bayarcash | No monthly fee | **RM0** |
| **TOTAL** | | **~RM110/bulan** |

---

## 17. KEY PERFORMANCE INDICATORS

| KPI | Target |
|-----|--------|
| Job selesai / hari | ≥ 95 dari 100 |
| Payment conversion | ≥ 85% |
| Auto-assign success | ≥ 98% |
| Notification delivery | ≥ 98% |
| AI photo auto-approval | ≥ 70% |
| Rebooking rate (6mo) | ≥ 40% |
| System uptime | ≥ 99.9% |
| Chatbot booking completion | ≥ 60% |
| Avg job cycle time | ≤ 48 jam |
| Staff workflow compliance | ≥ 95% (semua 9 step complete) |

---

## 18. KNOWN RISKS & MITIGATION

| Risk | Mitigation |
|------|------------|
| Bayarcash down | Queue-based retry, fallback WA |
| WhatsApp API rate limit | Queue + rate limiter, fallback email |
| Staff reject job | Auto-reassign ke staff lain (max 3 reject → admin alert) |
| Staff no-show | Auto-reassign to nearest available staff |
| Photo upload gagal | Retry 3x, alert staff, allow manual admin override |
| Overbooking race condition | Idempotency key + slot pessimistic lock |
| Customer tak bayar on the spot | Auto-follow-up WA 24h + 72h, admin can override Finish |
| AI photo false positive | Admin review queue untuk flagged photos |

---

## 19. EXISTING LOCKED ELEMENTS (from AGENTS.md)

These remain LOCKED and must NEVER be modified by autonomous system work:
- `service-tank.html` — full lock (primary booking funnel)
- `service-roof.html`, `service-paint.html` — hero lock
- `index.html` — hero + final-cta lock
- `portal-shared.css`, `theme.css` — design system lock
- Header/footer/burger-menu system lock
- All 4-page layout system lock
- ⛔ **Booking form upgrade will be done via a NEW partial (`booking-form-v2.html`), NOT by modifying the locked service-tank.html**
- ⛔ **Staff workflow wizard is built in `worker/index.html` — this file is design-locked, modifications are limited to the workflow content area only, preserving sidebar/header/design tokens**

---

## 20. SESSION CHECKPOINT

Last updated: 2026-07-24
Plan checkpoint tag: `autonomous-plan-v1`
Canonical git tag for pre-autonomous state: `checkpoint-20260724-0537`
