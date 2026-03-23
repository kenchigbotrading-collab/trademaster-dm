// ============================================================
// services/database.js
// All Supabase read/write operations for the CRM system.
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // Service key — server-side only
);

// ── LEADS ─────────────────────────────────────────────────────

/**
 * Insert or update a lead record.
 * Uses instagram_handle as the unique key.
 */
async function upsertLead({ subscriber_id, instagram_handle, full_name, source, tags }) {
  const { data, error } = await supabase
    .from('leads')
    .upsert(
      {
        subscriber_id,
        instagram_handle,
        full_name,
        source,
        tags,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'instagram_handle', returning: 'representation' }
    )
    .select()
    .single();

  if (error) throw new Error(`[upsertLead] ${error.message}`);
  return data;
}

/**
 * Update CRM intelligence fields on a lead record.
 */
async function updateLeadCRM(lead_id, fields) {
  const { error } = await supabase
    .from('leads')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', lead_id);

  if (error) throw new Error(`[updateLeadCRM] ${error.message}`);
}

/**
 * Fetch a single lead by Instagram handle (for follow-up jobs).
 */
async function getLeadByHandle(instagram_handle) {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('instagram_handle', instagram_handle)
    .single();

  if (error) throw new Error(`[getLeadByHandle] ${error.message}`);
  return data;
}

/**
 * Fetch all leads needing follow-up (for the scheduler job).
 */
async function getLeadsForFollowUp() {
  const now = new Date();
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('follow_up_needed', true)
    .lte('follow_up_due_at', now.toISOString())
    .order('follow_up_due_at', { ascending: true });

  if (error) throw new Error(`[getLeadsForFollowUp] ${error.message}`);
  return data || [];
}

// ── CONVERSATIONS ─────────────────────────────────────────────

/**
 * Append a conversation turn (user message + AI reply + CRM snapshot).
 */
async function appendConversation({ lead_id, user_message, ai_reply, crm_snapshot }) {
  const { error } = await supabase
    .from('conversations')
    .insert({
      lead_id,
      user_message,
      ai_reply,
      crm_snapshot,
      created_at: new Date().toISOString(),
    });

  if (error) throw new Error(`[appendConversation] ${error.message}`);
}

/**
 * Fetch last N conversation turns for a lead (to pass as history to Claude).
 */
async function getConversationHistory(lead_id, limit = 10) {
  const { data, error } = await supabase
    .from('conversations')
    .select('user_message, ai_reply, created_at')
    .eq('lead_id', lead_id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`[getConversationHistory] ${error.message}`);

  // Reverse to chronological order and format for Claude
  return (data || []).reverse().flatMap(row => [
    { role: 'user', text: row.user_message },
    { role: 'assistant', text: row.ai_reply },
  ]);
}

// ── EVENTS ────────────────────────────────────────────────────

/**
 * Log a conversion event (link click, purchase, call booked, etc.)
 */
async function logEvent({ lead_id, event_type, metadata }) {
  const { error } = await supabase
    .from('events')
    .insert({
      lead_id,
      event_type,  // e.g. "call_booked", "purchase_low_ticket", "link_clicked"
      metadata,
      created_at: new Date().toISOString(),
    });

  if (error) throw new Error(`[logEvent] ${error.message}`);
}

module.exports = {
  upsertLead,
  updateLeadCRM,
  getLeadByHandle,
  getLeadsForFollowUp,
  appendConversation,
  getConversationHistory,
  logEvent,
};
