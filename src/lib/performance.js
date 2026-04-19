import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import supabase from './supabase.js';

// ─── GSC API CLIENT ─────────────────────────────────────

function getClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY env var not set. Base64-encoded JSON key required.');
  }
  let keyJson;
  try {
    keyJson = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf-8'));
  } catch {
    try { keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY); }
    catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not valid base64 or JSON'); }
  }
  if (!keyJson.client_email || !keyJson.private_key) {
    throw new Error('Service account key missing client_email or private_key');
  }
  return new JWT({
    email: keyJson.client_email,
    key: keyJson.private_key,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
}

function getSC() { return google.searchconsole({ version: 'v1', auth: getClient() }); }

// ─── DATA FETCHING ──────────────────────────────────────

/**
 * Fetch page-level performance. Handles:
 * - Data delay (endDate = 3 days ago)
 * - Pagination (25K per page, 50K max)
 * - Retry on 500/503
 * - Clear errors on 401/403
 */
export async function fetchPagePerformance(siteUrl, days = 28) {
  const sc = getSC();
  const endDate = new Date(); endDate.setDate(endDate.getDate() - 3); // GSC 48-72h delay
  const startDate = new Date(endDate); startDate.setDate(startDate.getDate() - days);

  let allRows = [], startRow = 0;
  while (true) {
    const body = {
      startDate: fmtDate(startDate), endDate: fmtDate(endDate),
      dimensions: ['page'],
      dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: '/blog-' }] }],
      rowLimit: 25000, startRow, type: 'web',
    };
    let response;
    try {
      response = await sc.searchanalytics.query({ siteUrl, requestBody: body });
    } catch (err) {
      if (err.code >= 500 && startRow === 0) {
        await sleep(5000);
        try { response = await sc.searchanalytics.query({ siteUrl, requestBody: body }); }
        catch (e2) { throw new Error(`GSC API failed after retry: ${e2.message}`); }
      } else if (err.code === 403) {
        throw new Error(`GSC 403: Add service account as user in Search Console settings.`);
      } else if (err.code === 401) {
        throw new Error('GSC 401: Check GOOGLE_SERVICE_ACCOUNT_KEY.');
      } else { throw err; }
    }
    const rows = response.data.rows || [];
    allRows = allRows.concat(rows);
    if (rows.length < 25000 || startRow >= 25000) break;
    startRow += 25000;
  }
  return allRows.map(r => ({
    url: r.keys[0], clicks: r.clicks||0, impressions: r.impressions||0,
    ctr: round(r.ctr * 100, 2), position: round(r.position, 1),
  }));
}

/**
 * Fetch page performance for a specific date range (days ago).
 * Used for non-overlapping current vs previous period comparison.
 * @param {number} startDaysAgo - e.g. 3 (data starts 3 days ago)
 * @param {number} endDaysAgo - e.g. 31 (data ends 31 days ago)
 */
export async function fetchPagePerformanceRange(siteUrl, startDaysAgo, endDaysAgo) {
  const sc = getSC();
  const endDate = new Date(); endDate.setDate(endDate.getDate() - startDaysAgo);
  const startDate = new Date(); startDate.setDate(startDate.getDate() - endDaysAgo);

  let allRows = [], startRow = 0;
  while (true) {
    const body = {
      startDate: fmtDate(startDate), endDate: fmtDate(endDate),
      dimensions: ['page'],
      dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: '/blog-' }] }],
      rowLimit: 25000, startRow, type: 'web',
    };
    let response;
    try {
      response = await sc.searchanalytics.query({ siteUrl, requestBody: body });
    } catch (err) {
      if (err.code >= 500 && startRow === 0) {
        await sleep(5000);
        try { response = await sc.searchanalytics.query({ siteUrl, requestBody: body }); }
        catch (e2) { throw new Error(`GSC API failed after retry: ${e2.message}`); }
      } else if (err.code === 403) {
        throw new Error(`GSC 403: Add service account as user in Search Console settings.`);
      } else if (err.code === 401) {
        throw new Error('GSC 401: Check GOOGLE_SERVICE_ACCOUNT_KEY.');
      } else { throw err; }
    }
    const rows = response.data.rows || [];
    allRows = allRows.concat(rows);
    if (rows.length < 25000 || startRow >= 25000) break;
    startRow += 25000;
  }
  return allRows.map(r => ({
    url: r.keys[0], clicks: r.clicks||0, impressions: r.impressions||0,
    ctr: round(r.ctr * 100, 2), position: round(r.position, 1),
  }));
}

/** Fetch query-level data for a specific page URL. */
export async function fetchQueryPerformance(siteUrl, pageUrl, days = 28) {
  const sc = getSC();
  const endDate = new Date(); endDate.setDate(endDate.getDate() - 3);
  const startDate = new Date(endDate); startDate.setDate(startDate.getDate() - days);
  try {
    const res = await sc.searchanalytics.query({
      siteUrl, requestBody: {
        startDate: fmtDate(startDate), endDate: fmtDate(endDate),
        dimensions: ['query'],
        dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }] }],
        rowLimit: 100, type: 'web',
      },
    });
    return (res.data.rows || []).map(r => ({
      query: r.keys[0], clicks: r.clicks||0, impressions: r.impressions||0,
      ctr: round(r.ctr*100,2), position: round(r.position,1),
    }));
  } catch (err) { console.error(`[GSC] Query fetch failed for ${pageUrl}:`, err.message); return []; }
}

/** Fetch query+page pairs to detect cannibalization. */
export async function fetchCannibalizationData(siteUrl, days = 28) {
  const sc = getSC();
  const endDate = new Date(); endDate.setDate(endDate.getDate() - 3);
  const startDate = new Date(endDate); startDate.setDate(startDate.getDate() - days);
  try {
    const res = await sc.searchanalytics.query({
      siteUrl, requestBody: {
        startDate: fmtDate(startDate), endDate: fmtDate(endDate),
        dimensions: ['query', 'page'],
        dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: '/blog-' }] }],
        rowLimit: 25000, type: 'web',
      },
    });
    const queryPages = {};
    for (const r of (res.data.rows || [])) {
      const q = r.keys[0], p = r.keys[1];
      if (!queryPages[q]) queryPages[q] = [];
      queryPages[q].push({ page: p, clicks: r.clicks, impressions: r.impressions, position: round(r.position,1) });
    }
    const conflicts = {};
    for (const [q, pages] of Object.entries(queryPages)) {
      if (pages.length >= 2) conflicts[q] = pages.sort((a,b) => a.position - b.position);
    }
    return conflicts;
  } catch (err) { console.error('[GSC] Cannibalization fetch failed:', err.message); return {}; }
}

// ─── 6-TIER CLASSIFICATION ──────────────────────────────

const EXPECTED_CTR = { 1:25, 2:15, 3:10, 4:7, 5:5, 6:3.5, 7:2.5, 8:2, 9:1.5, 10:1 };
function expectedCtr(pos) { const p = Math.round(pos); return p <= 0 ? 0 : p > 10 ? 0.5 : EXPECTED_CTR[p]||1; }

/**
 * Classify post into: winner|rising|underperformer|declining|unindexed|dead|new
 *
 * Edge cases:
 * - < 14 days old → always "new"
 * - AI Overview: pos 1-2, high impressions, CTR < 30% of expected → flagged, not penalized
 * - Seasonal: uses previous period comparison to detect decline vs seasonal dip
 * - Zero data vs not indexed: distinguished by age
 */
export function classifyPost(post, current, previous = null) {
  const daysOld = post.publish_date
    ? Math.floor((Date.now() - new Date(post.publish_date).getTime()) / 86400000) : 999;

  if (daysOld <= 14) return { tier: 'new', reason: `${daysOld} days old` };

  if (!current || current.impressions === 0) {
    return daysOld > 7
      ? { tier: 'unindexed', reason: `No impressions after ${daysOld} days` }
      : { tier: 'new', reason: 'No data yet' };
  }

  const { position: pos, ctr, clicks, impressions } = current;
  const expCtr = expectedCtr(pos);
  const aiOverview = pos <= 2 && ctr < (expCtr * 0.3) && impressions > 100;

  // Declining check (needs previous data)
  if (previous && previous.clicks >= 10) {
    const clickDrop = (previous.clicks - clicks) / previous.clicks;
    if (clickDrop > 0.3) return { tier: 'declining', reason: `Clicks -${round(clickDrop*100)}% (${previous.clicks}→${clicks})`, previous };
  }
  if (previous && previous.impressions >= 50) {
    const impDrop = (previous.impressions - impressions) / previous.impressions;
    if (impDrop > 0.5) return { tier: 'declining', reason: `Impressions -${round(impDrop*100)}%`, previous };
  }

  // Winner
  if (pos <= 5 && clicks >= 10 && ctr >= expCtr * 0.6)
    return { tier: 'winner', reason: `Pos ${pos}, ${clicks} clicks, ${ctr}% CTR` };

  // Underperformer (good rank, bad CTR)
  if (pos <= 10 && ctr < expCtr * 0.4 && impressions >= 50) {
    if (aiOverview) return { tier: 'rising', reason: `Pos ${pos}, low CTR likely AI Overview`, aiOverview: true };
    return { tier: 'underperformer', reason: `Pos ${pos}, ${ctr}% CTR (expected ${expCtr}%)` };
  }

  // Rising
  if (pos <= 20 && impressions >= 20)
    return { tier: 'rising', reason: `Pos ${pos}, ${impressions} impressions` };

  // Dead
  if (daysOld > 60 && impressions < 10 && clicks === 0)
    return { tier: 'dead', reason: `${daysOld} days, ${impressions} imp, 0 clicks` };

  return { tier: 'rising', reason: `Pos ${pos}, ${impressions} impressions` };
}

// ─── DAILY SNAPSHOT ─────────────────────────────────────

/**
 * Daily cron: pull GSC data, classify all posts, store snapshots.
 * Handles: URL normalization, duplicate snapshots (upsert), tier change detection.
 */
export async function dailyPerformanceSnapshot(businessId) {
  const { data: biz } = await supabase.from('blog_businesses').select('*').eq('id', businessId).single();
  if (!biz) throw new Error('Business not found');

  // IMPORTANT: siteUrl must match EXACTLY what's in GSC
  // URL-prefix: "https://callbirdai.com/" (with trailing slash)
  // Domain: "sc-domain:callbirdai.com"
  const siteUrl = biz.gsc_property_url || `https://${biz.domain}/`;
  const today = fmtDate(new Date());

  // Current period: 3-31 days ago (28 days, avoiding 48-72h delay)
  const currentRows = await fetchPagePerformanceRange(siteUrl, 3, 31);

  // EDGE CASE: If GSC returns 0 rows, could be an API outage — not real data.
  // Check if we had data yesterday. If yes, skip this snapshot to avoid false "unindexed" labels.
  if (currentRows.length === 0) {
    const { data: yesterday } = await supabase.from('blog_post_performance')
      .select('id').lt('snapshot_date', today).limit(1).single();
    if (yesterday) {
      return { snapshots: 0, message: 'GSC returned 0 rows but previous data exists — possible API outage. Snapshot skipped.', skipped: true };
    }
  }

  const current = buildPerfMap(currentRows);

  // Previous period: 32-59 days ago (non-overlapping 28 days for trend comparison)
  // Day 31 is the boundary — current includes it, previous starts at day 32
  let previous = new Map();
  try { previous = buildPerfMap(await fetchPagePerformanceRange(siteUrl, 32, 59)); }
  catch { /* non-critical — first run won't have previous data */ }

  const { data: posts } = await supabase.from('blog_existing_posts')
    .select('id, url, slug, title, primary_keyword, category, publish_date')
    .eq('business_id', businessId);
  if (!posts?.length) return { snapshots: 0, message: 'No posts' };

  const snapshots = [];
  let queryCallCount = 0;
  const MAX_QUERY_CALLS = 20; // Limit per-query API calls per run

  // Sort posts by current impressions descending — highest-value posts get query data first
  const sortedPosts = posts.map(post => ({
    post,
    impressions: matchPerf(current, post)?.impressions || 0,
  })).sort((a, b) => b.impressions - a.impressions).map(x => x.post);

  for (const post of sortedPosts) {
    const cur = matchPerf(current, post);
    const prev = matchPerf(previous, post);

    // Get top queries — but limit API calls to prevent rate limiting
    let topQueries = [];
    if (cur?.impressions > 0 && queryCallCount < MAX_QUERY_CALLS) {
      const matchUrl = findMatchingUrl(current, post);
      if (matchUrl) {
        topQueries = (await fetchQueryPerformance(siteUrl, matchUrl, 28)).slice(0, 10);
        queryCallCount++;
        if (queryCallCount % 5 === 0) await sleep(1000); // Brief pause every 5 calls
      }
    }

    const cl = classifyPost(post, cur, prev);
    snapshots.push({
      post_id: post.id, snapshot_date: today,
      clicks_28d: cur?.clicks||0, impressions_28d: cur?.impressions||0,
      ctr_28d: cur?.ctr||0, position_28d: cur?.position||0,
      clicks_prev_28d: prev?.clicks||0, impressions_prev_28d: prev?.impressions||0,
      top_queries: topQueries, performance_tier: cl.tier, tier_reason: cl.reason,
      ai_overview_likely: cl.aiOverview||false,
    });
  }

  // Upsert all snapshots
  for (const s of snapshots) {
    await supabase.from('blog_post_performance').upsert(s, { onConflict: 'post_id,snapshot_date' });
  }

  // Detect tier changes
  const tierChanges = [];
  for (const s of snapshots) {
    const { data: prev } = await supabase.from('blog_post_performance')
      .select('performance_tier').eq('post_id', s.post_id).lt('snapshot_date', today)
      .order('snapshot_date', { ascending: false }).limit(1).single();
    if (prev && prev.performance_tier !== s.performance_tier) {
      tierChanges.push({ post_id: s.post_id, from: prev.performance_tier, to: s.performance_tier, reason: s.tier_reason });
    }
  }

  const tiers = t => snapshots.filter(s => s.performance_tier === t).length;

  // DATA RETENTION: Clean up snapshots older than 90 days to prevent table bloat
  try {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
    await supabase.from('blog_post_performance')
      .delete().lt('snapshot_date', fmtDate(cutoff));
  } catch { /* non-critical */ }

  // MARCH 2026 CORE UPDATE: "Weakest link" mechanism — dead/unindexed posts drag down domain authority
  const deadCount = snapshots.filter(s => s.performance_tier === 'dead').length;
  const unindexedOld = snapshots.filter(s =>
    s.performance_tier === 'unindexed' && posts.find(p => p.id === s.post_id)?.publish_date &&
    (Date.now() - new Date(posts.find(p => p.id === s.post_id).publish_date).getTime()) / 86400000 > 60
  ).length;

  const warnings = [];
  if (deadCount > 0) warnings.push(`${deadCount} dead post(s) may be dragging down domain authority (March 2026 "weakest link" effect). Consider consolidating or unpublishing.`);
  if (unindexedOld > 3) warnings.push(`${unindexedOld} posts published 60+ days ago still not indexed. Check for thin content, missing sitemaps, or noindex tags.`);

  return {
    snapshots: snapshots.length,
    summary: { winner: tiers('winner'), rising: tiers('rising'), underperformer: tiers('underperformer'),
      declining: tiers('declining'), unindexed: tiers('unindexed'), dead: tiers('dead'), new: tiers('new') },
    tierChanges,
    warnings,
  };
}

// ─── WINNING PATTERN ANALYSIS ───────────────────────────

/**
 * Compare attributes of winners vs losers. Requires blog_post_attributes table.
 * Call weekly after 10+ published posts with 30+ days of data.
 */
export async function analyzeWinningPatterns(businessId) {
  // Try RPC first, fall back to direct query (RPC may not exist yet)
  let perf = null;
  try {
    const { data } = await supabase.rpc('latest_performance_per_post', { biz_id: businessId });
    perf = data;
  } catch {
    // RPC doesn't exist — fall back to direct query
  }

  if (!perf) {
    const today = fmtDate(new Date());
    const { data } = await supabase.from('blog_post_performance')
      .select('post_id, performance_tier, clicks_28d, ctr_28d, position_28d')
      .eq('snapshot_date', today);
    perf = data;
  }
  if (!perf?.length) return { error: 'No performance data', patterns: null };

  const { data: attrs } = await supabase.from('blog_post_attributes').select('*');
  if (!attrs?.length) return { error: 'No attributes tracked', patterns: null };

  const attrMap = new Map(attrs.map(a => [a.post_id, a]));
  const winners = perf.filter(p => p.performance_tier === 'winner').map(w => attrMap.get(w.post_id)).filter(Boolean);
  const losers = perf.filter(p => ['dead','underperformer','declining'].includes(p.performance_tier)).map(l => attrMap.get(l.post_id)).filter(Boolean);

  if (winners.length < 2 || losers.length < 2)
    return { error: `Need more data: ${winners.length} winners, ${losers.length} losers`, patterns: null };

  const patterns = {
    generated_at: new Date().toISOString(),
    sample: { winners: winners.length, losers: losers.length },
    avg_winner_words: avg(winners.map(a => a.word_count)),
    avg_loser_words: avg(losers.map(a => a.word_count)),
    avg_winner_links: avg(winners.map(a => a.internal_link_count)),
    avg_loser_links: avg(losers.map(a => a.internal_link_count)),
    avg_winner_ext_links: avg(winners.map(a => a.external_link_count || 0)),
    avg_loser_ext_links: avg(losers.map(a => a.external_link_count || 0)),
    winner_table_pct: pct(winners, a => a.has_comparison_table),
    loser_table_pct: pct(losers, a => a.has_comparison_table),
    winner_scenario_pct: pct(winners, a => a.has_before_after),
    winner_faq_pct: pct(winners, a => a.has_faq),
    winner_kw_in_title_pct: pct(winners, a => a.primary_keyword_in_title),
    loser_kw_in_title_pct: pct(losers, a => a.primary_keyword_in_title),
    winner_question_headings: avg(winners.map(a => a.question_heading_count || 0)),
    avg_winner_images: avg(winners.map(a => a.image_count || 0)),
    winner_types: countBy(winners, 'post_type'),
    winner_frameworks: countBy(winners, 'framework_used'),
    winner_openings: countBy(winners, 'opening_type'),
    winner_title_formats: countBy(winners, 'title_format'),
    avg_winner_title_len: avg(winners.map(a => a.title_length || 0)),
    avg_winner_qc: avg(winners.map(a => a.qc_overall).filter(Boolean)),
    avg_loser_qc: avg(losers.map(a => a.qc_overall).filter(Boolean)),
    recommendations: [],
  };

  // Generate recommendations from pattern deltas
  if (patterns.winner_table_pct > patterns.loser_table_pct + 20)
    patterns.recommendations.push(`Comparison tables: ${patterns.winner_table_pct}% winners vs ${patterns.loser_table_pct}% losers`);
  if (patterns.avg_winner_links > patterns.avg_loser_links + 1)
    patterns.recommendations.push(`Internal links: winners avg ${patterns.avg_winner_links} vs losers ${patterns.avg_loser_links}`);
  if (patterns.avg_winner_ext_links > patterns.avg_loser_ext_links + 1)
    patterns.recommendations.push(`External citations: winners avg ${patterns.avg_winner_ext_links} vs losers ${patterns.avg_loser_ext_links}`);
  if (patterns.avg_winner_words > patterns.avg_loser_words + 300)
    patterns.recommendations.push(`Word count: winners avg ${patterns.avg_winner_words} vs losers ${patterns.avg_loser_words}`);
  if (patterns.winner_kw_in_title_pct > patterns.loser_kw_in_title_pct + 20)
    patterns.recommendations.push(`Keyword in title: ${patterns.winner_kw_in_title_pct}% winners vs ${patterns.loser_kw_in_title_pct}% losers`);
  if (patterns.winner_question_headings > 1)
    patterns.recommendations.push(`Winners avg ${patterns.winner_question_headings} question-phrased headings (PAA alignment)`);

  const bestType = Object.entries(patterns.winner_types).sort((a,b) => b[1]-a[1])[0];
  if (bestType) patterns.recommendations.push(`Best post type: "${bestType[0]}"`);
  const bestTitle = Object.entries(patterns.winner_title_formats || {}).sort((a,b) => b[1]-a[1])[0];
  if (bestTitle) patterns.recommendations.push(`Best title format: "${bestTitle[0]}"`);
  const bestOpening = Object.entries(patterns.winner_openings).sort((a,b) => b[1]-a[1])[0];
  if (bestOpening) patterns.recommendations.push(`Best opening: "${bestOpening[0]}"`);

  // Content gap insights (what queries show impressions but have no dedicated post)
  try {
    const gapData = await discoverContentGaps(businessId);
    if (gapData.gaps?.length > 0) {
      patterns.content_gaps = gapData.gaps.slice(0, 5).map(g => ({
        query: g.query, impressions: g.impressions, position: g.position,
      }));
    }
  } catch { /* non-critical */ }
  await supabase.from('blog_winning_patterns').upsert({
    business_id: businessId, patterns, sample_size: winners.length + losers.length, updated_at: new Date().toISOString(),
  }, { onConflict: 'business_id' });

  return { patterns };
}

/** Load winning patterns formatted for injection into writing prompt. */
export async function getWinningPatternsForPrompt(businessId) {
  const { data } = await supabase.from('blog_winning_patterns')
    .select('patterns, updated_at, sample_size').eq('business_id', businessId).single();
  if (!data || data.sample_size < 6) return null;

  // EDGE CASE #10: If patterns are 30+ days old, they might be misleading
  const patternsAge = Math.floor((Date.now() - new Date(data.updated_at).getTime()) / 86400000);
  if (patternsAge > 30) {
    return `⚠️ CONTENT INTELLIGENCE DATA IS ${patternsAge} DAYS OLD — run weekly pattern analysis to refresh.\nUsing stale insights cautiously.`;
  }

  const p = data.patterns;
  const lines = [
    `CONTENT INTELLIGENCE (GSC data, updated ${data.updated_at.split('T')[0]}):`,
    `Based on ${data.sample_size} published posts with real performance data:`,
    '', 'YOUR BEST-PERFORMING POSTS share these traits:',
    ...p.recommendations.map(r => `• ${r}`),
    '', `Avg winner: ${p.avg_winner_words} words, ${p.avg_winner_links} internal links, ${p.avg_winner_ext_links || 0} external citations`,
    `Avg winner title: ${p.avg_winner_title_len || 50} characters`,
  ];

  if (p.avg_loser_words) {
    lines.push('', 'YOUR WORST-PERFORMING POSTS tend to:');
    lines.push(`• Average only ${p.avg_loser_words} words and ${p.avg_loser_links} internal links`);
    if (p.loser_table_pct < 20) lines.push('• Usually lack comparison tables');
    if (p.loser_kw_in_title_pct < 50) lines.push('• Often missing primary keyword in title');
  }

  // Content gap opportunities
  if (p.content_gaps?.length > 0) {
    lines.push('', 'CONTENT OPPORTUNITIES (high-impression queries without dedicated posts):');
    for (const gap of p.content_gaps) {
      lines.push(`• "${gap.query}" — ${gap.impressions} impressions, position ${gap.position}`);
    }
  }

  return lines.join('\n');
}

// ─── CONTENT ATTRIBUTE EXTRACTION ───────────────────────

/**
 * Extract trackable attributes from generated HTML.
 * Based on 2026 ranking factor research:
 * - Keyword placement (title, H1, first 100 words) — strongest on-page signal
 * - Internal + external links — authority distribution and trust
 * - Schema types — rich result eligibility and AI Overview citation
 * - Multi-modal signals — images, tables, structured elements
 * - Content structure — headings, FAQ, ToC, question headings
 * - Title/meta optimization — CTR drivers
 */
export function extractContentAttributes(html, metadata, qcResult) {
  const text = stripHtml(html);
  const htmlLower = html.toLowerCase();
  const keyword = (metadata?.primary_keyword || '').toLowerCase();
  const first100Words = text.split(/\s+/).slice(0, 100).join(' ').toLowerCase();
  const title = (metadata?.title || '');

  // EDGE CASE #4: Word-level keyword matching, not substring.
  // "ai receptionist" should match "Best AI Receptionist for Dentists" but also
  // "Top AI-Powered Receptionist Solutions" where words aren't adjacent.
  const keywordWords = keyword.split(/\s+/).filter(w => w.length > 2);
  const titleLower = title.toLowerCase();
  const keywordInTitle = keywordWords.length > 0 && keywordWords.every(w => titleLower.includes(w));
  const keywordInFirst100 = keywordWords.length > 0 && keywordWords.every(w => first100Words.includes(w));

  // Count question-phrased headings (correlates with PAA/AI Overview citation)
  const headings = html.match(/<h[23][^>]*>[^<]+<\/h[23]>/gi) || [];
  const questionHeadings = headings.filter(h => /\?/.test(stripHtml(h)));

  // EDGE CASE #6: Only count images inside <article>, not nav/footer logos
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  const articleHtml = articleMatch ? articleMatch[0] : html;
  const articleImages = (articleHtml.match(/<img[\s>]/gi) || []).length;

  return {
    // ── Core metrics ──
    word_count: text.split(/\s+/).filter(w => w.length > 0).length,
    h2_count: (html.match(/<h2[\s>]/gi)||[]).length,
    h3_count: (html.match(/<h3[\s>]/gi)||[]).length,

    // ── Keyword placement (strongest on-page signals) ──
    primary_keyword_in_title: keywordInTitle,
    primary_keyword_in_first_100: keywordInFirst100,

    // ── Link signals ──
    // Count internal links: both blog-{slug}.html (static) and /blog/{slug} (nextjs) formats
    internal_link_count: (html.match(/href="(?:blog-[^"]*\.html|\/blog\/[^"]+)"/gi)||[]).length,
    // External links: any full URL that isn't an internal blog link or same-domain link
    external_link_count: (html.match(/href="https?:\/\/[^"]+"/gi)||[]).length
      - (html.match(/href="https?:\/\/[^"]*(?:callbirdai\.com|myvoiceaiconnect\.com)[^"]*"/gi)||[]).length,

    // ── Structural elements ──
    has_comparison_table: /<table|table-wrap/i.test(html),
    has_before_after: /before[\s\S]{0,50}after|without[\s\S]{0,50}with ai|real scenario/i.test(text),
    has_faq: /faq-section|faqpage/i.test(htmlLower),
    has_calculator: /calculator|calculate your|formula|framework/i.test(text),
    has_toc: /table-of-contents|table of contents|jump to section/i.test(htmlLower),
    image_count: articleImages,  // Only content images, not nav/footer
    question_heading_count: questionHeadings.length,

    // ── Schema signals (rich results + AI Overview eligibility) ──
    has_schema_faq: htmlLower.includes('"faqpage"'),
    has_schema_article: /blogposting|article/i.test(htmlLower) && htmlLower.includes('schema.org'),

    // ── Title/meta optimization (CTR drivers) ──
    title_length: title.length,
    title_includes_year: /202[5-9]/.test(title),
    title_includes_number: /\d/.test(title),
    title_format: classifyTitleFormat(title),
    meta_description_length: (metadata?.meta_description || '').length,

    // ── Content quality signals ──
    stat_count: (text.match(/\d+%|\$[\d,]+/g)||[]).length,
    cta_count: (html.match(/cta-box/gi)||[]).length,
    avg_paragraph_length: getAvgParagraphLength(html),

    // ── Classification ──
    post_type: metadata?.category || 'unknown',
    keyword_intent: classifyIntent(metadata?.primary_keyword),
    opening_type: classifyOpening(text),
    framework_used: metadata?.framework_used || 'unknown',

    // ── QC scores (updated in step 4) ──
    qc_overall: qcResult?.scores?.overall || null,
    qc_info_gain: qcResult?.scores?.information_gain || null,
    qc_aeo: qcResult?.scores?.aeo_readiness || null,
  };
}

function classifyTitleFormat(title) {
  const t = title.toLowerCase();
  if (/^how /i.test(t)) return 'how-to';
  if (/^\d+\s/.test(title) || /top \d/i.test(t)) return 'listicle';
  if (/vs\.?|versus|compared/i.test(t)) return 'comparison';
  if (/\?$/.test(title.trim())) return 'question';
  if (/best |top /i.test(t)) return 'best-of';
  if (/cost|price|pricing/i.test(t)) return 'cost-analysis';
  return 'statement';
}

function getAvgParagraphLength(html) {
  const paras = html.match(/<p[^>]*>[^<]{20,}<\/p>/gi) || [];
  if (paras.length === 0) return 0;
  const totalWords = paras.reduce((sum, p) => sum + stripHtml(p).split(/\s+/).length, 0);
  return Math.round(totalWords / paras.length);
}

function classifyIntent(kw) {
  if (!kw) return 'unknown';
  const k = kw.toLowerCase();
  if (/best|top|compare|vs|alternative/.test(k)) return 'commercial';
  if (/buy|price|cost|pricing|trial/.test(k)) return 'transactional';
  return 'informational';
}

function classifyOpening(text) {
  const f = text.substring(0, 200).toLowerCase();
  if (/you're |you are |picture this|imagine |consider a/.test(f)) return 'scenario';
  if (/\d+%|\$[\d,]+/.test(f)) return 'statistic';
  if (/\?/.test(f.split('.')[0])) return 'question';
  if (/most |every |the problem|the truth|here's what/.test(f)) return 'contrast';
  return 'statement';
}

// ─── CANNIBALIZATION DETECTION ──────────────────────────

export async function detectCannibalization(businessId) {
  const { data: biz } = await supabase.from('blog_businesses').select('*').eq('id', businessId).single();
  if (!biz) throw new Error('Business not found');
  const siteUrl = biz.gsc_property_url || `https://${biz.domain}/`;
  const conflicts = await fetchCannibalizationData(siteUrl, 28);

  let created = 0;
  for (const [query, pages] of Object.entries(conflicts)) {
    if (pages.length < 2 || pages.some(p => p.impressions < 5)) continue;
    pages.sort((a,b) => b.clicks - a.clicks);
    const { data: existing } = await supabase.from('blog_cannibalization_alerts')
      .select('id').eq('business_id', businessId).eq('query', query).eq('resolution', 'pending').limit(1);
    if (!existing?.length) {
      await supabase.from('blog_cannibalization_alerts').insert({
        business_id: businessId, query,
        page_1_url: pages[0].page, page_1_position: pages[0].position, page_1_clicks: pages[0].clicks,
        page_2_url: pages[1].page, page_2_position: pages[1].position, page_2_clicks: pages[1].clicks,
        resolution: 'pending',
      });
      created++;
    }
  }
  return { alertsCreated: created, totalConflicts: Object.keys(conflicts).length };
}

// ─── QUERY DISCOVERY (content gaps from GSC) ────────────

/**
 * Find high-impression queries that don't have a dedicated blog post.
 * These are content opportunities — topics people search for that we don't cover.
 * Feeds into content strategist recommendations.
 */
export async function discoverContentGaps(businessId) {
  const { data: biz } = await supabase.from('blog_businesses').select('*').eq('id', businessId).single();
  if (!biz) throw new Error('Business not found');
  const siteUrl = biz.gsc_property_url || `https://${biz.domain}/`;

  // Get all queries across all blog posts
  const sc = getSC();
  const endDate = new Date(); endDate.setDate(endDate.getDate() - 3);
  const startDate = new Date(endDate); startDate.setDate(startDate.getDate() - 28);

  let allQueries;
  try {
    const res = await sc.searchanalytics.query({
      siteUrl, requestBody: {
        startDate: fmtDate(startDate), endDate: fmtDate(endDate),
        dimensions: ['query'],
        dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: '/blog-' }] }],
        rowLimit: 1000, type: 'web',
      },
    });
    allQueries = (res.data.rows || []).map(r => ({
      query: r.keys[0], clicks: r.clicks, impressions: r.impressions,
      ctr: round(r.ctr * 100, 2), position: round(r.position, 1),
    }));
  } catch (err) { console.error('[GSC] Gap discovery failed:', err.message); return { gaps: [] }; }

  // Get existing post keywords
  const { data: posts } = await supabase.from('blog_existing_posts')
    .select('title, slug, primary_keyword').eq('business_id', biz.id);
  const existingKeywords = (posts || []).map(p => (p.primary_keyword || p.title || '').toLowerCase());
  const existingSlugs = (posts || []).map(p => p.slug.toLowerCase());

  // Find queries with high impressions that don't match any existing post
  const rawGaps = allQueries
    .filter(q => q.impressions >= 20 && q.position > 5) // Showing up but not dominating
    .filter(q => {
      const qLower = q.query.toLowerCase();
      // EDGE CASE #9: Filter junk queries
      if (qLower.length < 5) return false; // Skip "ok", "yes", "pricing" etc.
      if (/^(ok|yes|no|pricing|test|hello)$/i.test(qLower)) return false;
      if (qLower.includes('callbird')) return false; // Skip brand queries
      // Skip if we have a post targeting this keyword
      return !existingKeywords.some(kw => kw.includes(qLower) || qLower.includes(kw))
        && !existingSlugs.some(s => qLower.split(' ').every(w => s.includes(w)));
    })
    .sort((a, b) => b.impressions - a.impressions);

  // Cluster similar queries (60%+ word overlap)
  const clusters = [];
  const assigned = new Set();

  for (const gap of rawGaps) {
    if (assigned.has(gap.query)) continue;

    const cluster = {
      representative: gap.query,
      queries: [gap],
      totalImpressions: gap.impressions,
      totalClicks: gap.clicks,
      bestPosition: gap.position,
    };

    const gapWords = new Set(gap.query.toLowerCase().split(/\s+/).filter(w => w.length > 2));

    for (const other of rawGaps) {
      if (other.query === gap.query || assigned.has(other.query)) continue;
      const otherWords = new Set(other.query.toLowerCase().split(/\s+/).filter(w => w.length > 2));

      // Calculate word overlap
      let overlap = 0;
      for (const w of gapWords) { if (otherWords.has(w)) overlap++; }
      const similarity = overlap / Math.max(gapWords.size, otherWords.size);

      if (similarity >= 0.6) {
        cluster.queries.push(other);
        cluster.totalImpressions += other.impressions;
        cluster.totalClicks += other.clicks;
        cluster.bestPosition = Math.min(cluster.bestPosition, other.position);
        assigned.add(other.query);
      }
    }

    assigned.add(gap.query);
    clusters.push(cluster);
  }

  // Sort clusters by total impressions and return top 15
  clusters.sort((a, b) => b.totalImpressions - a.totalImpressions);
  const gaps = clusters.slice(0, 15).map(c => ({
    query: c.representative,
    impressions: c.totalImpressions,
    clicks: c.totalClicks,
    position: round(c.bestPosition, 1),
    clusterSize: c.queries.length,
    relatedQueries: c.queries.slice(1, 4).map(q => q.query),
  }));

  return { gaps };
}

// ─── UNDERPERFORMER ANALYSIS ────────────────────────────

/**
 * For posts classified as "underperformer" (good position, bad CTR),
 * analyze WHY the CTR is low and suggest specific fixes.
 */
export async function analyzeUnderperformers(businessId) {
  const today = fmtDate(new Date());
  const { data: underperformers } = await supabase.from('blog_post_performance')
    .select('post_id, clicks_28d, impressions_28d, ctr_28d, position_28d, top_queries, tier_reason')
    .eq('performance_tier', 'underperformer').eq('snapshot_date', today);

  if (!underperformers?.length) return { posts: [], suggestions: [] };

  const results = [];
  for (const u of underperformers) {
    const { data: post } = await supabase.from('blog_existing_posts')
      .select('title, slug, meta_description, primary_keyword, publish_date')
      .eq('id', u.post_id).single();
    if (!post) continue;

    const issues = [];
    const suggestions = [];

    // Title analysis
    if (post.title.length > 60) issues.push(`Title too long (${post.title.length} chars) — gets truncated in SERP`);
    if (post.title.length < 30) issues.push(`Title too short (${post.title.length} chars) — not compelling enough`);
    if (!/\d/.test(post.title)) suggestions.push('Add a number or year to the title (numbers increase CTR by 20-30%)');
    if (!/[:\-—|]/.test(post.title)) suggestions.push('Add a power word after a separator (e.g., "... — The Complete Guide")');
    if (post.title === post.title.toUpperCase() || /^[A-Z][a-z]+ [A-Z][a-z]+/.test(post.title)) {
      issues.push('Title appears to be in Title Case from slug — rewrite to be compelling');
    }

    // Meta description analysis
    const metaLen = (post.meta_description || '').length;
    if (metaLen === 0) issues.push('No meta description — Google will auto-generate one (usually poorly)');
    else if (metaLen < 100) issues.push(`Meta description too short (${metaLen} chars) — aim for 140-155`);
    else if (metaLen > 160) issues.push(`Meta description too long (${metaLen} chars) — gets truncated`);

    // Freshness
    if (post.publish_date) {
      const age = Math.floor((Date.now() - new Date(post.publish_date).getTime()) / 86400000);
      if (age > 90 && !/2026/.test(post.title)) suggestions.push('Add "[2026]" to title for freshness signal');
    }

    // Top query analysis — are we ranking for the right queries?
    const topQueries = u.top_queries || [];
    if (topQueries.length > 0) {
      const bestQuery = topQueries.sort((a, b) => b.impressions - a.impressions)[0];
      if (post.primary_keyword && !bestQuery.query.includes(post.primary_keyword?.toLowerCase())) {
        suggestions.push(`Top query "${bestQuery.query}" doesn't match targeted keyword — consider retargeting title`);
      }
    }

    results.push({
      post_id: u.post_id,
      title: post.title,
      slug: post.slug,
      position: u.position_28d,
      ctr: u.ctr_28d,
      impressions: u.impressions_28d,
      issues,
      suggestions,
      topQueries: topQueries.slice(0, 5),
    });
  }

  return { posts: results };
}

// ─── HELPERS ────────────────────────────────────────────

// GSC dates are in Pacific Time (UTC-7/8). Using toLocaleDateString with PT timezone
// prevents off-by-one errors when server runs in UTC.
function fmtDate(d) { return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); }
function round(n, dec=0) { return Math.round(n * 10**dec) / 10**dec; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
// Null-safe avg: filters out null/undefined/NaN before averaging
function avg(arr) { const clean = arr.filter(v => v != null && !isNaN(v)); return clean.length ? round(clean.reduce((a,b) => a+b, 0) / clean.length) : 0; }
function pct(arr, fn) { return arr.length ? round(arr.filter(fn||Boolean).length / arr.length * 100) : 0; }
function countBy(arr, key) { const c = {}; arr.forEach(a => { const v = a[key]||'unknown'; c[v] = (c[v]||0)+1; }); return c; }

function buildPerfMap(rows) {
  const map = new Map();
  for (const r of rows) {
    map.set(r.url, r);
    map.set(r.url.replace(/\/$/, ''), r);
    map.set(r.url.replace(/\.html$/, ''), r);
  }
  return map;
}

function matchPerf(map, post) {
  if (map.has(post.url)) return map.get(post.url);
  const noHtml = post.url.replace(/\.html$/, '');
  if (map.has(noHtml)) return map.get(noHtml);
  if (map.has(post.url + '/')) return map.get(post.url + '/');
  for (const [url, data] of map) { if (url.includes(post.slug)) return data; }
  return null;
}

function findMatchingUrl(map, post) {
  for (const [url] of map) { if (url.includes(post.slug)) return url; }
  return post.url;
}

function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}