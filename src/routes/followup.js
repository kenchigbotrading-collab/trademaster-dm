// ============================================================
// routes/followup.js
// Manual trigger endpoints for follow-up management.
// Also handles conversion event webhooks (call booked, purchase).
// ============================================================

const express = require('express');
const router = express.Router();
const { updateLeadCRM, logEvent, getLeadByHandle } = require('../services/database');
const { runFollowUpJob } = require('../jobs/followUpScheduler');
const { applyTagsToManyChat } = require('../services/manychat');

// Protect manual trigger endpoints
function requireSecret(req, res, next) {
  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// ── POST /followup/run ────────────────────────────────────────
// Manually trigger the follow-up job (useful for testing)
router.post('/run', requireSecret, async (req, res) => {
  try {
    await runFollowUpJob();
    res.json({ status: 'ok', message: 'Follow-up job completed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /followup/event ──────────────────────────────────────
// Receives conversion events from ManyChat automations.
// ManyChat fires this when a tag like status:call_booked is applied.
//
// Example body:
// { "subscriber_id": "...", "instagram_handle": "@user", "event_type": "call_booked" }
router.post('/event', requireSecret, async (req, res) => {
  try {
    const { subscriber_id, instagram_handle, event_type, metadata = {} } = req.body;

    const lead = await getLeadByHandle(instagram_handle);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Log the event
    await logEvent({ lead_id: lead.id, event_type, metadata });

    // Update CRM fields and set the right follow-up scenario
    const crmUpdates = {};
    const tagsToAdd = [];
    const tagsToRemove = [];

    switch (event_type) {
      case 'call_booked':
        crmUpdates.call_booked = true;
        crmUpdates.follow_up_needed = true;
        crmUpdates.follow_up_scenario = 'call_no_show'; // Prepare for potential no-show
        crmUpdates.follow_up_due_at = hoursFromNow(2);  // Check 2hrs before call
        crmUpdates.next_best_action = 'Monitor for call attendance';
        tagsToAdd.push('status:call_booked');
        tagsToRemove.push('action:book_call');
        break;

      case 'call_attended':
        crmUpdates.call_attended = true;
        crmUpdates.follow_up_needed = true;
        crmUpdates.follow_up_scenario = 'hot_ready_to_book'; // Post-call close
        crmUpdates.follow_up_due_at = hoursFromNow(1);
        crmUpdates.next_best_action = 'Send offer/payment link post-call';
        tagsToRemove.push('status:no_show');
        break;

      case 'no_show':
        crmUpdates.call_attended = false;
        crmUpdates.follow_up_needed = true;
        crmUpdates.follow_up_scenario = 'call_no_show';
        crmUpdates.follow_up_due_at = hoursFromNow(2);
        crmUpdates.next_best_action = 'Re-engage no-show with reschedule offer';
        tagsToAdd.push('status:no_show');
        break;

      case 'purchase_low_ticket':
        crmUpdates.purchased = true;
        crmUpdates.purchase_tier = 'low';
        crmUpdates.purchase_value = metadata.value || 0;
        crmUpdates.follow_up_needed = true;
        crmUpdates.follow_up_scenario = 'low_ticket_upsell';
        crmUpdates.follow_up_due_at = hoursFromNow(72);
        crmUpdates.next_best_action = 'Upsell to mid ticket mentorship';
        tagsToAdd.push('status:purchased', 'offer:mid_ticket');
        tagsToRemove.push('offer:low_ticket');
        break;

      case 'purchase_mid_ticket':
        crmUpdates.purchased = true;
        crmUpdates.purchase_tier = 'mid';
        crmUpdates.purchase_value = metadata.value || 0;
        crmUpdates.follow_up_needed = true;
        crmUpdates.follow_up_scenario = 'mid_ticket_upsell';
        crmUpdates.follow_up_due_at = hoursFromNow(168); // 1 week
        crmUpdates.next_best_action = 'Check in on progress. Seed high ticket coaching.';
        tagsToAdd.push('status:purchased', 'offer:high_ticket');
        tagsToRemove.push('offer:mid_ticket');
        break;

      case 'purchase_high_ticket':
        crmUpdates.purchased = true;
        crmUpdates.purchase_tier = 'high';
        crmUpdates.purchase_value = metadata.value || 0;
        crmUpdates.follow_up_needed = false;
        crmUpdates.next_best_action = 'Onboard to mentorship programme';
        tagsToAdd.push('status:purchased');
        break;

      case 'link_clicked':
        crmUpdates.follow_up_needed = true;
        crmUpdates.follow_up_scenario = 'clicked_no_buy';
        crmUpdates.follow_up_due_at = hoursFromNow(6);
        crmUpdates.next_best_action = 'Follow up on clicked link — address objections';
        break;

      default:
        console.warn(`[FollowUp Event] Unknown event_type: ${event_type}`);
    }

    await updateLeadCRM(lead.id, crmUpdates);

    if ((tagsToAdd.length || tagsToRemove.length) && subscriber_id) {
      await applyTagsToManyChat({ subscriber_id, tags_to_add: tagsToAdd, tags_to_remove: tagsToRemove });
    }

    res.json({ status: 'ok', event_type, crm_updates: crmUpdates });
  } catch (err) {
    console.error('[FollowUp Event] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /followup/suppress ───────────────────────────────────
// Manually suppress follow-ups for a lead (e.g. you're handling manually)
router.post('/suppress', requireSecret, async (req, res) => {
  try {
    const { instagram_handle } = req.body;
    const lead = await getLeadByHandle(instagram_handle);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await updateLeadCRM(lead.id, {
      follow_up_needed: false,
      follow_up_scenario: null,
      next_best_action: 'Manual handling — follow-ups suppressed',
    });

    res.json({ status: 'ok', message: `Follow-ups suppressed for ${instagram_handle}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 3600000).toISOString();
}

module.exports = router;
