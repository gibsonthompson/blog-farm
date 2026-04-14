import Anthropic from '@anthropic-ai/sdk';
import supabase from './supabase.js';
import {
  CALLBIRD_BLOG_CSS,
  CALLBIRD_NAV_HTML,
  CALLBIRD_FOOTER_HTML,
  CALLBIRD_FAQ_SCRIPT,
  TEMPLATE_INSTRUCTIONS,
} from '../templates/callbird-blog-template.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────
//  CONTENT FRAMEWORKS LIBRARY
//  The AI selects the best framework based on the topic
//  and research. Prevents every post feeling identical.
// ─────────────────────────────────────────────────────────

const CONTENT_FRAMEWORKS = `
You have access to these content frameworks. Choose the ONE that best fits the topic
and research findings. Do NOT default to the same framework every time.

FRAMEWORK A — "The Hidden Cost"
Hook with a specific dollar figure showing what the problem costs. Walk through the math.
Show cumulative annual impact. Present the solution with ROI calculation.
Best for: cost analysis, ROI, missed calls content.

FRAMEWORK B — "The Definitive Comparison"
Open with the key decision. Quick verdict in the first 100 words. Genuinely fair
feature-by-feature breakdown. Acknowledge where the competitor wins.
End with specific "choose X if..." recommendations.
Best for: competitor comparisons.

FRAMEWORK C — "The Industry Insider"
Open with a vivid scenario specific to that industry. Use industry terminology and
workflows throughout. Include a day-in-the-life walkthrough showing how AI fits
into their actual operations. Write as if you've worked in this industry.
Best for: industry-specific posts.

FRAMEWORK D — "The Data Story"
Lead with the most surprising statistic. Build a narrative around what the data reveals.
Challenge conventional wisdom with evidence. End with actionable takeaways.
Best for: statistics, market trends, research-backed posts.

FRAMEWORK E — "The Step-by-Step Transformation"
Before/after contrast. Walk through each step with specific actions the reader
can take TODAY. Each step standalone-valuable even if they stop reading.
Best for: how-to guides, implementation posts.

FRAMEWORK F — "The Myth Buster"
Open with common misconceptions. Debunk each one with evidence. Creates natural
"information gain" by correcting what other articles repeat uncritically.
Best for: FAQ content, objection handling, "what you need to know" posts.

FRAMEWORK G — "The Decision Framework"
Give readers a systematic way to evaluate options. Create a scoring rubric or
decision tree. Becomes a tool they bookmark and return to.
Best for: evaluation guides, "how to choose" posts.

FRAMEWORK H — "The Expert Roundup"
Structure around the 5-8 most important questions. Each section is a self-contained
answer optimized for AEO citation. Use .aeo-answer boxes for each key answer.
Best for: AEO-optimized posts, comprehensive guides.
`;

// ─────────────────────────────────────────────────────────
//  PHASE 1: RESEARCH & COMPETITIVE ANALYSIS
//  Web search to find what's ranking, identify gaps,
//  and gather fresh data before writing.
// ─────────────────────────────────────────────────────────

async function researchTopic(targetKeyword, postType) {
  const startTime = Date.now();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{
      role: 'user',
      content: `You are a senior SEO content strategist researching a blog post topic.

TARGET KEYWORD: "${targetKeyword}"
POST TYPE: ${postType}
BUSINESS: AI receptionist for small businesses (callbirdai.com, $99-$499/mo)

Research steps:
1. Search "${targetKeyword}" — analyze top 3-5 results. What do they cover? What's WEAK or MISSING?
2. Search for questions people ask about this topic
3. Search for fresh statistics or data (2025-2026) related to this topic

Then return a JSON research brief:
{
  "top_results_summary": "What the top results cover and their specific weaknesses",
  "content_gaps": ["Topics/angles the top results miss — be specific"],
  "unique_angle": "The specific angle WE should take that creates information gain",
  "hook": "A compelling opening — specific stat, scenario, or surprising fact",
  "fresh_data_points": ["Stats/data found with source context"],
  "questions_people_ask": ["Real questions from search results or PAA boxes"],
  "recommended_framework": "A/B/C/D/E/F/G/H",
  "framework_reasoning": "Why this framework fits",
  "suggested_sections": ["Specific section ideas that create information gain"],
  "competitor_claims_to_verify": ["Claims from competitors we should address"]
}

Return ONLY valid JSON. No markdown fences.`
    }],
  });

  const textBlocks = response.content.filter(b => b.type === 'text');
  const text = textBlocks.map(b => b.text).join('\n').trim();

  let research;
  try {
    const cleaned = text.replace(/```json\n?|```/g, '').trim();
    research = JSON.parse(cleaned);
  } catch {
    research = {
      top_results_summary: 'Structured parsing failed — using training knowledge.',
      content_gaps: [],
      unique_angle: `Fresh perspective on ${targetKeyword} for small service businesses`,
      hook: null,
      fresh_data_points: [],
      questions_people_ask: [],
      recommended_framework: postType === 'comparison' ? 'B' : postType === 'industry' ? 'C' : 'E',
      framework_reasoning: 'Default based on post type',
      suggested_sections: [],
      competitor_claims_to_verify: [],
    };
  }

  return { research, duration: Date.now() - startTime };
}

// ─────────────────────────────────────────────────────────
//  PHASE 2: GENERATE THE POST
//  Uses research findings + selected framework + template
// ─────────────────────────────────────────────────────────

function buildGenerationPrompt(brandKit, existingPosts, research, postType) {
  const existingList = existingPosts
    .map(p => `- "${p.title}" [keyword: ${p.primary_keyword || 'N/A'}]`)
    .join('\n');

  return `You are an expert blog writer creating a high-quality, SEO/AEO-optimized blog post.
You have RESEARCH FINDINGS from a competitive analysis. Write a post with genuine
INFORMATION GAIN — it must add something new that top-ranking articles miss.

=== COMPANY ===
${brandKit.company_description}

=== AUDIENCE ===
${brandKit.target_audience}

=== VOICE ===
${brandKit.brand_voice}

=== PRICING (EXACT FIGURES) ===
${brandKit.pricing_info}

=== VALUE PROPS ===
${brandKit.value_propositions.map(v => `• ${v}`).join('\n')}

=== DO ===
${brandKit.dos.map(d => `✅ ${d}`).join('\n')}

=== DON'T ===
${brandKit.donts.map(d => `❌ ${d}`).join('\n')}

=== STYLE EXAMPLES ===
${brandKit.writing_style_examples}

=== CTAs ===
${brandKit.cta_templates.map(c => `• ${c}`).join('\n')}

=== INTERNAL LINK TARGETS — USE THESE THROUGHOUT THE POST ===
Link to at least 3 of these naturally. Choose links that are contextually relevant to the section.
Do NOT force links — they should feel like a natural "learn more" for the reader.

SERVICE PAGES (link when mentioning a specific industry):
${JSON.stringify(brandKit.internal_link_targets, null, 2)}

EXISTING BLOG POSTS (link when a topic overlaps — these are your topical cluster):
${existingPosts.map(p => `- "${p.title}" → ${p.slug}.html [keyword: ${p.primary_keyword || 'N/A'}]`).join('\n') || '(none yet)'}

LINKING RULES:
- Link to service pages when mentioning that industry (e.g., mention dentists → link to /dental)
- Link to related blog posts when covering overlapping topics (e.g., discussing costs → link to cost analysis post)
- Use descriptive anchor text, not "click here" — the anchor should describe what the reader will find
- Spread links across the post, not all bunched in one section
- A comparison post about CallBird vs X should link to other comparison posts for context

=== EXISTING POSTS — DO NOT CANNIBALIZE ===
${existingList || '(none)'}

=== RESEARCH FINDINGS ===
Competition: ${research.top_results_summary}

Gaps we're filling:
${(research.content_gaps || []).map(g => `• ${g}`).join('\n') || '• Use training knowledge to find a unique angle'}

Our angle: ${research.unique_angle}
Hook: ${research.hook || 'Develop a compelling hook based on research'}

Fresh data:
${(research.fresh_data_points || []).map(d => `• ${d}`).join('\n') || '• Use verifiable industry statistics'}

Questions people ask:
${(research.questions_people_ask || []).map(q => `• ${q}`).join('\n') || '• Address common questions for this topic'}

Sections for information gain:
${(research.suggested_sections || []).map(s => `• ${s}`).join('\n') || '• Develop original sections based on gaps'}

=== FRAMEWORK ===
${CONTENT_FRAMEWORKS}

USE FRAMEWORK: ${research.recommended_framework || 'Best fit'}
Reason: ${research.framework_reasoning || 'Select based on topic'}

=== QUALITY BARS ===
1. ANSWER-FIRST STRUCTURE: Every H2 section MUST open with a direct answer in 40-60 words
   inside a .aeo-answer box. This is the snippet AI engines extract and cite. No preamble before it.
2. STATISTICS CADENCE: Include a verifiable data point every 150-200 words. Use the fresh data
   from research. When citing stats, include context ("according to [source type]" or "[year] data shows").
   Never fabricate specific study names or URLs.
3. INFORMATION GAIN: Every section must contain insight the top results DON'T have. If a section
   just restates what any competitor says, rewrite it with a unique angle, deeper analysis, or counter-argument.
4. SPECIFICITY: Exact dollar amounts, specific scenarios with names/details, named workflows. Never vague.
5. ENTITY CLARITY: First 200 words must establish CallBird as an entity — what it is, who it serves,
   what it costs, where it's based. AI engines need this to build entity associations.
6. INTERNAL LINKS: Minimum 3 natural contextual links to related posts and pages.
7. FAQ SCHEMA: 4-6 items answering REAL questions from research. Each answer must be
   self-contained (citable without surrounding context) and 2-4 sentences.
8. SCHEMA STACKING: Use a single <script type="application/ld+json"> with @graph containing
   Article + FAQPage + Organization schemas together, not separate blocks.
9. AUTHOR ATTRIBUTION: Include author "Gibson Thompson, AI Business Solutions Expert" with
   datePublished and dateModified in Article schema. Show in hero-meta section.
10. STRUCTURE: Follow the selected framework. No cookie-cutter layouts.
11. DEPTH: Minimum 2,000 words of substantive content. Quality over padding.
12. NO SLOP: No "in today's fast-paced world." No "cutting-edge solutions." No "leveraging AI."
    No "comprehensive guide to..." openers. Write like a human expert, not a content mill.
13. UNIQUE INTRO: First 200 words must hook with the specific angle from research. Lead with
    a surprising stat, a vivid scenario, or a counterintuitive claim — not a generic definition.
14. HONEST COMPETITOR TREATMENT: Acknowledge real competitor strengths. One-sided content
    loses trust with readers AND AI engines.
15. FRESHNESS SIGNALS: Include current year in title (e.g., "[2026]"), use dateModified in schema,
    reference recent data. AI engines favor recently updated content.

${TEMPLATE_INSTRUCTIONS}

=== CSS (copy verbatim) ===
${CALLBIRD_BLOG_CSS}

=== NAV (copy verbatim) ===
${CALLBIRD_NAV_HTML}

=== FOOTER (copy verbatim) ===
${CALLBIRD_FOOTER_HTML}

=== FAQ SCRIPT (copy verbatim) ===
${CALLBIRD_FAQ_SCRIPT}

=== OUTPUT ===
Return <metadata>{JSON}</metadata> then <html_content>full HTML</html_content>

Metadata JSON:
{
  "title": "under 60 chars, includes keyword",
  "slug": "url-slug",
  "meta_description": "under 160 chars",
  "primary_keyword": "exact target",
  "secondary_keywords": ["2-4 related"],
  "category": "${postType}",
  "read_time": "X min read",
  "emoji": "relevant",
  "excerpt": "2-3 sentences for blog card",
  "word_count": 2200,
  "framework_used": "${research.recommended_framework || 'selected'}",
  "information_gain": "what this post adds that competitors miss"
}`;
}


// ─────────────────────────────────────────────────────────
//  MAIN: generateBlogPost
//  Research → Generate → Save
// ─────────────────────────────────────────────────────────

export async function generateBlogPost(businessSlug, targetKeyword, postType, notes = '') {
  const totalStart = Date.now();

  const { business, brandKit, existingPosts } = await loadBusinessContext(businessSlug);

  // Slug conflict check
  const proposedSlug = targetKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const conflict = existingPosts.find(p => p.slug === proposedSlug);
  if (conflict) {
    throw new Error(`Slug "${proposedSlug}" already exists: "${conflict.title}".`);
  }

  // PHASE 1: Research
  const { research, duration: researchDuration } = await researchTopic(targetKeyword, postType);

  // PHASE 2: Generate
  const systemPrompt = buildGenerationPrompt(brandKit, existingPosts, research, postType);
  const generateStart = Date.now();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Write the blog post now.

TARGET KEYWORD: ${targetKeyword}
POST TYPE: ${postType}
${notes ? `PUBLISHER NOTES: ${notes}` : ''}

Domain: https://${business.domain}
File: ${business.blog_file_prefix}[slug].html
Phone: ${business.phone}
GTM: ${business.gtm_id}

Use the research findings and selected framework. Make it genuinely excellent.`,
    }],
  });

  const text = response.content[0].text;
  const generateDuration = Date.now() - generateStart;

  // Parse
  const metaMatch = text.match(/<metadata>([\s\S]*?)<\/metadata>/);
  if (!metaMatch) throw new Error('No <metadata> block in response');
  let metadata;
  try { metadata = JSON.parse(metaMatch[1].trim()); }
  catch (e) { throw new Error(`Metadata parse failed: ${e.message}`); }

  const htmlMatch = text.match(/<html_content>([\s\S]*?)<\/html_content>/);
  if (!htmlMatch) throw new Error('No <html_content> block in response');
  const htmlContent = htmlMatch[1].trim();

  const wordCount = htmlContent.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 800) throw new Error(`Too short: ${wordCount} words`);

  // Save
  const { data: post, error } = await supabase
    .from('blog_generated_posts')
    .insert({
      business_id: business.id,
      title: metadata.title,
      slug: metadata.slug,
      meta_description: metadata.meta_description,
      primary_keyword: metadata.primary_keyword,
      secondary_keywords: metadata.secondary_keywords || [],
      category: metadata.category,
      read_time: metadata.read_time,
      emoji: metadata.emoji,
      excerpt: metadata.excerpt,
      html_content: htmlContent,
      status: 'pending',
      generation_prompt: `Research: ${research.unique_angle}\nFramework: ${research.recommended_framework}\nKeyword: ${targetKeyword}`,
      word_count: wordCount,
    })
    .select()
    .single();

  if (error) throw new Error(`DB insert failed: ${error.message}`);

  // Log
  await supabase.from('blog_generation_logs').insert([
    {
      post_id: post.id, step: 'research', status: 'success',
      details: {
        target_keyword: targetKeyword,
        framework: research.recommended_framework,
        unique_angle: research.unique_angle,
        gaps_found: (research.content_gaps || []).length,
        data_points: (research.fresh_data_points || []).length,
      },
      duration_ms: researchDuration,
    },
    {
      post_id: post.id, step: 'generate', status: 'success',
      details: {
        model: 'claude-sonnet-4-20250514',
        word_count: wordCount,
        framework_used: metadata.framework_used,
        information_gain: metadata.information_gain,
      },
      duration_ms: generateDuration,
    },
  ]);

  return post;
}


// ─────────────────────────────────────────────────────────
//  CONTEXT LOADER
// ─────────────────────────────────────────────────────────

export async function loadBusinessContext(businessSlug) {
  const { data: biz } = await supabase
    .from('blog_businesses').select('*').eq('slug', businessSlug).single();
  if (!biz) throw new Error(`Business "${businessSlug}" not found`);

  const { data: brandKit } = await supabase
    .from('blog_brand_kits').select('*').eq('business_id', biz.id).single();
  if (!brandKit) throw new Error(`Brand kit for "${businessSlug}" not found`);

  const { data: existingPosts } = await supabase
    .from('blog_existing_posts')
    .select('title, slug, primary_keyword, category')
    .eq('business_id', biz.id)
    .order('publish_date', { ascending: false });

  const { data: generatedPosts } = await supabase
    .from('blog_generated_posts')
    .select('title, slug, primary_keyword, category')
    .eq('business_id', biz.id)
    .in('status', ['pending', 'approved', 'published']);

  return { business: biz, brandKit, existingPosts: [...(existingPosts || []), ...(generatedPosts || [])] };
}