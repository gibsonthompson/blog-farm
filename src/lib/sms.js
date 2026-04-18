/**
 * Send SMS via Telnyx API.
 * Used for autopilot notifications when posts need manual review.
 * 
 * Env vars required:
 *   TELNYX_API_KEY - Telnyx API key
 *   TELNYX_FROM_NUMBER - Sending number (e.g. +15055945806)
 *   OWNER_PHONE_NUMBER - Your cell to receive alerts
 */

const TELNYX_API = 'https://api.telnyx.com/v2/messages';

export async function sendSms(message) {
  const apiKey = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_FROM_NUMBER || '+15055945806';
  const to = process.env.OWNER_PHONE_NUMBER;

  if (!apiKey || !to) {
    console.warn('[SMS] Missing TELNYX_API_KEY or OWNER_PHONE_NUMBER — skipping notification');
    return { sent: false, reason: 'missing_config' };
  }

  try {
    const res = await fetch(TELNYX_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        text: message.substring(0, 1600), // Telnyx limit
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[SMS] Telnyx error:', err);
      return { sent: false, error: err };
    }

    return { sent: true };
  } catch (err) {
    console.error('[SMS] Send failed:', err.message);
    return { sent: false, error: err.message };
  }
}