// ============================================================
// services/claude.js
// Wrapper for Anthropic Claude API calls.
// ============================================================

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Call Claude with a structured prompt.
 * @param {{ system: string, messages: Array }} prompt
 * @returns {Promise<string>} Raw text response from Claude
 */
async function callClaude({ system, messages }) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system,
    messages,
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in Claude response');
  return textBlock.text;
}

module.exports = { callClaude };
