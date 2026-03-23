# TradeMaster DM Automation System

**ManyChat + Instagram + Claude AI + Supabase**  
Production-grade DM sales automation for trading education businesses.

---

## What This Does

Every inbound Instagram DM is automatically:
1. Received by ManyChat
2. Sent to your backend via webhook
3. Analysed by Claude (qualifier + CRM extractor + DM writer)
4. Replied to automatically in the DM
5. Stored in Supabase with full CRM data
6. Tagged in ManyChat
7. Enrolled in the right follow-up sequence

Zero manual intervention. Runs 24/7.

---

## Prerequisites

- ManyChat Pro account (required for External Requests + Instagram)
- Instagram Business account connected to ManyChat
- Anthropic API key (claude.ai/settings)
- Supabase account (free tier works)
- Railway account (free tier works) OR any Node.js host with HTTPS

---

## Project Structure

```
trading-dm-system/
├── src/
│   ├── index.js                    # Express server entry point
│   ├── routes/
│   │   ├── webhook.js              # Main DM handler (core of the system)
│   │   ├── followup.js             # Conversion events + manual controls
│   │   └── analytics.js           # CRM dashboard data endpoints
│   ├── services/
│   │   ├── claude.js               # Anthropic API wrapper
│   │   ├── database.js             # Supabase operations
│   │   ├── manychat.js             # ManyChat API
│   │   └── offerRouter.js          # Offer routing engine
│   ├── prompts/
│   │   └── salesAgent.js           # Claude system prompt + context builder
│   ├── jobs/
│   │   └── followUpScheduler.js    # Cron job — fires follow-ups every 15min
│   └── utils/
│       └── security.js             # Rate limiting + webhook verification
├── schema.sql                      # Supabase database schema
├── .env.example                    # All required environment variables
└── package.json
```

---

## Setup — Step by Step

### Step 1: Supabase Database

1. Go to [supabase.com](https://supabase.com) → New Project
2. Once created, click **SQL Editor** in the left sidebar
3. Paste the entire contents of `schema.sql` and click **Run**
4. Verify tables were created: leads, conversations, events, offer_routes, tags
5. Go to **Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key (NOT anon key) → `SUPABASE_SERVICE_KEY`

### Step 2: Deploy to Railway

1. Push this project to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your repo
4. Railway auto-detects Node.js and runs `npm start`
5. Go to **Settings → Domains** → Generate a domain
6. Copy your Railway URL (e.g. `https://trademaster-dm.up.railway.app`)

### Step 3: Environment Variables

In Railway → Variables tab, add all of these:

```
PORT=3000
NODE_ENV=production

ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
MANYCHAT_API_KEY=...
WEBHOOK_SECRET=pick_any_random_string_here
ANALYTICS_API_KEY=pick_another_random_string
```

### Step 4: ManyChat Custom Fields

In ManyChat → **Settings → Custom Fields → Create Field**:

| Field Name | Type |
|---|---|
| lead_status | Text |
| lead_score | Text |
| experience | Text |
| urgency | Text |
| offer_fit | Text |
| next_action | Text |
| budget_signal | Text |
| conversion_probability | Text |

### Step 5: ManyChat Tags

In ManyChat → **Audience → Tags → Create Tag**. Create ALL of these:

```
lead:cold         lead:warm         lead:hot
experience:beginner  experience:intermediate  experience:advanced
pain:inconsistency   pain:blown_account   pain:no_edge
pain:emotional    pain:prop_fail
goal:funded_account  goal:full_time  goal:side_income  goal:consistency
offer:low_ticket  offer:mid_ticket  offer:high_ticket
action:book_call  action:send_link  action:nurture  action:followup
budget:low        budget:medium     budget:high
status:no_show    status:call_booked  status:purchased
```

### Step 6: ManyChat Flow — Main DM Handler

1. Go to **Flows → New Flow** → Name it "AI DM Handler"
2. Add trigger: **Instagram → DM received**
3. Add a step: **Action → External Request**
4. Configure:
   - **Method:** POST
   - **URL:** `https://your-app.railway.app/webhook/dm`
   - **Headers:** 
     - `Content-Type: application/json`
     - `Authorization: Bearer YOUR_WEBHOOK_SECRET`
   - **Body (JSON):**

```json
{
  "subscriber_id": "{{user_id}}",
  "instagram_handle": "{{user_instagram_username}}",
  "full_name": "{{full_name}}",
  "message_text": "{{last_input_text}}",
  "source": "direct",
  "custom_fields": {
    "lead_status": "{{lead_status}}",
    "lead_score": "{{lead_score}}",
    "experience": "{{experience}}",
    "urgency": "{{urgency}}",
    "offer_fit": "{{offer_fit}}"
  }
}
```

5. **Response Mapping:**  
   - Text Message: `{{external_request.response.content.messages.0.text}}`
6. Add a fallback message for timeout: *"One sec, I'll get back to you shortly 👊"*
7. **Publish the flow**

### Step 7: ManyChat Flow — Keyword Triggers (Reel Comments)

For each keyword (e.g. "INFO", "SIGNALS", "TRADING"):

1. New Flow → **Instagram → Comment on Post** trigger
2. Set keyword condition
3. Add **Send DM** step with a greeting message
4. Add **External Request** step (same config as above, but set `"source": "reel_comment"`)
5. Publish

### Step 8: ManyChat Flow — Conversion Event Webhooks

**Call Booked Flow:**
1. Trigger: Tag Applied → `status:call_booked`
2. External Request to `POST /followup/event`
3. Body: `{"subscriber_id": "{{user_id}}", "instagram_handle": "{{user_instagram_username}}", "event_type": "call_booked"}`

**Purchase Flow (repeat for each tier):**
1. Trigger: Tag Applied → `status:purchased`
2. External Request to `POST /followup/event`
3. Body: `{"subscriber_id": "{{user_id}}", "instagram_handle": "{{user_instagram_username}}", "event_type": "purchase_low_ticket"}`

### Step 9: Test End to End

1. DM your own Instagram account from a test account
2. Check Railway logs: you should see the webhook fire and Claude respond
3. Check Supabase → leads table: a new row should appear
4. Check Supabase → conversations table: the message turn should be logged
5. The test account should receive Claude's reply in Instagram DMs

---

## Follow-Up Scheduler

The cron job runs inside the same Node.js process every 15 minutes.

To run it as a separate process (recommended for production):
```bash
node src/jobs/followUpScheduler.js
```

Or add a second Railway service pointing to the same repo with start command:
```
node src/jobs/followUpScheduler.js
```

---

## Analytics Endpoints

All analytics endpoints require the `x-api-key` header set to your `ANALYTICS_API_KEY`.

```
GET /analytics/pipeline          — Funnel overview counts
GET /analytics/leads             — Paginated lead list
GET /analytics/leads/:id/conversation  — Full conversation for a lead
GET /analytics/events            — Recent conversion events
GET /analytics/conversion-rate   — Conversion rates by source
```

Example:
```bash
curl https://your-app.railway.app/analytics/pipeline \
  -H "x-api-key: YOUR_ANALYTICS_API_KEY"
```

---

## Manual Controls

```bash
# Manually trigger the follow-up job
POST /followup/run
Header: x-webhook-secret: YOUR_WEBHOOK_SECRET

# Log a conversion event
POST /followup/event
Header: x-webhook-secret: YOUR_WEBHOOK_SECRET
Body: {"instagram_handle": "@user", "event_type": "call_booked"}

# Suppress follow-ups for a lead (you're handling manually)
POST /followup/suppress
Header: x-webhook-secret: YOUR_WEBHOOK_SECRET
Body: {"instagram_handle": "@user"}
```

---

## Customising the System Prompt

Edit `src/prompts/salesAgent.js` to:
- Change your brand name and offer details
- Adjust tone instructions
- Modify offer tier pricing/descriptions
- Add specific scripts for common objections
- Add product-specific knowledge

The context injection (lead CRM data + conversation history) is handled automatically.

---

## Monitoring

Check Railway logs in real-time for all webhook activity.

Add Sentry by installing `@sentry/node` and adding to `src/index.js`:
```javascript
const Sentry = require('@sentry/node');
Sentry.init({ dsn: process.env.SENTRY_DSN });
app.use(Sentry.Handlers.requestHandler());
```

---

## Dependencies

```
@anthropic-ai/sdk    — Claude API
@supabase/supabase-js — Database
axios                 — ManyChat API calls  
express               — HTTP server
node-cron             — Follow-up scheduler
dotenv                — Environment variables
```

Install: `npm install`

---

## Gotchas

- **ManyChat External Request timeout is 10 seconds.** Claude Sonnet responds in 1–3s, so you're fine.
- **Instagram proactive messaging (follow-ups) requires a 24-hour window** from the user's last message. Schedule time-sensitive follow-ups accordingly.
- **Supabase service key is secret.** Never expose it client-side.
- **ManyChat custom fields are TEXT type.** Numbers are sent as strings. This is handled in `buildManyChatActions()`.
- **Test locally with ngrok:** `npx ngrok http 3000` → paste the HTTPS URL into ManyChat temporarily.
