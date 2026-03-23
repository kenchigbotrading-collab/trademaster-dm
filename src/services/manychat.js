// ============================================================
// services/manychat.js
// ManyChat API operations: tag subscribers, send messages,
// update custom fields.
// Docs: https://api.manychat.com
// ============================================================

const axios = require('axios');

const MC_BASE = 'https://api.manychat.com';
const headers = {
  Authorization: `Bearer ${process.env.MANYCHAT_API_KEY}`,
  'Content-Type': 'application/json',
};

// ── TAGS ─────────────────────────────────────────────────────

/**
 * Add and remove ManyChat tags for a subscriber.
 * Tags must already exist in your ManyChat account.
 */
async function applyTagsToManyChat({ subscriber_id, tags_to_add, tags_to_remove }) {
  const promises = [];

  for (const tag of tags_to_add) {
    promises.push(
      axios.post(`${MC_BASE}/fb/subscriber/addTag`, {
        subscriber_id,
        tag_name: tag,
      }, { headers })
    );
  }

  for (const tag of tags_to_remove) {
    promises.push(
      axios.post(`${MC_BASE}/fb/subscriber/removeTag`, {
        subscriber_id,
        tag_name: tag,
      }, { headers })
    );
  }

  await Promise.allSettled(promises); // Don't throw if one tag fails
}

// ── SEND MESSAGE ─────────────────────────────────────────────

/**
 * Proactively send a DM to a subscriber via ManyChat.
 * Used by the follow-up scheduler — NOT the webhook response path.
 * Requires Instagram Messaging permission on the ManyChat account.
 */
async function sendDMviaManychat({ subscriber_id, message_text }) {
  const { data } = await axios.post(
    `${MC_BASE}/fb/sending/sendContent`,
    {
      subscriber_id,
      data: {
        version: 'v2',
        content: {
          messages: [{ type: 'text', text: message_text }],
        },
      },
      message_tag: 'CONFIRMED_EVENT_UPDATE', // Required for Instagram proactive messages
    },
    { headers }
  );

  if (data.status !== 'success') {
    throw new Error(`[sendDMviaManychat] ManyChat error: ${JSON.stringify(data)}`);
  }

  return data;
}

// ── CUSTOM FIELDS ─────────────────────────────────────────────

/**
 * Update ManyChat custom fields for a subscriber.
 * Use this if you need to set fields outside the webhook response.
 */
async function setCustomFields({ subscriber_id, fields }) {
  // fields: { field_name: value, ... }
  const payload = Object.entries(fields).map(([field_name, value]) => ({
    field_name,
    value: String(value),
  }));

  const { data } = await axios.post(
    `${MC_BASE}/fb/subscriber/setCustomFieldByName`,
    { subscriber_id, fields: payload },
    { headers }
  );

  return data;
}

// ── GET SUBSCRIBER INFO ───────────────────────────────────────

/**
 * Fetch subscriber metadata from ManyChat.
 */
async function getSubscriberInfo(subscriber_id) {
  const { data } = await axios.get(
    `${MC_BASE}/fb/subscriber/getInfo?subscriber_id=${subscriber_id}`,
    { headers }
  );
  return data.data;
}

module.exports = {
  applyTagsToManyChat,
  sendDMviaManychat,
  setCustomFields,
  getSubscriberInfo,
};
