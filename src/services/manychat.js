// ============================================================
// services/manychat.js
// ManyChat API operations.
// ============================================================

const axios = require('axios');

const MC_BASE = 'https://api.manychat.com';
const headers = () => ({
  Authorization: `Bearer ${process.env.MANYCHAT_API_KEY}`,
  'Content-Type': 'application/json',
});

/**
 * Send a DM to a subscriber via ManyChat Send Content API.
 * Uses ACCOUNT_UPDATE tag which works within 24hr window.
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
      message_tag: 'ACCOUNT_UPDATE',
    },
    { headers: headers() }
  );

  if (data.status !== 'success') {
    throw new Error(`ManyChat error: ${JSON.stringify(data)}`);
  }
  return data;
}

/**
 * Add and remove ManyChat tags for a subscriber.
 */
async function applyTagsToManyChat({ subscriber_id, tags_to_add, tags_to_remove }) {
  const promises = [];

  for (const tag of (tags_to_add || [])) {
    promises.push(
      axios.post(`${MC_BASE}/fb/subscriber/addTag`, {
        subscriber_id,
        tag_name: tag,
      }, { headers: headers() }).catch(e => console.warn(`[Tag add failed] ${tag}:`, e.message))
    );
  }

  for (const tag of (tags_to_remove || [])) {
    promises.push(
      axios.post(`${MC_BASE}/fb/subscriber/removeTag`, {
        subscriber_id,
        tag_name: tag,
      }, { headers: headers() }).catch(e => console.warn(`[Tag remove failed] ${tag}:`, e.message))
    );
  }

  await Promise.allSettled(promises);
}

/**
 * Update ManyChat custom fields for a subscriber.
 */
async function setCustomFields({ subscriber_id, fields }) {
  const payload = Object.entries(fields).map(([field_name, value]) => ({
    field_name,
    value: String(value),
  }));

  const { data } = await axios.post(
    `${MC_BASE}/fb/subscriber/setCustomFieldByName`,
    { subscriber_id, fields: payload },
    { headers: headers() }
  );
  return data;
}

module.exports = {
  sendDMviaManychat,
  applyTagsToManyChat,
  setCustomFields,
};
