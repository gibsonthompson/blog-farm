import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import supabase from './supabase.js';

function getClient() {
  const keyJson = JSON.parse(
    Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf-8')
  );
  return new JWT({
    email: keyJson.client_email,
    key: keyJson.private_key,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
}

/**
 * Pull performance data from GSC Search Analytics for all blog posts.
 * Returns clicks, impressions, CTR, and average position per URL.
 * 
 * @param {string} siteUrl - e.g., 'https://callbirdai.com/'
 * @param {number} days - How many days to look back (default 28)
 */
export async function fetchBlogPerformance(siteUrl, days = 28) {
  const client = getClient();
  const searchconsole = google.searchconsole({ version: 'v1', auth: client });

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const response = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      dimensions: ['page'],
      dimensionFilterGroups: [{
        filters: [{
          dimension: 'page',
          operator: 'contains',
          expression: '/blog-',
        }],
      }],
      rowLimit: 500,
      type: 'web',
    },
  });

  const rows = (response.data.rows || []).map(row => ({
    url: row.keys[0],
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Math.round(row.ctr * 10000) / 100, // Convert to percentage
    position: Math.round(row.position * 10) / 10,
  }));

  return rows.sort((a, b) => b.clicks - a.clicks);
}

/**
 * Comprehensive performance analysis.
 * Categorizes posts into winners, steady, underperformers, and unindexed.
 */
export async function analyzePerformance(businessId, siteUrl, days = 28) {
  // Get performance data from GSC
  const performance = await fetchBlogPerformance(siteUrl, days);

  // Get all published posts from DB
  const { data: publishedPosts } = await supabase
    .from('blog_existing_posts')
    .select('url, title, slug, primary_keyword, category, publish_date')
    .eq('business_id', businessId);

  const perfMap = new Map(performance.map(p => [p.url, p]));
  const now = new Date();

  const winners = [];       // High clicks/impressions
  const steady = [];        // Some traffic, room to grow
  const underperformers = []; // Published 30+ days, low/no traffic
  const unindexed = [];     // No data at all (probably not indexed)
  const tooNew = [];        // Published less than 14 days ago

  for (const post of (publishedPosts || [])) {
    const publishDate = post.publish_date ? new Date(post.publish_date) : null;
    const daysSincePublish = publishDate
      ? Math.floor((now - publishDate) / (1000 * 60 * 60 * 24))
      : 999;

    // Try matching with and without trailing slash, with and without .html
    const urlVariants = [
      post.url,
      post.url.replace(/\.html$/, ''),
      post.url + '/',
    ];

    let perf = null;
    for (const variant of urlVariants) {
      if (perfMap.has(variant)) {
        perf = perfMap.get(variant);
        break;
      }
    }
    // Also check by slug match in URL
    if (!perf) {
      for (const [url, data] of perfMap) {
        if (url.includes(post.slug)) {
          perf = data;
          break;
        }
      }
    }

    const entry = {
      ...post,
      daysSincePublish,
      clicks: perf?.clicks || 0,
      impressions: perf?.impressions || 0,
      ctr: perf?.ctr || 0,
      position: perf?.position || 0,
    };

    if (daysSincePublish < 14) {
      tooNew.push(entry);
    } else if (!perf || perf.impressions === 0) {
      unindexed.push(entry);
    } else if (perf.clicks >= 10 && perf.ctr >= 3) {
      winners.push(entry);
    } else if (perf.impressions >= 50) {
      steady.push(entry);
    } else {
      underperformers.push(entry);
    }
  }

  // Sort each category
  winners.sort((a, b) => b.clicks - a.clicks);
  steady.sort((a, b) => b.impressions - a.impressions);
  underperformers.sort((a, b) => a.daysSincePublish - b.daysSincePublish);

  return {
    period: `${days} days`,
    winners,
    steady,
    underperformers,
    unindexed,
    tooNew,
    summary: {
      totalPosts: publishedPosts?.length || 0,
      totalClicks: performance.reduce((sum, p) => sum + p.clicks, 0),
      totalImpressions: performance.reduce((sum, p) => sum + p.impressions, 0),
      avgPosition: performance.length > 0
        ? Math.round(performance.reduce((sum, p) => sum + p.position, 0) / performance.length * 10) / 10
        : 0,
      winnersCount: winners.length,
      underperformersCount: underperformers.length,
      unindexedCount: unindexed.length,
    },
    // Insights for the content strategist
    insights: generateInsights(winners, underperformers, unindexed, publishedPosts || []),
  };
}

/**
 * Generate actionable insights from performance data.
 * These feed back into the content strategist's recommendations.
 */
function generateInsights(winners, underperformers, unindexed, allPosts) {
  const insights = [];

  // What categories perform best?
  const catPerf = {};
  for (const post of [...winners, ...underperformers]) {
    const cat = post.category || 'unknown';
    if (!catPerf[cat]) catPerf[cat] = { clicks: 0, count: 0 };
    catPerf[cat].clicks += post.clicks;
    catPerf[cat].count++;
  }

  const bestCat = Object.entries(catPerf).sort((a, b) => (b[1].clicks / b[1].count) - (a[1].clicks / a[1].count))[0];
  if (bestCat) {
    insights.push(`Best performing category: "${bestCat[0]}" (avg ${Math.round(bestCat[1].clicks / bestCat[1].count)} clicks/post)`);
  }

  // Unindexed alerts
  if (unindexed.length > 0) {
    const oldUnindexed = unindexed.filter(p => p.daysSincePublish > 30);
    if (oldUnindexed.length > 0) {
      insights.push(`${oldUnindexed.length} post(s) published 30+ days ago still not indexed — may need internal linking or content quality review`);
    }
  }

  // Underperformer patterns
  if (underperformers.length > 3) {
    const types = underperformers.map(p => p.category).filter(Boolean);
    const typeCount = {};
    types.forEach(t => { typeCount[t] = (typeCount[t] || 0) + 1; });
    const worstType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0];
    if (worstType && worstType[1] >= 3) {
      insights.push(`"${worstType[0]}" posts underperform most (${worstType[1]} underperformers) — consider different angles for this category`);
    }
  }

  // High impressions but low CTR = title/meta needs improvement
  const highImpLowCTR = [...winners, ...underperformers]
    .filter(p => p.impressions > 100 && p.ctr < 2);
  if (highImpLowCTR.length > 0) {
    insights.push(`${highImpLowCTR.length} post(s) have high impressions but low CTR (<2%) — title/meta description may need improvement`);
  }

  return insights;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}