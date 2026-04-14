import Anthropic from '@anthropic-ai/sdk';
import supabase from './supabase.js';
import { fetchFileContent, commitMultipleFiles } from './github.js';
import { submitSitemap } from './google-search-console.js';
import { submitToIndexNow } from './indexnow.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STALE_THRESHOLD_DAYS = 90;

/**
 * Scan all published posts and identify ones needing refresh.
 * Checks for: age, outdated year references, stale pricing, competitor data.
 * 
 * @returns {{ stale: Array, healthy: Array, stats: Object }}
 */
export async function scanForStaleContent(businessId) {
  const { data: posts } = await supabase
    .from('blog_existing_posts')
    .select('*')
    .eq('business_id', businessId)
    .order('publish_date', { ascending: true });

  if (!posts || posts.length === 0) return { stale: [], healthy: [], stats: {} };

  const now = new Date();
  const currentYear = now.getFullYear();
  const stale = [];
  const healthy = [];

  for (const post of posts) {
    const reasons = [];
    const publishDate = post.publish_date ? new Date(post.publish_date) : null;
    const daysSincePublish = publishDate
      ? Math.floor((now - publishDate) / (1000 * 60 * 60 * 24))
      : 999;

    // Check 1: Age
    if (daysSincePublish > STALE_THRESHOLD_DAYS) {
      reasons.push(`Published ${daysSincePublish} days ago (threshold: ${STALE_THRESHOLD_DAYS})`);
    }

    // Check 2: Year in title/slug is outdated
    const titleYear = extractYear(post.title);
    if (titleYear && titleYear < currentYear) {
      reasons.push(`Title references ${titleYear}, current year is ${currentYear}`);
    }

    // Check 3: Comparison posts are high-priority for refresh (competitor pricing changes)
    if (post.category === 'comparison' && daysSincePublish > 60) {
      reasons.push('Comparison post — competitor pricing/features may have changed');
    }

    // Check 4: Statistics posts go stale fastest
    if (post.category === 'statistics' && daysSincePublish > 45) {
      reasons.push('Statistics post — data points need quarterly refresh');
    }

    // Check 5: Cost analysis with outdated salary/pricing data
    if (post.category === 'cost-analysis' && daysSincePublish > 90) {
      reasons.push('Cost analysis — salary and pricing data may be outdated');
    }

    if (reasons.length > 0) {
      stale.push({
        ...post,
        daysSincePublish,
        staleReasons: reasons,
        priority: calculateRefreshPriority(post, daysSincePublish, reasons),
      });
    } else {
      healthy.push(post);
    }
  }

  // Sort stale by priority (highest first)
  stale.sort((a, b) => b.priority - a.priority);

  return {
    stale,
    healthy,
    stats: {
      total: posts.length,
      staleCount: stale.length,
      healthyCount: healthy.length,
      stalePercent: Math.round((stale.length / posts.length) * 100),
      oldestPost: posts[0]?.title,
      oldestDate: posts[0]?.publish_date,
    },
  };
}

/**
 * Analyze a specific post's content and generate refresh recommendations.
 * Uses Claude to identify what specifically needs updating.
 */
export async function analyzePostForRefresh(businessId, slug, owner, repo, branch, blogPrefix) {
  const filePath = `${blogPrefix}${slug}.html`;
  const file = await fetchFileContent(owner, repo, filePath, branch);
  if (!file) throw new Error(`File not found: ${filePath}`);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    messages: [{
      role: 'user',
      content: `Analyze this blog post for staleness. Identify what needs updating.
Current date: ${new Date().toISOString().split('T')[0]}

The post HTML:
${file.content.substring(0, 8000)}

Check for:
1. Outdated year references (should be ${new Date().getFullYear()})
2. Pricing that may have changed (search for current competitor pricing if it's a comparison post)
3. Statistics with no source or from before 2025
4. Claims about features that may have changed
5. Missing content that would improve the post based on current search trends

Return JSON:
{
  "needs_refresh": true/false,
  "urgency": "high/medium/low",
  "outdated_items": [{"what": "description", "current": "what it says", "should_be": "what it should say"}],
  "missing_content": ["topics/sections that should be added"],
  "year_references_to_update": ["list of year strings to find/replace"],
  "estimated_effort": "minor (find-replace) / moderate (rewrite sections) / major (significant rewrite)"
}

Return ONLY valid JSON.`
    }],
  });

  const textBlocks = response.content.filter(b => b.type === 'text');
  const text = textBlocks.map(b => b.text).join('\n').trim();

  try {
    return JSON.parse(text.replace(/```json\n?|```/g, '').trim());
  } catch {
    return { needs_refresh: true, urgency: 'medium', outdated_items: [], missing_content: [], year_references_to_update: [], estimated_effort: 'unknown' };
  }
}

/**
 * Apply a simple year refresh to a post (find/replace year references).
 * For minor updates — changes year in title, headings, schema, and meta.
 * Also updates dateModified.
 */
export async function applyYearRefresh(owner, repo, branch, blogPrefix, slug, oldYear, newYear) {
  const filePath = `${blogPrefix}${slug}.html`;
  const file = await fetchFileContent(owner, repo, filePath, branch);
  if (!file) throw new Error(`File not found: ${filePath}`);

  let html = file.content;
  const today = new Date().toISOString().split('T')[0];

  // Replace year references
  const yearPattern = new RegExp(`\\b${oldYear}\\b`, 'g');
  html = html.replace(yearPattern, String(newYear));

  // Update dateModified
  const dateModPattern = /"dateModified"\s*:\s*"[^"]+"/;
  if (dateModPattern.test(html)) {
    html = html.replace(dateModPattern, `"dateModified": "${today}"`);
  }

  // Commit
  const commit = await commitMultipleFiles(owner, repo, [
    { path: filePath, content: html },
  ], `refresh: update ${slug} year ${oldYear}→${newYear}`, branch);

  return { sha: commit.sha, filePath };
}

/**
 * After refreshing a post, notify search engines.
 */
export async function notifyRefresh(domain, sitemapPath, indexnowKey, gscPropertyUrl, refreshedUrl) {
  const results = { gsc: false, indexnow: false };

  try {
    await submitSitemap(gscPropertyUrl, `https://${domain}/${sitemapPath}`);
    results.gsc = true;
  } catch (err) {
    console.error('GSC refresh notification failed:', err.message);
  }

  try {
    if (indexnowKey) {
      await submitToIndexNow(domain, indexnowKey, [refreshedUrl]);
      results.indexnow = true;
    }
  } catch (err) {
    console.error('IndexNow refresh notification failed:', err.message);
  }

  return results;
}


// ── Helpers ──

function extractYear(str) {
  if (!str) return null;
  const match = str.match(/\b(202[0-9])\b/);
  return match ? parseInt(match[1]) : null;
}

function calculateRefreshPriority(post, daysSince, reasons) {
  let priority = 0;

  // Age-based priority
  if (daysSince > 180) priority += 5;
  else if (daysSince > 120) priority += 3;
  else if (daysSince > 90) priority += 1;

  // Type-based priority
  if (post.category === 'statistics') priority += 4;
  if (post.category === 'comparison') priority += 3;
  if (post.category === 'cost-analysis') priority += 2;

  // Year in title adds urgency
  if (reasons.some(r => r.includes('current year'))) priority += 5;

  // More reasons = higher priority
  priority += reasons.length;

  return priority;
}