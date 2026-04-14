import Anthropic from '@anthropic-ai/sdk';
import supabase from './supabase.js';
import { loadBusinessContext } from './claude.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * The master opportunity map for the AI receptionist niche.
 * This defines every category of content we SHOULD have.
 * The strategist brain compares this against what EXISTS
 * and identifies gaps.
 */
const OPPORTUNITY_MAP = {
  industries: {
    description: 'Industry-specific landing/blog posts: "Best AI Receptionist for [Industry]"',
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
    description: 'Practical how-to guides that solve specific problems',
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
    description: 'Data-packed posts with industry statistics',
    targets: [
      'AI receptionist statistics',
      'missed call statistics for small business',
      'phone call conversion rate statistics',
      'AI adoption in small business statistics',
      'customer service automation statistics',
    ],
  },
  guides: {
    description: 'Comprehensive definitive guides on broad topics',
    targets: [
      'complete guide to AI receptionists',
      'AI receptionist vs chatbot differences',
      'AI answering service ultimate guide',
      'HIPAA compliant AI receptionist guide',
      'best AI answering services ranked',
      'AI receptionist for multi-location businesses',
      'AI receptionist integration guide',
      'choosing between AI and live answering service',
    ],
  },
  aeo: {
    description: 'AEO-optimized posts designed for AI engine citation',
    targets: [
      'what is CallBird AI',
      'CallBird AI features and pricing',
      'AI receptionist FAQ comprehensive',
      'how does AI phone answering work',
    ],
  },
};

/**
 * Analyze existing coverage and identify gaps.
 * Returns a structured analysis without using Claude (fast, deterministic).
 */
function analyzeGaps(existingPosts) {
  const existingSlugs = existingPosts.map(p => p.slug.toLowerCase());
  const existingKeywords = existingPosts.map(p => (p.primary_keyword || '').toLowerCase());
  const existingTitles = existingPosts.map(p => p.title.toLowerCase());

  const gaps = {};

  for (const [category, data] of Object.entries(OPPORTUNITY_MAP)) {
    const covered = [];
    const uncovered = [];

    for (const target of data.targets) {
      const targetLower = target.toLowerCase();
      const slugified = targetLower.replace(/[^a-z0-9]+/g, '-');

      // Check if any existing post covers this topic
      const isCovered = existingSlugs.some(s => s.includes(slugified) || slugified.includes(s)) ||
        existingKeywords.some(k => k.includes(targetLower) || targetLower.includes(k)) ||
        existingTitles.some(t => t.includes(targetLower) || targetLower.includes(t));

      if (isCovered) {
        covered.push(target);
      } else {
        uncovered.push(target);
      }
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
 * Use Claude as a content strategist to recommend the next best posts to write.
 * This is the "big brain" — it considers gaps, business priorities, seasonal relevance,
 * keyword difficulty signals, and AEO optimization.
 * 
 * @param {string} businessSlug 
 * @param {number} count - How many posts to recommend (default 5)
 * @returns {Array} Prioritized recommendations with reasoning
 */
export async function recommendNextPosts(businessSlug, count = 5) {
  const { business, brandKit, existingPosts } = await loadBusinessContext(businessSlug);
  const gaps = analyzeGaps(existingPosts);

  // Build a concise summary of existing coverage
  const existingList = existingPosts
    .map(p => `• "${p.title}" [${p.category || 'unknown'}] — keyword: ${p.primary_keyword || 'N/A'}`)
    .join('\n');

  // Build the gap analysis summary
  const gapSummary = Object.entries(gaps)
    .map(([cat, data]) => {
      const gapList = data.gapTopics.length > 0 
        ? data.gapTopics.map(t => `  - ${t}`).join('\n') 
        : '  (fully covered)';
      return `${cat.toUpperCase()} (${data.coveragePercent}% covered, ${data.uncovered} gaps):\n${gapList}`;
    })
    .join('\n\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `You are an expert SEO content strategist for ${business.name} (${business.domain}), an AI receptionist service for small businesses.

Current date: ${new Date().toISOString().split('T')[0]}

=== EXISTING BLOG POSTS (${existingPosts.length} total) ===
${existingList}

=== GAP ANALYSIS ===
${gapSummary}

=== BUSINESS CONTEXT ===
Target audience: ${brandKit.target_audience}
Primary keywords: ${brandKit.primary_keywords.join(', ')}
Competitors: ${brandKit.competitor_names.join(', ')}

=== YOUR TASK ===
Recommend exactly ${count} blog posts to create next, in priority order. Consider:

1. **Coverage gaps** — What important topics are completely missing?
2. **Business impact** — Which posts would drive the most leads/conversions?
3. **Keyword opportunity** — Target keywords with commercial intent, not just informational
4. **Topical authority** — Fill in clusters to strengthen domain authority in key areas
5. **Seasonal relevance** — Is anything timely right now (${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })})?
6. **AEO optimization** — Which posts would help CallBird get cited by AI engines?
7. **Anti-cannibalization** — Do NOT recommend topics that overlap with existing posts
8. **Competitor vulnerability** — Where can we outrank thin or outdated competitor content?

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
    "post_type": "industry",
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
    const text = response.content[0].text.trim().replace(/```json\n?|```/g, '');
    recommendations = JSON.parse(text);
  } catch (e) {
    throw new Error(`Strategist response was not valid JSON: ${e.message}`);
  }

  return {
    recommendations,
    coverage: gaps,
    existingCount: existingPosts.length,
    totalOpportunities: Object.values(gaps).reduce((sum, g) => sum + g.uncovered, 0),
  };
}

/**
 * Quick gap analysis without Claude (instant, no API cost)
 */
export async function getGapAnalysis(businessSlug) {
  const { existingPosts } = await loadBusinessContext(businessSlug);
  const gaps = analyzeGaps(existingPosts);

  return {
    existingCount: existingPosts.length,
    totalOpportunities: Object.values(gaps).reduce((sum, g) => sum + g.uncovered, 0),
    coverage: gaps,
  };
}
