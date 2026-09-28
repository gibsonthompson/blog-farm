import Anthropic from '@anthropic-ai/sdk';
import supabase from './supabase.js';
import { loadBusinessContext } from './claude.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Per-business opportunity maps.
 * CallBird has a detailed hardcoded map.
 * Other businesses use AI-driven topic generation from their brand kit.
 */
const OPPORTUNITY_MAPS = {
  callbird: {
    industries: {
      description: 'Industry-specific posts: "Best AI Receptionist for [Industry]"',
      targets: [
        'dentists', 'lawyers', 'HVAC', 'plumbers', 'electricians',
        'contractors', 'restaurants', 'veterinary clinics', 'chiropractors',
        'property management', 'auto repair shops', 'salons and spas',
        'cleaning companies', 'real estate agents', 'medical offices',
        'therapists and counselors', 'accounting firms', 'insurance agencies',
        'roofing companies', 'landscaping companies', 'pest control',
        'moving companies', 'towing companies', 'fitness studios and gyms',
        'funeral homes', 'optometry offices', 'pediatric offices',
        'home inspectors', 'photography studios', 'wedding planners',
      ],
    },
    competitors: {
      description: 'Head-to-head comparison posts: "CallBird vs [Competitor]"',
      targets: [
        'Smith.ai', 'Ruby Receptionists', 'Dialzara', 'My AI Front Desk',
        'Goodcall', 'AIRA', 'Upfirst', 'Rosie AI', 'Abby Connect',
        'Nexa', 'PATLive', 'VoiceNation', 'AnswerConnect', 'Davinci',
        'Numa', 'Slang.ai', 'Simple Phones AI', 'Bland AI',
      ],
    },
    howTo: {
      description: 'Practical how-to guides',
      targets: [
        'how to stop missing business calls',
        'how to set up an AI receptionist in 10 minutes',
        'how to reduce no-shows with automated reminders',
        'how to handle after-hours calls without hiring staff',
        'how to route emergency calls with AI',
        'how to train an AI receptionist on your business',
        'how to switch from a human receptionist to AI',
        'how to answer calls professionally when you are a solo business',
        'how to capture leads from every phone call',
        'how to automate appointment booking by phone',
      ],
    },
    costAnalysis: {
      description: 'Data-driven cost comparisons and ROI analyses',
      targets: [
        'cost of hiring a receptionist vs AI receptionist',
        'cost of missed calls for small business',
        'AI receptionist ROI calculator',
        'answering service cost comparison',
        'how much do missed calls cost dental practices',
        'virtual receptionist pricing comparison',
      ],
    },
    statistics: {
      description: 'Data-driven statistical roundups',
      targets: [
        'AI receptionist statistics',
        'small business phone call statistics',
        'missed call statistics by industry',
      ],
    },
    guides: {
      description: 'Comprehensive definitive guides',
      targets: [
        'complete guide to AI receptionists',
        'AI receptionist vs chatbot differences',
        'AI receptionist integration guide',
        'HIPAA compliant AI receptionist guide',
        'AI receptionist for multi-location businesses',
      ],
    },
    brandAwareness: {
      description: 'Brand/product awareness content',
      targets: [
        'what is CallBird AI',
        'CallBird AI features and pricing',
        'AI receptionist FAQ comprehensive',
      ],
    },
  },

  'voiceai-connect': {
    agencyScaling: {
      description: 'Scaling past common plateaus',
      targets: [
        'how to scale AI receptionist agency past 20 clients',
        'hiring vs automation for growing AI agencies',
        'agency operations at 50 vs 100 clients',
        'when to upgrade from starter to professional plan',
        'building an agency team with white label AI',
      ],
    },
    ghlMigration: {
      description: 'GoHighLevel alternative and migration content',
      targets: [
        'switching from GoHighLevel to white label AI receptionist',
        'GoHighLevel AI receptionist limitations',
        'A2P 10DLC registration problems GoHighLevel agencies',
        'GoHighLevel vs dedicated AI receptionist platform',
        'why agencies leave GoHighLevel for specialized platforms',
      ],
    },
    clientRetention: {
      description: 'Reducing churn and retaining AI receptionist clients',
      targets: [
        'reduce AI receptionist client churn rate',
        'how to show ROI to AI receptionist clients',
        'client onboarding checklist AI receptionist agency',
        'monthly reporting templates AI receptionist agency',
        'how to handle client complaints about AI voice quality',
      ],
    },
    pricingStrategy: {
      description: 'Agency pricing and packaging',
      targets: [
        'how to price AI receptionist services for different industries',
        'AI receptionist agency pricing tiers strategy',
        'value based pricing for AI phone answering',
        'bundling AI receptionist with other agency services',
        'raising prices on existing AI receptionist clients',
      ],
    },
    salesPlaybooks: {
      description: 'Vertical-specific sales approaches',
      targets: [
        'sell AI receptionist to home service contractors',
        'sell AI receptionist to medical practices compliance',
        'sell AI receptionist to property management companies',
        'sell AI receptionist to insurance agencies',
        'cold email templates for AI receptionist sales',
        'LinkedIn outreach for AI receptionist agencies',
        'demo script for selling AI receptionist to local businesses',
      ],
    },
    marketTrends: {
      description: 'Industry analysis and trend content',
      targets: [
        'AI receptionist market size and growth 2026',
        'white label AI voice agent industry trends',
        'future of AI phone answering for small businesses',
        'AI receptionist vs human receptionist cost comparison 2026',
        'how AI search engines change white label agency marketing',
      ],
    },
    competitorUpdates: {
      description: 'Platform comparison refreshes',
      targets: [
        'VoiceAI Connect vs Synthflow detailed comparison',
        'VoiceAI Connect vs Retell AI for agencies',
        'best white label AI receptionist platforms ranked update',
        'white label AI receptionist platform pricing comparison update',
      ],
    },
  },
};

/**
 * Analyze existing coverage against opportunity map.
 * Returns gap analysis if a map exists for this business.
 */
function analyzeGaps(existingPosts, businessSlug) {
  const map = OPPORTUNITY_MAPS[businessSlug];
  if (!map) return null; // No map for this business — use AI-only strategy

  const existingSlugs = existingPosts.map(p => p.slug.toLowerCase());
  const existingKeywords = existingPosts.map(p => (p.primary_keyword || '').toLowerCase());
  const existingTitles = existingPosts.map(p => p.title.toLowerCase());

  const gaps = {};

  // Stop words that don't carry topic meaning
  const STOP_WORDS = new Set([
    'a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'and', 'or', 'vs',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'how', 'what',
    'why', 'when', 'where', 'which', 'who', 'that', 'this', 'with',
    'from', 'your', 'you', 'our', 'their', 'its', 'can', 'do', 'does',
    'not', 'no', 'by', 'at', 'as', 'it', 'if', 'up', 'about', 'into',
  ]);

  /**
   * Extract meaningful words from a string (strip stop words, normalize)
   */
  function getContentWords(str) {
    return str.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP_WORDS.has(w));
  }

  /**
   * Calculate what % of target's meaningful words appear in the candidate string.
   * Returns 0-1. Requires 60%+ to consider a match.
   */
  function wordOverlap(targetWords, candidateStr) {
    const candidateWords = new Set(getContentWords(candidateStr));
    if (targetWords.length === 0) return 0;
    const matches = targetWords.filter(w => candidateWords.has(w)).length;
    return matches / targetWords.length;
  }

  const MATCH_THRESHOLD = 0.6; // 60% of meaningful words must match

  for (const [category, data] of Object.entries(map)) {
    const covered = [];
    const uncovered = [];

    for (const target of data.targets) {
      const targetWords = getContentWords(target);

      // Check if any existing post covers this topic with sufficient word overlap
      const isCovered =
        existingSlugs.some(s => wordOverlap(targetWords, s.replace(/-/g, ' ')) >= MATCH_THRESHOLD) ||
        existingKeywords.some(k => wordOverlap(targetWords, k) >= MATCH_THRESHOLD) ||
        existingTitles.some(t => wordOverlap(targetWords, t) >= MATCH_THRESHOLD);

      if (isCovered) covered.push(target);
      else uncovered.push(target);
    }

    gaps[category] = {
      description: data.description,
      total: data.targets.length,
      covered: covered.length,
      uncovered: uncovered.length,
      coveragePercent: Math.round((covered.length / data.targets.length) * 100),
      coveredTopics: covered,
      gapTopics: uncovered,
    };
  }

  return gaps;
}

/**
 * Recommend next posts to write.
 * Uses opportunity map gap analysis (if available) + Claude strategic thinking.
 */
export async function recommendNextPosts(businessSlug, count = 5) {
  const { business, brandKit, existingPosts } = await loadBusinessContext(businessSlug);
  const gaps = analyzeGaps(existingPosts, businessSlug);

  const existingList = existingPosts
    .map(p => `• "${p.title}" [${p.category || 'unknown'}] — keyword: ${p.primary_keyword || 'N/A'}`)
    .join('\n');

  // Build gap summary if we have a map
  let gapSummary = '';
  if (gaps) {
    gapSummary = `=== GAP ANALYSIS (from opportunity map) ===\n` +
      Object.entries(gaps)
        .map(([cat, data]) => {
          const gapList = data.gapTopics.length > 0
            ? data.gapTopics.map(t => `  - ${t}`).join('\n')
            : '  (fully covered)';
          return `${cat.toUpperCase()} (${data.coveragePercent}% covered, ${data.uncovered} gaps):\n${gapList}`;
        })
        .join('\n\n');
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    messages: [{
      role: 'user',
      content: `You are an expert SEO/AEO content strategist for ${business.name} (${business.domain}).

Current date: ${new Date().toISOString().split('T')[0]}

=== COMPANY ===
${brandKit.company_description}

=== TARGET AUDIENCE ===
${brandKit.target_audience}

=== PRIMARY KEYWORDS ===
${brandKit.primary_keywords.join(', ')}

=== COMPETITORS ===
${brandKit.competitor_names.join(', ')}

=== EXISTING BLOG POSTS (${existingPosts.length} total) ===
${existingList}

${gapSummary}

=== YOUR TASK ===
FIRST: Search for trending topics and recent developments in this space to identify timely content opportunities.

Then recommend exactly ${count} blog posts to create next, in priority order. Consider:

1. **Coverage gaps** — What important topics are completely missing?
2. **Business impact** — Which posts would drive the most leads/conversions?
3. **Keyword opportunity** — Target keywords with commercial intent
4. **Topical authority** — Fill in clusters to strengthen domain authority
5. **Seasonal relevance** — Is anything timely right now (${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })})?
6. **AEO optimization** — Which posts would help ${business.name} get cited by AI engines (ChatGPT, Perplexity)?
7. **Anti-cannibalization** — Do NOT recommend topics that overlap with existing posts
8. **Competitor vulnerability** — Where can we outrank thin or outdated competitor content?
9. **Fresh research** — Use web search to validate that recommended keywords have actual search demand

For each recommendation, provide:
- A specific title
- The target keyword
- The post type (industry/comparison/how-to/cost-analysis/statistics/guide/about)
- Why this post matters (1-2 sentences on strategic reasoning)
- Estimated business impact (high/medium/low)

Return ONLY valid JSON array:
[
  {
    "rank": 1,
    "title": "Blog Post Title Here",
    "target_keyword": "primary keyword to target",
    "post_type": "guide",
    "reasoning": "Why this post should be created next",
    "business_impact": "high",
    "notes": "Any special instructions for the writer"
  }
]

No markdown fences. No explanation outside the JSON. Just the array.`
    }],
  });

  let recommendations;
  try {
    const textBlocks = response.content.filter(b => b.type === 'text');
    
    // Try each text block from last to first — JSON array is usually in the final block
    let parsed = null;
    for (let i = textBlocks.length - 1; i >= 0; i--) {
      const blockText = textBlocks[i].text.trim().replace(/```json\n?|```/g, '').trim();
      const jsonMatch = blockText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const attempt = JSON.parse(jsonMatch[0]);
          if (Array.isArray(attempt) && attempt.length > 0 && attempt[0].target_keyword) {
            parsed = attempt;
            break;
          }
        } catch { /* try next block */ }
      }
    }

    if (!parsed) {
      // Fallback: join all and try
      const allText = textBlocks.map(b => b.text).join('\n').trim().replace(/```json\n?|```/g, '');
      const jsonMatch = allText.match(/\[[\s\S]*\]/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    }

    if (!parsed) throw new Error('No valid JSON array found in response');
    recommendations = parsed;
  } catch (e) {
    throw new Error(`Strategist response was not valid JSON: ${e.message}`);
  }

  return {
    recommendations,
    coverage: gaps,
    existingCount: existingPosts.length,
    totalOpportunities: gaps ? Object.values(gaps).reduce((sum, g) => sum + g.uncovered, 0) : null,
  };
}

/**
 * Quick gap analysis without Claude (instant, no API cost)
 * Only works for businesses with an opportunity map.
 */
export async function getGapAnalysis(businessSlug) {
  const { existingPosts } = await loadBusinessContext(businessSlug);
  const gaps = analyzeGaps(existingPosts, businessSlug);

  if (!gaps) {
    return {
      existingCount: existingPosts.length,
      totalOpportunities: null,
      coverage: null,
      note: `No opportunity map defined for "${businessSlug}". Use recommendNextPosts() for AI-driven recommendations.`,
    };
  }

  return {
    existingCount: existingPosts.length,
    totalOpportunities: Object.values(gaps).reduce((sum, g) => sum + g.uncovered, 0),
    coverage: gaps,
  };
}
/**
 * ─────────────────────────────────────────────────────────────
 *  BATCH CONTENT PLANNER  (anti-repetition, cluster-aware)
 * ─────────────────────────────────────────────────────────────
 *
 * Why this exists:
 * The autopilot used to call recommendNextPosts(slug, 1) once per day. Each
 * call was a cold decision with no memory of what the previous days produced,
 * so it kept mining the same opportunity-map category ("sell AI receptionist
 * to [industry]") and shipped ~13 near-identical posts in a row.
 *
 * generateContentPlan builds a whole batch at once, judging the set as a set:
 *   - no more than MAX_PER_TEMPLATE posts share a structural template
 *   - the batch spreads across pillars / intents (informational, commercial,
 *     comparison, how-to)
 *   - each item is a distinct search intent, not a reword of another
 *   - one PILLAR post can anchor a cluster of supporting spokes
 *
 * It writes the plan into blog_content_queue with staggered scheduled_date and
 * a priority order. The autopilot then drains the queue one per day.
 */

const MAX_PER_TEMPLATE = 2; // at most this many posts may share one structural pattern

/**
 * Strip a title/keyword down to its structural template so we can detect
 * "sell AI receptionist to X" style repetition. Removes the variable tail.
 */
function structuralSignature(str) {
  const s = (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  // Common templated stems: keep the first 4 meaningful words as the signature.
  const stem = s.split(' ').slice(0, 4).join(' ');
  return stem;
}

/**
 * Generate a balanced batch content plan and write it to blog_content_queue.
 *
 * @param {string} businessSlug
 * @param {number} count            how many posts to plan (default 12)
 * @param {object} opts
 * @param {number} opts.perWeek     posts per week for scheduling stagger (default 5)
 * @param {string} opts.startDate   ISO date to start scheduling (default tomorrow)
 * @param {boolean} opts.dryRun     if true, return the plan without writing to the queue
 */
export async function generateContentPlan(businessSlug, count = 12, opts = {}) {
  const perWeek = opts.perWeek || 5;
  const dryRun = !!opts.dryRun;

  const { business, brandKit, existingPosts } = await loadBusinessContext(businessSlug);
  const gaps = analyzeGaps(existingPosts, businessSlug);

  // Pull recent winning patterns from GSC if available (performance feedback loop).
  let performanceNote = '';
  try {
    const { getWinningPatternsForPrompt } = await import('./performance.js');
    const patterns = await getWinningPatternsForPrompt(brandKit.business_id || business.id);
    if (patterns) performanceNote = `\n=== WHAT IS ACTUALLY RANKING (GSC data) ===\n${patterns}\n`;
  } catch { /* performance module optional */ }

  // Recent posts so the planner can actively avoid repeating structures.
  const recent = existingPosts.slice(0, 25)
    .map(p => `• "${p.title}" [${p.category || '?'}]`)
    .join('\n');

  // Already-queued items (don't double up on what's waiting to be written).
  const { data: queuedRows } = await supabase
    .from('blog_content_queue')
    .select('target_keyword, title_suggestion, status')
    .eq('business_id', business.id)
    .in('status', ['pending', 'generating']);
  const queuedList = (queuedRows || []).map(q => `• ${q.title_suggestion || q.target_keyword}`).join('\n') || '(none)';

  let gapSummary = '';
  if (gaps) {
    gapSummary = '=== OPPORTUNITY MAP GAPS ===\n' + Object.entries(gaps)
      .map(([cat, d]) => `${cat.toUpperCase()} (${d.coveragePercent}% covered): ${d.gapTopics.slice(0, 8).join('; ') || 'full'}`)
      .join('\n');
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 5000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    messages: [{
      role: 'user',
      content: `You are the lead SEO/AEO content strategist for ${business.name} (${business.domain}).
Current date: ${new Date().toISOString().split('T')[0]}

=== COMPANY ===
${brandKit.company_description}

=== TARGET AUDIENCE ===
${brandKit.target_audience}

=== PRIMARY KEYWORDS ===
${(brandKit.primary_keywords || []).join(', ')}

=== EXISTING POSTS (most recent 25) ===
${recent || '(none yet)'}

=== ALREADY QUEUED (do not duplicate) ===
${queuedList}

${gapSummary}
${performanceNote}

=== YOUR TASK ===
First, use web search to sanity-check real search demand and see what is currently ranking for the most promising angles.

Then produce a BALANCED plan of exactly ${count} blog posts. This is a BATCH, judged as a whole. Hard rules:

1. ANTI-REPETITION: No more than ${MAX_PER_TEMPLATE} posts may share the same structural template. A "structural template" is the repeating stem of a title, e.g. "Sell AI Receptionist to [X]", "Best AI Receptionist for [X]", "[X] vs [Y]". If you find yourself writing a third of the same shape, STOP and choose a different angle. The #1 failure mode we are fixing is a blog full of near-identical posts.

2. INTENT SPREAD: Distribute across search intents. Include a mix of: informational/how-to, commercial-investigation (comparisons, "best X"), transactional (pricing, ROI), and at least one PILLAR post (a broad, authoritative cornerstone that supporting posts can link up to). Roughly: 1-2 pillar, the rest spread across the other intents.

3. CLUSTER THINKING: Where sensible, plan a pillar plus 2-3 spokes that would internally link to it, to build topical authority rather than disconnected one-offs.

4. REAL DEMAND: Prefer keywords with genuine search demand and winnable competition for a growing site. Long-tail is fine, but avoid inventing keywords nobody searches.

5. NO CANNIBALIZATION: Do not overlap with existing posts or already-queued items above.

6. FRESHNESS: Factor in what is timely for ${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}.

For each post return:
- rank (1 = write first)
- title
- target_keyword
- post_type (one of: industry, comparison, how-to, cost-analysis, statistics, guide, about, cost-reduction, revenue-growth, brand-marketing, industry-analysis)
- intent (informational | commercial | transactional | pillar)
- template_signature (the structural stem, e.g. "sell ai receptionist to" — used to verify anti-repetition)
- cluster (a short label grouping pillar+spokes, or "standalone")
- reasoning (1 sentence)
- business_impact (high | medium | low)
- notes (any specific angle instructions for the writer)

Return ONLY a valid JSON array, no fences, no prose:
[
  {"rank":1,"title":"...","target_keyword":"...","post_type":"guide","intent":"pillar","template_signature":"...","cluster":"...","reasoning":"...","business_impact":"high","notes":"..."}
]`
    }],
  });

  // Parse JSON array from the response (web search adds intermediate text blocks).
  let plan = null;
  const textBlocks = response.content.filter(b => b.type === 'text');
  for (let i = textBlocks.length - 1; i >= 0; i--) {
    const t = textBlocks[i].text.trim().replace(/```json\n?|```/g, '').trim();
    const m = t.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        const attempt = JSON.parse(m[0]);
        if (Array.isArray(attempt) && attempt.length && attempt[0].target_keyword) { plan = attempt; break; }
      } catch { /* try next */ }
    }
  }
  if (!plan) {
    const all = textBlocks.map(b => b.text).join('\n').replace(/```json\n?|```/g, '');
    const m = all.match(/\[[\s\S]*\]/);
    if (m) { try { plan = JSON.parse(m[0]); } catch { /* noop */ } }
  }
  if (!plan) throw new Error('Planner did not return valid JSON');

  // ── Enforce anti-repetition deterministically (belt and suspenders) ──
  // Even with the prompt rule, hard-cap templates in code so a bad batch
  // can never reach the queue.
  const templateCounts = {};
  const kept = [];
  const dropped = [];
  for (const item of plan) {
    const sig = structuralSignature(item.template_signature || item.title || item.target_keyword);
    templateCounts[sig] = (templateCounts[sig] || 0) + 1;
    if (templateCounts[sig] > MAX_PER_TEMPLATE) { dropped.push(item); continue; }
    kept.push(item);
  }

  // Schedule: stagger across days at perWeek cadence starting tomorrow (or startDate).
  const start = opts.startDate ? new Date(opts.startDate) : new Date(Date.now() + 86400000);
  const gapDays = Math.max(1, Math.round(7 / perWeek));
  const rows = kept.map((item, idx) => {
    const d = new Date(start);
    d.setDate(d.getDate() + idx * gapDays);
    return {
      business_id: business.id,
      target_keyword: item.target_keyword,
      secondary_keywords: Array.isArray(item.secondary_keywords) ? item.secondary_keywords : null,
      post_type: item.post_type || 'guide',
      title_suggestion: item.title || null,
      notes: [item.notes, item.cluster && item.cluster !== 'standalone' ? `Cluster: ${item.cluster}` : null, item.intent ? `Intent: ${item.intent}` : null].filter(Boolean).join(' | ') || null,
      status: 'pending',
      priority: item.rank || idx + 1,
      scheduled_date: d.toISOString().split('T')[0],
    };
  });

  if (dryRun) {
    return { plan: kept, dropped, rows, wrote: 0 };
  }

  const { error } = await supabase.from('blog_content_queue').insert(rows);
  if (error) throw new Error(`Failed to write plan to queue: ${error.message}`);

  return {
    plan: kept,
    dropped,
    wrote: rows.length,
    templates: templateCounts,
    business: business.name,
  };
}