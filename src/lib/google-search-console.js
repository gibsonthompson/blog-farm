import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

function getClient() {
  const keyJson = JSON.parse(
    Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf-8')
  );

  return new JWT({
    email: keyJson.client_email,
    key: keyJson.private_key,
    scopes: [
      'https://www.googleapis.com/auth/webmasters',
      'https://www.googleapis.com/auth/webmasters.readonly',
    ],
  });
}

/**
 * Submit/re-submit a sitemap to Google Search Console
 * This notifies Google that the sitemap has been updated
 */
export async function submitSitemap(siteUrl, sitemapUrl) {
  const client = getClient();
  google.options({ auth: client });
  const searchconsole = google.searchconsole('v1');

  // Use the webmasters v3 API for sitemap submission
  const webmasters = google.webmasters({ version: 'v3', auth: client });

  await webmasters.sitemaps.submit({
    siteUrl: siteUrl,     // e.g., 'https://callbirdai.com/'
    feedpath: sitemapUrl,  // e.g., 'https://callbirdai.com/sitemap.xml'
  });

  return { submitted: true, sitemapUrl };
}

/**
 * Check if a URL is indexed via URL Inspection API
 * Use this to monitor indexing status after publishing
 */
export async function inspectUrl(siteUrl, inspectionUrl) {
  const client = getClient();
  google.options({ auth: client });
  const searchconsole = google.searchconsole('v1');

  const result = await searchconsole.urlInspection.index.inspect({
    requestBody: {
      inspectionUrl: inspectionUrl,
      siteUrl: siteUrl,
      languageCode: 'en-US',
    },
  });

  const verdict = result.data?.inspectionResult?.indexStatusResult?.verdict;
  const coverageState = result.data?.inspectionResult?.indexStatusResult?.coverageState;

  return {
    url: inspectionUrl,
    verdict,        // 'PASS', 'NEUTRAL', 'FAIL', etc.
    coverageState,  // 'Submitted and indexed', 'Crawled - currently not indexed', etc.
    isIndexed: verdict === 'PASS',
    raw: result.data,
  };
}

/**
 * List all sitemaps for a property
 */
export async function listSitemaps(siteUrl) {
  const client = getClient();
  const webmasters = google.webmasters({ version: 'v3', auth: client });

  const result = await webmasters.sitemaps.list({ siteUrl });
  return result.data?.sitemap || [];
}
