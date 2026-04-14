/**
 * IndexNow integration for instant indexing on Bing, Yandex, DuckDuckGo, Seznam, Naver.
 * One POST request notifies ALL participating search engines.
 * Google does NOT support IndexNow as of April 2026.
 */

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

/**
 * Submit URLs to IndexNow
 * @param {string} host - Domain without protocol (e.g., 'callbirdai.com')
 * @param {string} apiKey - IndexNow API key
 * @param {string[]} urls - Full URLs to submit (max 10,000)
 */
export async function submitToIndexNow(host, apiKey, urls) {
  if (!urls || urls.length === 0) return { status: 'skipped', message: 'No URLs to submit' };

  // Ensure all URLs are absolute
  const absoluteUrls = urls.map(url =>
    url.startsWith('http') ? url : `https://${host}/${url.replace(/^\//, '')}`
  );

  const payload = {
    host: host,
    key: apiKey,
    keyLocation: `https://${host}/${apiKey}.txt`,
    urlList: absoluteUrls,
  };

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });

  // IndexNow returns 200 for success, 202 for accepted (key validation pending)
  if (response.ok || response.status === 202) {
    return {
      status: 'success',
      httpStatus: response.status,
      urlCount: absoluteUrls.length,
    };
  }

  const errorText = await response.text();
  throw new Error(`IndexNow submission failed (${response.status}): ${errorText}`);
}
