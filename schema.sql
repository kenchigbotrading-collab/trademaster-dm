-- ============================================================
-- SUPABASE SCHEMA — TradeMaster DM Automation CRM
-- Run this in Supabase SQL Editor to set up all tables.
-- ============================================================

-- ── LEADS TABLE ───────────────────────────────────────────────
-- One record per Instagram user. Updated on every DM.
CREATE TABLE IF NOT EXISTS leads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id         TEXT UNIQUE NOT NULL,         -- ManyChat subscriber ID
  instagram_handle      TEXT UNIQUE,                  -- @handle
  full_name             TEXT,
  source                TEXT,                         -- reel_comment | story_reply | direct | bio_link
  tags                  TEXT[] DEFAULT '{}',          -- ManyChat tags snapshot

  -- Lead Intelligence
  lead_status           TEXT DEFAULT 'COLD',          -- COLD | WARM | HOT
  lead_score            INTEGER DEFAULT 0,            -- 0–100
  experience_level      TEXT DEFAULT 'unknown',       -- beginner | intermediate | advanced
  budget_signal         TEXT DEFAULT 'unknown',       -- low | medium | high | unknown
  urgency               TEXT DEFAULT 'low',           -- low | medium | high
  conversion_probability INTEGER DEFAULT 0,

  -- Pain & Goals
  pain_points           TEXT[] DEFAULT '{}',
  goals                 TEXT[] DEFAULT '{}',
  objections            TEXT[] DEFAULT '{}',

  -- Offer Routing
  offer_fit             TEXT DEFAULT 'free_value',    -- free_value | low_ticket | mid_ticket | high_ticket

  -- Conversion Tracking
  call_booked           BOOLEAN DEFAULT FALSE,
  call_attended         BOOLEAN DEFAULT FALSE,
  purchased             BOOLEAN DEFAULT FALSE,
  purchase_tier         TEXT,                         -- low | mid | high
  purchase_value        NUMERIC,

  -- Follow-Up State Machine
  next_best_action      TEXT,
  follow_up_needed      BOOLEAN DEFAULT FALSE,
  follow_up_due_at      TIMESTAMPTZ,
  follow_up_scenario    TEXT,
  follow_up_attempt     INTEGER DEFAULT 0,
  last_followup_at      TIMESTAMPTZ,

  -- Timestamps
  first_contact_at      TIMESTAMPTZ DEFAULT NOW(),
  last_message_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── CONVERSATIONS TABLE ────────────────────────────────────────
-- Every DM turn stored here (user message + AI reply + snapshot)
CREATE TABLE IF NOT EXISTS conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE,
  user_message  TEXT NOT NULL,
  ai_reply      TEXT NOT NULL,
  crm_snapshot  JSONB,                    -- Full Claude output JSON for this turn
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── EVENTS TABLE ──────────────────────────────────────────────
-- Tracks conversion and behavioural events
CREATE TABLE IF NOT EXISTS events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID REFERENCES leads(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,             -- call_booked | purchase | link_clicked | no_show | follow_up_sent
  metadata    JSONB,                     -- Additional context
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── OFFER_ROUTES TABLE ────────────────────────────────────────
-- Tracks which offer a lead was routed to and when
CREATE TABLE IF NOT EXISTS offer_routes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID REFERENCES leads(id) ON DELETE CASCADE,
  offer_tier      TEXT NOT NULL,
  routed_at       TIMESTAMPTZ DEFAULT NOW(),
  cta_sent        BOOLEAN DEFAULT FALSE,
  cta_clicked     BOOLEAN DEFAULT FALSE,
  converted       BOOLEAN DEFAULT FALSE
);

-- ── TAGS TABLE ────────────────────────────────────────────────
-- Reference table for valid tags (keep in sync with ManyChat)
CREATE TABLE IF NOT EXISTS tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_name    TEXT UNIQUE NOT NULL,
  category    TEXT,         -- lead_status | experience | pain | goal | offer | action | budget
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_subscriber_id    ON leads(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_leads_instagram_handle ON leads(instagram_handle);
CREATE INDEX IF NOT EXISTS idx_leads_lead_status      ON leads(lead_status);
CREATE INDEX IF NOT EXISTS idx_leads_follow_up        ON leads(follow_up_needed, follow_up_due_at);
CREATE INDEX IF NOT EXISTS idx_conversations_lead_id  ON conversations(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_lead_id         ON events(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type            ON events(event_type);

-- ── ROW-LEVEL SECURITY ────────────────────────────────────────
-- Enable RLS — only service key can write; never expose to client
ALTER TABLE leads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_routes   ENABLE ROW LEVEL SECURITY;

-- ── SEED TAGS ─────────────────────────────────────────────────
INSERT INTO tags (tag_name, category) VALUES
  ('lead:cold',            'lead_status'),
  ('lead:warm',            'lead_status'),
  ('lead:hot',             'lead_status'),
  ('experience:beginner',  'experience'),
  ('experience:intermediate', 'experience'),
  ('experience:advanced',  'experience'),
  ('pain:inconsistency',   'pain'),
  ('pain:blown_account',   'pain'),
  ('pain:no_edge',         'pain'),
  ('pain:emotional',       'pain'),
  ('pain:prop_fail',       'pain'),
  ('goal:funded_account',  'goal'),
  ('goal:full_time',       'goal'),
  ('goal:side_income',     'goal'),
  ('goal:consistency',     'goal'),
  ('offer:low_ticket',     'offer'),
  ('offer:mid_ticket',     'offer'),
  ('offer:high_ticket',    'offer'),
  ('action:book_call',     'action'),
  ('action:send_link',     'action'),
  ('action:nurture',       'action'),
  ('action:followup',      'action'),
  ('budget:low',           'budget'),
  ('budget:medium',        'budget'),
  ('budget:high',          'budget'),
  ('status:no_show',       'status'),
  ('status:call_booked',   'status'),
  ('status:purchased',     'status')
ON CONFLICT (tag_name) DO NOTHING;
