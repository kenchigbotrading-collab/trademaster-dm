// ============================================================
// routes/analytics.js
// Read-only endpoints that power a CRM/pipeline dashboard.
// Use these to feed Retool, Supabase Studio, or a custom UI.
// ============================================================

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Simple API key guard for analytics endpoints
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.ANALYTICS_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── GET /analytics/pipeline ───────────────────────────────────
// Returns lead counts by status — for the top-level funnel view
router.get('/pipeline', requireApiKey, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('lead_status, offer_fit, purchased, call_booked');

    if (error) throw error;

    const pipeline = {
      total: data.length,
      cold: data.filter(l => l.lead_status === 'COLD').length,
      warm: data.filter(l => l.lead_status === 'WARM').length,
      hot: data.filter(l => l.lead_status === 'HOT').length,
      calls_booked: data.filter(l => l.call_booked).length,
      purchased: data.filter(l => l.purchased).length,
      offer_breakdown: {
        free_value: data.filter(l => l.offer_fit === 'free_value').length,
        low_ticket: data.filter(l => l.offer_fit === 'low_ticket').length,
        mid_ticket: data.filter(l => l.offer_fit === 'mid_ticket').length,
        high_ticket: data.filter(l => l.offer_fit === 'high_ticket').length,
      }
    };

    res.json(pipeline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /analytics/leads ──────────────────────────────────────
// Paginated lead list with CRM fields
router.get('/leads', requireApiKey, async (req, res) => {
  try {
    const { page = 1, limit = 50, status, offer_fit } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('leads')
      .select('*')
      .order('last_message_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('lead_status', status);
    if (offer_fit) query = query.eq('offer_fit', offer_fit);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ leads: data, page: Number(page), total: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /analytics/leads/:id/conversation ────────────────────
// Full conversation history for a single lead
router.get('/leads/:id/conversation', requireApiKey, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('lead_id', req.params.id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /analytics/events ─────────────────────────────────────
// Recent conversion events
router.get('/events', requireApiKey, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('events')
      .select('*, leads(instagram_handle, full_name)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /analytics/conversion-rate ───────────────────────────
// Conversion rates by source and offer tier
router.get('/conversion-rate', requireApiKey, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('source, offer_fit, purchased, call_booked, lead_status');

    if (error) throw error;

    // Group by source
    const bySource = {};
    for (const lead of data) {
      const src = lead.source || 'unknown';
      if (!bySource[src]) bySource[src] = { total: 0, purchased: 0, call_booked: 0 };
      bySource[src].total++;
      if (lead.purchased) bySource[src].purchased++;
      if (lead.call_booked) bySource[src].call_booked++;
    }

    Object.keys(bySource).forEach(src => {
      const s = bySource[src];
      s.purchase_rate = s.total ? `${((s.purchased / s.total) * 100).toFixed(1)}%` : '0%';
      s.call_rate = s.total ? `${((s.call_booked / s.total) * 100).toFixed(1)}%` : '0%';
    });

    res.json({ by_source: bySource });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
