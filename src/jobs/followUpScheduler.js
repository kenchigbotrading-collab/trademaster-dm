// ============================================================
// jobs/followUpScheduler.js
// Cron job that runs every 15 minutes.
// Fetches leads with follow_up_needed = true and
// follow_up_due_at <= now, generates a contextual follow-up
// message via Claude, and fires it via ManyChat.
//
// Deploy this as a separate worker process, or use:
// - Railway cron
// - Render cron job
// - Supabase Edge Functions (scheduled)
// - GitHub Actions schedule
// ============================================================

const cron = require('node-cron');
const { getLeadsForFollowUp, updateLeadCRM, appendConversation, getConversationHistory } = require('../services/database');
const { callClaude } = require('../services/claude');
const { sendDMviaManychat, applyTagsToManyChat } = require('../services/manychat');

// ── Follow-Up Scenarios ────────────────────────────────────────
// Each scenario has a trigger condition, delay, and prompt strategy.

const FOLLOW_UP_SCENARIOS = {
  // Lead came in, AI responded, lead went silent
  no_reply_after_first: {
    delay_hours: 24,
    max_attempts: 2,
    prompt_strategy: 'Re-engage with a curiosity hook. Ask one question. No pitch.',
  },

  // Lead engaged, expressed interest, but has not taken action
  warm_not_ready: {
    delay_hours: 48,
    max_attempts: 3,
    prompt_strategy: 'Send value. Share a relevant insight or result. No direct CTA yet.',
  },

  // Lead clicked a link but did not purchase
  clicked_no_buy: {
    delay_hours: 6,
    max_attempts: 2,
    prompt_strategy: 'Address objections. Ask what held them back. Handle friction gently.',
  },

  // Lead booked a call but did not show up
  call_no_show: {
    delay_hours: 2,
    max_attempts: 2,
    prompt_strategy: 'Acknowledge no-show casually. Offer to reschedule. Keep it light.',
  },

  // Low ticket buyer — upsell to mid ticket
  low_ticket_upsell: {
    delay_hours: 72,
    max_attempts: 1,
    prompt_strategy: 'Acknowledge their purchase. Bridge to next level. Position the mentorship.',
  },

  // Mid ticket buyer — upsell to high ticket
  mid_ticket_upsell: {
    delay_hours: 168, // 1 week
    max_attempts: 1,
    prompt_strategy: 'Check in on progress. Open the door to 1-1 coaching naturally.',
  },

  // HOT lead ready to book — push hard CTA
  hot_ready_to_book: {
    delay_hours: 4,
    max_attempts: 3,
    prompt_strategy: 'Be direct. Ask if they are open to a call. Send the link immediately if yes.',
  },
};

// ── Follow-Up Prompt Builder ──────────────────────────────────

function buildFollowUpPrompt({ lead, scenario, history, attempt }) {
  const config = FOLLOW_UP_SCENARIOS[scenario] || FOLLOW_UP_SCENARIOS.no_reply_after_first;

  const system = `
You are sending a follow-up DM on behalf of a trading education brand.
Your goal: ${config.prompt_strategy}

Rules:
- This is attempt ${attempt} of ${config.max_attempts}
- Keep it SHORT (1–3 sentences max)
- Sound human, not automated
- Do NOT reveal this is automated
- Match the lead's previous tone and energy
- If on final attempt, make it the last outreach and keep door open

Current lead status: ${lead.lead_status}
Offer they are being routed to: ${lead.offer_fit || 'free_value'}

Respond ONLY with valid JSON:
{
  "reply_text": "The follow-up DM to send",
  "tags_to_add": [],
  "tags_to_remove": [],
  "follow_up_needed": true | false,
  "follow_up_delay_hours": number,
  "follow_up_scenario": "scenario_name"
}
`;

  const userContent = `
Lead name: ${lead.full_name || 'unknown'}
Scenario: ${scenario}
Conversation history:
${history.map(m => `[${m.role}]: ${m.text}`).join('\n') || 'No prior conversation.'}

Generate the follow-up message.
`;

  return { system, messages: [{ role: 'user', content: userContent }] };
}

// ── Main Job ──────────────────────────────────────────────────

async function runFollowUpJob() {
  console.log('[FollowUp] Running follow-up job at', new Date().toISOString());

  const leads = await getLeadsForFollowUp();
  console.log(`[FollowUp] Found ${leads.length} leads due for follow-up`);

  for (const lead of leads) {
    try {
      const history = await getConversationHistory(lead.id, 6);
      const scenario = lead.follow_up_scenario || 'no_reply_after_first';
      const attempt = (lead.follow_up_attempt || 0) + 1;
      const config = FOLLOW_UP_SCENARIOS[scenario];

      // Stop if max attempts reached
      if (config && attempt > config.max_attempts) {
        await updateLeadCRM(lead.id, {
          follow_up_needed: false,
          follow_up_scenario: null,
          next_best_action: 'max_follow_up_reached',
        });
        continue;
      }

      const prompt = buildFollowUpPrompt({ lead, scenario, history, attempt });
      const rawOutput = await callClaude(prompt);

      let parsed;
      try {
        parsed = JSON.parse(rawOutput.replace(/```json|```/g, '').trim());
      } catch {
        console.error(`[FollowUp] Failed to parse Claude output for lead ${lead.id}`);
        continue;
      }

      // Send the DM
      await sendDMviaManychat({
        subscriber_id: lead.subscriber_id,
        message_text: parsed.reply_text,
      });

      // Apply tag updates
      if (parsed.tags_to_add?.length || parsed.tags_to_remove?.length) {
        await applyTagsToManyChat({
          subscriber_id: lead.subscriber_id,
          tags_to_add: parsed.tags_to_add || [],
          tags_to_remove: parsed.tags_to_remove || [],
        });
      }

      // Log the follow-up as a conversation turn
      await appendConversation({
        lead_id: lead.id,
        user_message: '[follow_up_trigger]',
        ai_reply: parsed.reply_text,
        crm_snapshot: { scenario, attempt },
      });

      // Update follow-up scheduling
      const nextDue = parsed.follow_up_needed
        ? new Date(Date.now() + (parsed.follow_up_delay_hours || 24) * 3600000).toISOString()
        : null;

      await updateLeadCRM(lead.id, {
        follow_up_needed: parsed.follow_up_needed,
        follow_up_due_at: nextDue,
        follow_up_attempt: attempt,
        follow_up_scenario: parsed.follow_up_scenario || scenario,
        last_followup_at: new Date().toISOString(),
      });

      console.log(`[FollowUp] Sent follow-up to ${lead.instagram_handle} (${scenario}, attempt ${attempt})`);

    } catch (err) {
      console.error(`[FollowUp] Error processing lead ${lead.id}:`, err.message);
    }
  }
}

// ── Schedule: every 15 minutes ────────────────────────────────
cron.schedule('*/15 * * * *', runFollowUpJob);

// Also export for manual triggering
module.exports = { runFollowUpJob };
