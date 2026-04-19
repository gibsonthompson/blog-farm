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
    model: 'claude-sonnet-4-20250514',
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