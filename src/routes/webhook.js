// ============================================================
// routes/webhook.js — ASYNC VERSION
// Responds to ManyChat immediately, processes Claude in background,
// then sends reply via ManyChat API. Solves the timeout problem.
// ============================================================

const express = require('express');
const router = express.Router();
const { rateLimit, verifyManychatRequest, validateDMPayload, sanitizeMessage } = require('../utils/security');
const { callClaude } = require('../services/claude');
const { buildPrompt } = require('../prompts/salesAgent');
const { upsertLead, appendConversation, updateLeadCRM, getConversationHistory } = require('../services/database');
const { applyTagsToManyChat, sendDMviaManychat } = require('../services/manychat');
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

    // ── Respond to ManyChat IMMEDIATELY (within 1 second) ──────
    res.json({
      version: 'v2',
      content: {
        messages: [],
      },
    });

    // ── Process everything async AFTER responding ──────────────
    try {
      const lead = await upsertLead({
        subscriber_id,
        instagram_handle,
        full_name,
        source,
        tags: tags || [],
      });

      const conversation_history = await getConversationHistory(lead.id, 8);

      const prompt = buildPrompt({
        lead,
        message_text,
        conversation_history,
        existing_crm: custom_fields || {},
      });

      const claudeOutput = await callClaude(prompt);
      const parsed = parseClaudeResponse(claudeOutput);
      const offerDecision = routeOffer(parsed);
      parsed.offer_recommendation = offerDecision;

      if (parsed.reply_text && subscriber_id) {
        await sendDMviaManychat({
          subscriber_id,
          message_text: parsed.reply_text,
        });
      }

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

      console.log(`[Webhook] Successfully processed DM from ${instagram_handle}`);

    } catch (err) {
      console.error('[Webhook] Async processing error:', err.message);
      try {
        if (subscriber_id) {
          await sendDMviaManychat({
            subscriber_id,
            message_text: "That's a good one — let me get the right person to help you with that. Give me 2 mins 👊",
          });
        }
      } catch (fallbackErr) {
        console.error('[Webhook] Fallback send failed:', fallbackErr.message);
      }
    }
  }
);

function parseClaudeResponse(raw) {
  const clean = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error('[parseClaudeResponse] Failed to parse JSON:', raw);
    return {
      reply_text: "That's a good one — let me get the right person to help you with that. Give me 2 mins 👊",
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
