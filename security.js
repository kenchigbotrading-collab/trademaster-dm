// ============================================================
// routes/webhook.js
// Receives inbound DM payload from ManyChat External Request,
// calls Claude, parses structured JSON output, updates Supabase,
// returns reply_text to ManyChat.
// ============================================================

const express = require('express');
const router = express.Router();
const { rateLimit, verifyManychatRequest, validateDMPayload, sanitizeMessage } = require('../utils/security');
const { callClaude } = require('../services/claude');
const { buildPrompt } = require('../prompts/salesAgent');
const { upsertLead, appendConversation, updateLeadCRM } = require('../services/database');
const { applyTagsToManyChat } = require('../services/manychat');
const { routeOffer } = require('../services/offerRouter');

// ── POST /webhook/dm ─────────────────────────────────────────
// ManyChat fires this on every inbound Instagram DM
router.post('/dm',
  rateLimit(30, 60000),
  verifyManychatRequest,
  validateDMPayload,
  sanitizeMessage,
  async (req, res) => {
  try {
    const {
      subscriber_id,        // ManyChat subscriber ID
      instagram_handle,     // e.g. "@user123"
      full_name,            // From ManyChat profile
      message_text,         // The actual DM text
      source,               // e.g. "reel_comment", "story_reply", "direct"
      tags,                 // Existing ManyChat tags array
      custom_fields,        // Existing CRM fields from ManyChat
      conversation_history  // Array of prior messages (ManyChat passes last N)
    } = req.body;

    // ── 1. Upsert lead record in Supabase ──────────────────────
    const lead = await upsertLead({
      subscriber_id,
      instagram_handle,
      full_name,
      source,
      tags: tags || [],
    });

    // ── 2. Build the full Claude prompt ────────────────────────
    const prompt = buildPrompt({
      lead,
      message_text,
      conversation_history: conversation_history || [],
      existing_crm: custom_fields || {},
    });

    // ── 3. Call Claude API ─────────────────────────────────────
    const claudeOutput = await callClaude(prompt);

    // ── 4. Parse Claude's structured JSON response ─────────────
    const parsed = parseClaudeResponse(claudeOutput);

    // ── 5. Run offer routing engine ────────────────────────────
    const offerDecision = routeOffer(parsed);
    parsed.offer_recommendation = offerDecision;

    // ── 6. Store conversation turn in Supabase ─────────────────
    await appendConversation({
      lead_id: lead.id,
      user_message: message_text,
      ai_reply: parsed.reply_text,
      crm_snapshot: parsed,
    });

    // ── 7. Update lead CRM fields in Supabase ──────────────────
    await updateLeadCRM(lead.id, {
      lead_status: parsed.lead_status,
      lead_score: parsed.lead_score,
      experience_level: parsed.experience_level,
      pain_points: parsed.pain_points,
      goals: parsed.goals,
      objections: parsed.objections,
      budget_signal: parsed.budget_signal,
      urgency: parsed.urgency,
      offer_fit: parsed.offer_recommendation,
      next_best_action: parsed.next_best_action,
      follow_up_needed: parsed.follow_up_needed,
      conversion_probability: parsed.conversion_probability,
      last_message_at: new Date().toISOString(),
    });

    // ── 8. Push tag updates back to ManyChat ───────────────────
    if (parsed.tags_to_add?.length || parsed.tags_to_remove?.length) {
      await applyTagsToManyChat({
        subscriber_id,
        tags_to_add: parsed.tags_to_add || [],
        tags_to_remove: parsed.tags_to_remove || [],
      });
    }

    // ── 9. Return reply to ManyChat ────────────────────────────
    // ManyChat reads "messages" array from this response
    return res.json({
      version: 'v2',
      content: {
        messages: [
          {
            type: 'text',
            text: parsed.reply_text,
          },
        ],
        // Optionally set ManyChat custom fields inline:
        actions: buildManyChatActions(parsed),
      },
    });

  } catch (err) {
    console.error('[Webhook] Error:', err);
    // Safe fallback so ManyChat doesn't hang
    return res.json({
      version: 'v2',
      content: {
        messages: [{ type: 'text', text: "Hey, give me one second — I'll get back to you shortly 👊" }],
      },
    });
  }
});

// ── Helpers ──────────────────────────────────────────────────

/**
 * Parse Claude's JSON output. Claude is prompted to return
 * ONLY valid JSON. We strip any accidental markdown fences.
 */
function parseClaudeResponse(raw) {
  const clean = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error('[parseClaudeResponse] Failed to parse JSON:', raw);
    // Fallback: return a safe default with the raw text as reply
    return {
      reply_text: raw,
      lead_status: 'COLD',
      lead_score: 10,
      tags_to_add: [],
      tags_to_remove: [],
      follow_up_needed: true,
      next_best_action: 'manual_review',
    };
  }
}

/**
 * Build ManyChat "actions" array to set custom fields inline
 * (avoids a second API call to ManyChat)
 */
function buildManyChatActions(parsed) {
  return [
    { action: 'set_field', field_name: 'lead_status',   value: parsed.lead_status || 'COLD' },
    { action: 'set_field', field_name: 'lead_score',    value: String(parsed.lead_score || 0) },
    { action: 'set_field', field_name: 'offer_fit',     value: parsed.offer_recommendation || '' },
    { action: 'set_field', field_name: 'next_action',   value: parsed.next_best_action || '' },
    { action: 'set_field', field_name: 'urgency',       value: parsed.urgency || 'low' },
    { action: 'set_field', field_name: 'experience',    value: parsed.experience_level || 'unknown' },
  ];
}

module.exports = router;
