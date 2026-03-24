// ============================================================
// routes/webhook.js — FAST SYNC VERSION
// Responds directly to ManyChat with Claude's reply.
// Optimised to stay under 10 second timeout.
// ============================================================

const express = require('express');
const router = express.Router();
const { rateLimit, verifyManychatRequest, validateDMPayload, sanitizeMessage } = require('../utils/security');
const { callClaude } = require('../services/claude');
const { buildPrompt } = require('../prompts/salesAgent');
const { upsertLead, appendConversation, updateLeadCRM } = require('../services/database');
const { applyTagsToManyChat } = require('../services/manychat');
const { routeOffer } = require('../services/offerRouter');

router.post('/dm',
  rateLimit(30, 60000),
  verifyManychatRequest,
  validateDMPayload,
  sanitizeMessage,
  async (req, res) => {
    const {
      subscriber_id,
      instagram_handle,
      full_name,
      message_text,
      source,
      tags,
      custom_fields,
    } = req.body;

    try {
      // ── 1. Upsert lead (fast) ──────────────────────────────
      const lead = await upsertLead({
        subscriber_id,
        instagram_handle,
        full_name,
        source,
        tags: tags || [],
      });

      // ── 2. Call Claude ─────────────────────────────────────
      const prompt = buildPrompt({
        lead,
        message_text,
        conversation_history: [],
        existing_crm: custom_fields || {},
      });

      const claudeOutput = await callClaude(prompt);
      const parsed = parseClaudeResponse(claudeOutput);
      const offerDecision = routeOffer(parsed);
      parsed.offer_recommendation = offerDecision;

      // ── 3. Reply to ManyChat immediately ───────────────────
      res.json({
        version: 'v2',
        content: {
          messages: [
            { type: 'text', text: parsed.reply_text || "Give me 2 mins 👊" },
          ],
        },
      });

      // ── 4. Save to DB in background (after response sent) ──
      setImmediate(async () => {
        try {
          await appendConversation({
            lead_id: lead.id,
            user_message: message_text,
            ai_reply: parsed.reply_text || '',
            crm_snapshot: parsed,
          });

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

          if (parsed.tags_to_add?.length || parsed.tags_to_remove?.length) {
            await applyTagsToManyChat({
              subscriber_id,
              tags_to_add: parsed.tags_to_add || [],
              tags_to_remove: parsed.tags_to_remove || [],
            });
          }

          console.log(`[Webhook] CRM updated for ${instagram_handle}`);
        } catch (bgErr) {
          console.error('[Webhook] Background update error:', bgErr.message);
        }
      });

    } catch (err) {
      console.error('[Webhook] Error:', err.message);
      res.json({
        version: 'v2',
        content: {
          messages: [{ type: 'text', text: "Give me 2 mins, I'll get back to you 👊" }],
        },
      });
    }
  }
);

function parseClaudeResponse(raw) {
  const clean = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error('[parseClaudeResponse] Failed to parse JSON');
    return {
      reply_text: "Give me 2 mins, I'll get back to you 👊",
      lead_status: 'COLD',
      lead_score: 10,
      tags_to_add: [],
      tags_to_remove: [],
      follow_up_needed: true,
      next_best_action: 'manual_review',
    };
  }
}

module.exports = router;
