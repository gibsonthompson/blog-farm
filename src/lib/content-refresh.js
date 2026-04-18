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
 * Skips posts refreshed within the last 60 days.
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
    // Skip recently refreshed posts
    if (post.last_refreshed) {
      const daysSinceRefresh = Math.floor((now - new Date(post.last_refreshed)) / (1000 * 60 * 60 * 24));
      if (daysSinceRefresh < 60) { healthy.push(post); continue; }
    }

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

    // Check 3: Comparison posts are high-priority for refresh
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
  "outdated_items": [{"what": "description", "current": "what it says", "should_be": "what it should say", "section_heading": "nearest h2/h3 heading"}],
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
 * Also updates dateModified in schema AND sitemap lastmod.
 */
export async function applyYearRefresh(owner, repo, branch, blogPrefix, slug, oldYear, newYear, sitemapPath) {
  const filePath = `${blogPrefix}${slug}.html`;
  const file = await fetchFileContent(owner, repo, filePath, branch);
  if (!file) throw new Error(`File not found: ${filePath}`);

  let html = file.content;
  const today = new Date().toISOString().split('T')[0];

  // Replace year references
  const yearPattern = new RegExp(`\\b${oldYear}\\b`, 'g');
  html = html.replace(yearPattern, String(newYear));

  // Update dateModified in schema
  const dateModPattern = /"dateModified"\s*:\s*"[^"]+"/;
  if (dateModPattern.test(html)) {
    html = html.replace(dateModPattern, `"dateModified": "${today}"`);
  }

  // Build commit files
  const files = [{ path: filePath, content: html }];

  // Update sitemap lastmod for this URL
  if (sitemapPath) {
    const sitemapFile = await fetchFileContent(owner, repo, sitemapPath, branch);
    if (sitemapFile) {
      const updatedSitemap = updateSitemapLastmod(sitemapFile.content, slug, today);
      if (updatedSitemap !== sitemapFile.content) {
        files.push({ path: sitemapPath, content: updatedSitemap });
      }
    }
  }

  const commit = await commitMultipleFiles(owner, repo, files,
    `refresh: ${slug} year ${oldYear}→${newYear}`, branch);

  return { sha: commit.sha, filePath, filesChanged: files.length };
}

/**
 * Full content refresh — Claude rewrites stale sections based on analysis.
 * Updates dateModified, sitemap lastmod, and notifies search engines.
 */
export async function applyFullRefresh(owner, repo, branch, blogPrefix, slug, sitemapPath, analysis) {
  const filePath = `${blogPrefix}${slug}.html`;
  const file = await fetchFileContent(owner, repo, filePath, branch);
  if (!file) throw new Error(`File not found: ${filePath}`);

  const today = new Date().toISOString().split('T')[0];
  const currentYear = new Date().getFullYear();

  // Build the refresh instructions from the analysis
  const instructions = [];
  if (analysis.outdated_items?.length) {
    for (const item of analysis.outdated_items) {
      instructions.push(`- Fix: "${item.current}" → should be "${item.should_be}" (${item.what})`);
    }
  }
  if (analysis.year_references_to_update?.length) {
    instructions.push(`- Update all year references to ${currentYear}`);
  }

  if (instructions.length === 0) {
    return { skipped: true, reason: 'No actionable items from analysis' };
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    messages: [{
      role: 'user',
      content: `You are refreshing an existing blog post. Make ONLY the specific changes listed below. Do NOT rewrite the entire post. Preserve all HTML structure, CSS, scripts, nav, footer exactly as-is.

CHANGES TO MAKE:
${instructions.join('\n')}

ALSO:
- Update dateModified to "${today}" in the JSON-LD schema
- Update any year references from ${currentYear - 1} to ${currentYear} in titles, headings, and body text
- Do NOT change the slug, URL, canonical, or OG tags
- Do NOT add new sections or remove existing ones
- Do NOT change the writing style or voice

Return the COMPLETE updated HTML file. Every character matters — do not truncate or summarize.

CURRENT HTML:
${file.content}`
    }],
  });

  let updatedHtml = response.content[0].text;

  // Clean up — Claude sometimes wraps in code fences
  updatedHtml = updatedHtml.replace(/^```html\n?/, '').replace(/\n?```$/, '');

  // Safety: verify it's still a complete HTML file
  if (!updatedHtml.includes('<!DOCTYPE') && !updatedHtml.includes('<!doctype')) {
    // Claude may have only returned the changed sections — fall back to targeted replacement
    return { skipped: true, reason: 'Claude did not return complete HTML — use year-refresh instead' };
  }

  // Ensure dateModified is updated
  const dateModPattern = /"dateModified"\s*:\s*"[^"]+"/;
  if (dateModPattern.test(updatedHtml)) {
    updatedHtml = updatedHtml.replace(dateModPattern, `"dateModified": "${today}"`);
  }

  // Build commit files
  const commitFiles = [{ path: filePath, content: updatedHtml }];

  // Update sitemap lastmod
  if (sitemapPath) {
    const sitemapFile = await fetchFileContent(owner, repo, sitemapPath, branch);
    if (sitemapFile) {
      const updatedSitemap = updateSitemapLastmod(sitemapFile.content, slug, today);
      if (updatedSitemap !== sitemapFile.content) {
        commitFiles.push({ path: sitemapPath, content: updatedSitemap });
      }
    }
  }

  const commit = await commitMultipleFiles(owner, repo, commitFiles,
    `refresh: update ${slug} (${instructions.length} changes)`, branch);

  return { sha: commit.sha, filePath, changesApplied: instructions.length, filesChanged: commitFiles.length };
}

/**
 * After refreshing a post, notify search engines and update DB.
 */
export async function notifyRefresh(businessId, domain, sitemapPath, indexnowKey, gscPropertyUrl, refreshedSlug) {
  const cleanUrl = `https://${domain}/blog-${refreshedSlug}`;
  const results = { gsc: false, indexnow: false, db: false };

  // Notify GSC
  try {
    await submitSitemap(gscPropertyUrl, `https://${domain}/${sitemapPath}`);
    results.gsc = true;
  } catch (err) {
    console.error('GSC refresh notification failed:', err.message);
  }

  // Notify IndexNow
  try {
    if (indexnowKey) {
      await submitToIndexNow(domain, indexnowKey, [cleanUrl]);
      results.indexnow = true;
    }
  } catch (err) {
    console.error('IndexNow refresh notification failed:', err.message);
  }

  // Update DB tracking
  try {
    await supabase.from('blog_existing_posts')
      .update({ last_refreshed: new Date().toISOString() })
      .eq('business_id', businessId)
      .eq('slug', refreshedSlug);
    results.db = true;
  } catch (err) {
    console.error('DB refresh tracking failed:', err.message);
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
  if (daysSince > 180) priority += 5;
  else if (daysSince > 120) priority += 3;
  else if (daysSince > 90) priority += 1;

  if (post.category === 'statistics') priority += 4;
  if (post.category === 'comparison') priority += 3;
  if (post.category === 'cost-analysis') priority += 2;

  if (reasons.some(r => r.includes('current year'))) priority += 5;
  priority += reasons.length;
  return priority;
}

/**
 * Update the <lastmod> for a specific URL in the sitemap.
 */
function updateSitemapLastmod(sitemapXml, slug, newDate) {
  // Match the URL entry containing this slug and update its lastmod
  const pattern = new RegExp(
    `(<loc>[^<]*${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*</loc>\\s*<lastmod>)[^<]*(</lastmod>)`,
    'i'
  );
  return sitemapXml.replace(pattern, `$1${newDate}$2`);
}