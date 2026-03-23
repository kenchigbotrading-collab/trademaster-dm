// ============================================================
// TradeMaster DM Automation System — Entry Point
// Stack: Node.js + Express + Supabase + Claude API
// ============================================================

require('dotenv').config();
const express = require('express');
const webhookRouter = require('./routes/webhook');
const followUpRouter = require('./routes/followup');
const analyticsRouter = require('./routes/analytics');

const app = express();
app.use(express.json());

// ── Routes ──────────────────────────────────────────────────
app.use('/webhook', webhookRouter);     // ManyChat inbound DMs
app.use('/followup', followUpRouter);   // Scheduled follow-up triggers
app.use('/analytics', analyticsRouter); // CRM dashboard feed

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Server] Running on port ${PORT}`));
