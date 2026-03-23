// ============================================================
// services/offerRouter.js
// Deterministic offer routing engine.
// Takes Claude's CRM output and decides final offer tier.
// Claude suggests; this engine confirms or overrides based on
// hard business rules.
// ============================================================

const OFFER_TIERS = {
  FREE_VALUE: 'free_value',
  LOW_TICKET: 'low_ticket',
  MID_TICKET: 'mid_ticket',
  HIGH_TICKET: 'high_ticket',
};

/**
 * Route a lead to the correct offer tier.
 *
 * Rules (in priority order):
 * 1. HOT + high urgency + high/medium budget → high_ticket
 * 2. HOT + any urgency → mid_ticket (at minimum)
 * 3. WARM + medium/high budget + medium/high urgency → mid_ticket
 * 4. WARM + low budget or low urgency → low_ticket
 * 5. COLD → free_value (keep nurturing)
 *
 * Claude's suggestion is used as a tiebreaker if score is on a boundary.
 *
 * @param {Object} claudeOutput - Parsed JSON from Claude
 * @returns {string} - One of the OFFER_TIERS values
 */
function routeOffer(claudeOutput) {
  const {
    lead_status,
    lead_score,
    budget_signal,
    urgency,
    experience_level,
    offer_recommendation: claudeSuggestion,
  } = claudeOutput;

  const score = Number(lead_score) || 0;
  const isHot = lead_status === 'HOT' || score >= 66;
  const isWarm = lead_status === 'WARM' || (score >= 36 && score < 66);
  const isCold = !isHot && !isWarm;

  const highBudget = budget_signal === 'high';
  const medBudget = budget_signal === 'medium';
  const highUrgency = urgency === 'high';
  const medUrgency = urgency === 'medium';
  const isAdvanced = experience_level === 'advanced';
  const isIntermediate = experience_level === 'intermediate';

  // ── Rule 1: Classic high-ticket candidate ──────────────────
  if (isHot && (highBudget || (medBudget && highUrgency)) && (isAdvanced || isIntermediate)) {
    return OFFER_TIERS.HIGH_TICKET;
  }

  // ── Rule 2: Hot but softer signals → mid or high ──────────
  if (isHot) {
    if (highBudget || isAdvanced) return OFFER_TIERS.HIGH_TICKET;
    return OFFER_TIERS.MID_TICKET;
  }

  // ── Rule 3: Warm + intent → mid ticket ────────────────────
  if (isWarm && (highBudget || medBudget) && (highUrgency || medUrgency)) {
    return OFFER_TIERS.MID_TICKET;
  }

  // ── Rule 4: Warm but lukewarm signals → low ticket ────────
  if (isWarm) {
    // Trust Claude if it says mid — it may have picked up nuance
    if (claudeSuggestion === OFFER_TIERS.MID_TICKET) return OFFER_TIERS.MID_TICKET;
    return OFFER_TIERS.LOW_TICKET;
  }

  // ── Rule 5: Cold → keep nurturing ─────────────────────────
  return OFFER_TIERS.FREE_VALUE;
}

/**
 * Returns the CTA message component for each offer tier.
 * Used by follow-up sequences to inject the right CTA.
 */
function getOfferCTA(tier) {
  const ctas = {
    [OFFER_TIERS.FREE_VALUE]: {
      action: 'send_free_content',
      message_hint: 'Send a relevant free resource, tip, or insight. No pitch.',
    },
    [OFFER_TIERS.LOW_TICKET]: {
      action: 'send_low_ticket_link',
      message_hint: 'Soft pitch the course or signals. Mention the price casually.',
    },
    [OFFER_TIERS.MID_TICKET]: {
      action: 'send_mid_ticket_link',
      message_hint: 'Position the mentorship programme. Emphasise structure and results.',
    },
    [OFFER_TIERS.HIGH_TICKET]: {
      action: 'send_call_booking_link',
      message_hint: 'Push for a call. Be direct. "Are you open to a quick call this week?"',
    },
  };

  return ctas[tier] || ctas[OFFER_TIERS.FREE_VALUE];
}

module.exports = { routeOffer, getOfferCTA, OFFER_TIERS };
