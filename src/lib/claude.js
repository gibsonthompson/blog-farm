import Anthropic from '@anthropic-ai/sdk';
import supabase from './supabase.js';
import { getWinningPatternsForPrompt } from './performance.js';
import {
  CALLBIRD_BLOG_CSS,
  CALLBIRD_NAV_HTML,
  CALLBIRD_FOOTER_HTML,
  CALLBIRD_FAQ_SCRIPT,
  TEMPLATE_INSTRUCTIONS,
} from '../templates/callbird-blog-template.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CONTENT_FRAMEWORKS = `
Choose the ONE framework that best fits the topic and research. Variety is critical.

A — "The Hidden Cost": The cost of NOT solving the problem. Hook with what the problem costs. Walk through the math. Show ROI of the solution.
B — "The Definitive Comparison": Quick verdict first. Fair feature breakdown. "Choose X if..." endings.
C — "The Industry Insider": Open with vivid industry scenario. Use industry terminology throughout.
D — "The Data Story": Lead with surprising statistic. Build narrative around data.
E — "The Step-by-Step Transformation": Before/after contrast. Each step standalone-valuable.
F — "The Myth Buster": Debunk misconceptions with evidence. Natural information gain.
G — "The Decision Framework": Scoring rubric or decision tree readers bookmark.
H — "The Expert Roundup": 5-8 key questions, each answer AEO-optimized.
`;

// ─────────────────────────────────────────────────────────
//  STEP 1: RESEARCH (~15s)
//  Now accepts business context for multi-tenant research
// ─────────────────────────────────────────────────────────

export async function runResearch(targetKeyword, postType, biz = null, brandKit = null) {
  // Build business context string from brand kit (or fall back to CallBird defaults)
  const companyName = brandKit?.company_description?.split(' is ')[0] || biz?.name || 'CallBird AI';
  const domain = biz?.domain || 'callbirdai.com';
  const pricingSummary = brandKit?.pricing_info || '$99-$499/mo';
  const audienceContext = brandKit?.target_audience?.substring(0, 200) || 'Small business owners';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{
      role: 'user',
      content: `You are researching "${targetKeyword}" to write a blog post (${postType}) for ${domain}.

COMPANY: ${companyName}
AUDIENCE: ${audienceContext}
PRICING: ${pricingSummary}

PERFORM THESE SEARCHES IN ORDER:
1. Search "${targetKeyword}" — analyze top 3-5 results for structure and gaps
2. Search for statistics related to the topic (current year data preferred)
3. Search for a second set of supporting statistics or industry benchmarks

YOUR TWO JOBS:
JOB 1: Find the content gap — what do the top results NOT cover well?
JOB 2: Find REAL statistics from REAL sources. Every stat you return must include the source name and be something you actually found in search results. Do NOT invent statistics.

ANALYZE EACH TOP RESULT FOR:
1. What structure do they use? (so we can deliberately use a DIFFERENT structure)
2. What claims do they make without evidence? (we can do better with real sources)
3. What questions would a reader still have? (we answer those)
4. What industry-specific detail do they skip?

BUSINESS CONTEXT: ${companyName} is our product/platform. Angles must position the solution positively.

Return JSON:
{
  "top_results_summary": "What the top 3 results cover and their SPECIFIC weaknesses",
  "top_results_structure": "The common structure they all follow (so we can avoid it)",
  "content_gaps": ["Specific questions/angles they leave unanswered"],
  "unique_angle": "The ONE thesis that makes our post worth reading after someone has already read the top results",
  "hook": "Opening that immediately signals this post is DIFFERENT",
  "verified_statistics": [
    {"stat": "the actual statistic", "source": "organization or publication name", "context": "what it means for our topic"},
    {"stat": "another real stat", "source": "source name", "context": "relevance"}
  ],
  "questions_people_ask": ["Questions from PAA boxes or search suggestions"],
  "recommended_framework": "A/B/C/D/E/F/G/H",
  "framework_reasoning": "Why this framework DIFFERS from what's ranking",
  "suggested_sections": ["Section ideas that NO competing post has"],
  "competitor_claims_to_verify": ["Claims competitors make without evidence"]
}

CRITICAL: The "verified_statistics" array must ONLY contain stats you actually found in search results. Include the source name for each. If you only found 2 real stats, return 2 — do NOT pad with invented numbers. Empty array is better than fake data.

Frameworks: A=Hidden Cost, B=Comparison, C=Industry Insider, D=Data Story, E=Step-by-Step, F=Myth Buster, G=Decision Framework, H=Expert Roundup.

ONLY valid JSON. No fences.`
    }],
  });

  // Web search responses have multiple text blocks: intermediate commentary + final JSON
  // Extract only the JSON from the last text block, or find JSON anywhere in the output
  const textBlocks = response.content.filter(b => b.type === 'text');
  
  // Try each text block from last to first — the JSON is usually in the final block
  for (let i = textBlocks.length - 1; i >= 0; i--) {
    const blockText = textBlocks[i].text.trim().replace(/```json\n?|```/g, '').trim();
    // Try to find a JSON object in this block
    const jsonMatch = blockText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        // Validate it has expected fields
        if (parsed.unique_angle || parsed.verified_statistics || parsed.content_gaps) {
          return parsed;
        }
      } catch { /* not valid JSON, try next block */ }
    }
  }

  // Fallback: join all text and try to parse
  const allText = textBlocks.map(b => b.text).join('\n').trim().replace(/```json\n?|```/g, '').trim();
  const jsonMatch = allText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch { /* fall through to default */ }
  }

  console.warn(`[blog-farm] Research JSON parsing failed. Raw text blocks: ${textBlocks.length}, total chars: ${allText.length}`);
  return {
    top_results_summary: 'Parsing failed — using training knowledge.',
    content_gaps: [], unique_angle: `Fresh perspective on ${targetKeyword}`,
    hook: null, verified_statistics: [], questions_people_ask: [],
    recommended_framework: postType === 'comparison' ? 'B' : postType === 'industry' ? 'C' : 'E',
    framework_reasoning: 'Default', suggested_sections: [], competitor_claims_to_verify: [],
  };
}

// ─────────────────────────────────────────────────────────
//  STEP 2: WRITE CONTENT (~20s)
//  Fully multi-tenant — all references from brand kit
// ─────────────────────────────────────────────────────────

export async function writeContent(brandKit, existingPosts, research, postType, targetKeyword, notes, referencePosts = [], biz = null) {
  const publishMode = biz?.publish_mode || 'static';
  const domain = biz?.domain || 'callbirdai.com';
  const companyName = biz?.name || 'CallBird AI';
  const phone = biz?.phone;
  const trialUrl = brandKit?.cta_templates?.[0]?.split('→')?.[1]?.trim() || `/signup`;

  // Internal link format depends on publish mode
  const linkPrefix = publishMode === 'nextjs' ? '/blog/' : 'blog-';
  const linkSuffix = publishMode === 'nextjs' ? '' : '.html';
  const serviceBaseUrl = publishMode === 'nextjs' ? '' : `https://${domain}`;

  const existingList = existingPosts
    .map(p => `- "${p.title}" → ${linkPrefix}${p.slug}${linkSuffix}`)
    .join('\n');

  const linkTargets = JSON.stringify(brandKit.internal_link_targets || [], null, 2);

  // Load winning patterns from GSC data
  let performanceInsights = '';
  try {
    const patterns = await getWinningPatternsForPrompt(brandKit.business_id);
    if (patterns) {
      performanceInsights = `<performance_insights>\n${patterns}\n\nApply these insights. They come from real GSC data about what works on YOUR site.\n</performance_insights>`;
    }
  } catch { /* GSC not connected yet */ }

  // Build post type instructions dynamically
  const postTypeInstructions = getPostTypeInstructions(postType, companyName);

  const prompt = `<role>You are Gibson Thompson, founder of ${companyName}. You write like a business owner who's obsessed with the specific problem this post addresses — not like a content marketer filling a keyword slot. Before writing a single word, ask yourself: "If someone has already read the top 3 Google results for this keyword, what does THIS post tell them that those didn't?" If you can't answer that, you need a different angle.</role>

<audience>${brandKit.target_audience}</audience>

<reader_outcome>After reading this post, the reader should:
1. Know ONE specific thing they didn't know before — not a vague insight, but a concrete fact, framework, or calculation they can use immediately
2. Be able to take action TODAY without buying anything — the post must be useful even to readers who never become customers
3. Feel like this was written by someone who thinks differently about this topic than everyone else online
4. Want to try ${companyName} because the content proved its value, not because the CTAs were persuasive</reader_outcome>

<information_gain_mandate>
THIS IS THE MOST IMPORTANT SECTION. READ IT CAREFULLY.

The #1 reason blog posts fail to rank is they say the same thing as every other post on the topic. Google's algorithms specifically measure "information gain" — what unique value this page adds beyond what already exists in the index.

Before writing, use the research findings below to identify the SPECIFIC GAP you're filling. Then structure the ENTIRE post around that gap. Not as one section buried in the middle — as the central thesis of the post.

INFORMATION GAIN TEST — your post must pass at least 2 of these:
□ Does it contain a framework, formula, or methodology the reader hasn't seen elsewhere?
□ Does it challenge a common assumption about this topic with evidence?
□ Does it provide industry-specific detail that generic posts skip?
□ Does it answer a question that the top Google results leave unanswered?
□ Does it combine two topics that are usually covered separately?

STRUCTURAL ORIGINALITY — your post must NOT:
- Follow the same section order as the top Google results
- Use the same calculation/formula template 3+ times with different numbers swapped in
- Have more than 3 H2 sections that could be swapped between any two blog posts and no one would notice
- Read like a product page disguised as a blog post — it must teach something, not just sell
</information_gain_mandate>

<research_findings>
Competition: ${research.top_results_summary}
Structure competitors use (AVOID THIS): ${research.top_results_structure || 'Not analyzed — use a unique structure'}
Gaps we're filling: ${(research.content_gaps || []).join('; ')}
Our angle (THIS IS YOUR THESIS): ${research.unique_angle}
Hook: ${research.hook || 'Develop based on research'}
Questions people ask: ${(research.questions_people_ask || []).join('; ')}
Suggested sections (that NO competitor has): ${(research.suggested_sections || []).join('; ')}

VERIFIED STATISTICS (from actual web search — USE THESE, do not invent your own):
${(research.verified_statistics || []).map(s => `• ${s.stat} (Source: ${s.source}) — ${s.context}`).join('\n') || 'No verified statistics found. Use qualitative language ("most businesses," "a significant portion") instead of specific numbers.'}

STATISTICS RULE — THIS IS NON-NEGOTIABLE:
You may ONLY use statistics that appear in the verified list above. If a stat isn't listed above, you CANNOT use it in the post. No exceptions. If you need a number and don't have one, use qualitative language. NEVER invent a percentage, sample size, or dollar figure. The verified stats above are all you have — use them well, and supplement with your own calculations based on the real pricing figures in the company context below.

Your post should be structured around the unique angle above — not around covering the same ground as competitors.
</research_findings>

${performanceInsights}

<company_context>
${brandKit.company_description}
Pricing: ${brandKit.pricing_info}
${phone ? `Phone: ${phone}` : ''}
Trial: https://${domain}${trialUrl.startsWith('/') ? trialUrl : '/' + trialUrl}

VALUE PROPOSITIONS:
${brandKit.value_propositions.map(v => `• ${v}`).join('\n')}

BRAND VOICE:
${brandKit.brand_voice}

CONTENT RULES — DO:
${brandKit.dos.map(d => `✅ ${d}`).join('\n')}

CONTENT RULES — DON'T:
${brandKit.donts.map(d => `❌ ${d}`).join('\n')}

CTA TEMPLATES (use one or adapt):
${brandKit.cta_templates.map(c => `• ${c}`).join('\n')}
</company_context>

<writing_examples>
${referencePosts.length > 0 ? referencePosts.map((ref, i) => {
    return `--- REFERENCE POST ${i + 1}: "${ref.title}" (${ref.slug}) ---
${ref.text_content || '(content not loaded)'}
--- END REFERENCE ${i + 1} ---`;
  }).join('\n\n') : `No reference posts loaded. Write in a direct, specific, conversational tone.
Use specific numbers, real scenarios, and industry terminology.
Write like a business owner talking to another business owner.`}

MATCH THESE PATTERNS from the reference posts:
- How comparisons are structured (tables, honest pros/cons, real pricing)
- How pricing is always specific, never "affordable" or "competitive"
- How each section delivers standalone value — no filler paragraphs
- The conversational but authoritative tone — confident without being salesy
- How CTAs feel natural, not forced
- How competitor strengths are acknowledged honestly

WRITING STYLE:
${brandKit.writing_style_examples}
</writing_examples>

<content_strategy>
${brandKit.content_strategy || 'No business-specific content strategy loaded. Write in a direct, specific, conversational tone. Use frameworks and real numbers. Avoid fabricated scenarios.'}
</content_strategy>

<post_type>
${postTypeInstructions}
</post_type>

<framework>
${CONTENT_FRAMEWORKS}
Use framework: ${research.recommended_framework || 'Best fit'}
Reason: ${research.framework_reasoning || 'Match topic'}

IMPORTANT: The framework is a GUIDE, not a straitjacket. If a section doesn't earn its place, cut it.
</framework>

<hard_rules>
- Author: Gibson Thompson
- Year: ${new Date().getFullYear()} (never ${new Date().getFullYear() - 1})
- NEVER invent organization names. If you don't know the real source, write "industry data suggests"
- NEVER fabricate precise statistics. Ranges over false precision.
- Every internal link must use real slugs from the existing posts list below
- Min 3 internal links, spread naturally across the post
- 4-6 FAQ items with standalone answers (each answer works if quoted alone by an AI engine)
- NEVER describe product features that aren't explicitly listed in the company context above
- If you include a calculation, VERIFY THE MATH ADDS UP internally
- ${companyName} is the GUIDE, customer is the HERO (StoryBrand)
- NEVER recommend a competitor over ${companyName}. Acknowledge strengths honestly, but always show why ${companyName} is the better fit for the target audience.

EXPERIENCE & CREDIBILITY RULES:
- NEVER fabricate first-person anecdotes. No "I've seen businesses...", "I've helped companies..."
- NEVER claim to have "tested" or "reviewed" products/businesses you haven't
- NEVER invent sample sizes. No "after analyzing 2,074 businesses"
- NEVER present invented percentages as data. Use qualitative language if no verified source.

STRUCTURAL VARIETY:
- Vary paragraph length. Some short (1-2 sentences). Some medium (3-4 sentences).
- Not every section needs a stat box. Use them only 2-3 times for the most important numbers.
- Do NOT repeat the same formula/calculation more than once with different numbers. Show ONE example, summarize the rest.
</hard_rules>

<link_targets>
Service pages (use exact URLs):
${linkTargets}

Existing blog posts — ONLY link to these. DO NOT invent slugs that aren't on this list:
${existingList || '(none)'}

INTERNAL LINK FORMAT: <a href="${linkPrefix}{slug}${linkSuffix}">descriptive anchor text</a>
Service page links: <a href="${serviceBaseUrl}/path">anchor text</a>

⚠️ If a slug is not in the list above, DO NOT link to it. Broken internal links hurt SEO.
</link_targets>

<anti_patterns>
NEVER write these patterns — they mark content as AI-generated:

LANGUAGE PATTERNS:
- "In today's [adjective] [noun]..." or "In the [adjective] world of..."
- "Whether you're a... or a..." 
- "Let's dive in" / "Let's explore" / "Let's take a closer look"
- "It's no secret that..." / "It goes without saying..."
- "The bottom line is..." as a section opener
- "Comprehensive guide to..." / "The ultimate guide to..."
- "Cutting-edge" / "Game-changing" / "Revolutionizing" / "Leveraging"
- Any paragraph that starts with "Moreover," "Furthermore," "Additionally,"
- Concluding paragraphs that start with "In conclusion,"

STRUCTURAL ANTI-PATTERNS:
- Same formula/calculation repeated 3+ times with different numbers
- More than 3 sections with identical internal structure
- Stat boxes in every single section
- "Research shows" or "studies indicate" used more than twice
- ANY unattributed percentage — if it's not in VERIFIED STATISTICS, don't use it
</anti_patterns>

<output_format>
Return TWO blocks:

<metadata>
{
  "title": "under 60 chars, includes keyword, includes ${new Date().getFullYear()}, NOT clickbait",
  "slug": "url-slug-with-keyword",
  "meta_description": "under 155 chars, specific benefit, includes keyword",
  "primary_keyword": "${targetKeyword}",
  "secondary_keywords": ["2-4 related long-tail keywords"],
  "category": "${postType}",
  "read_time": "X min read",
  "emoji": "relevant",
  "excerpt": "2-3 sentences that make someone click — specific, not generic",
  "word_count": 2200,
  "framework_used": "letter",
  "information_gain": "the ONE thing this post covers that no competitor does"
}
</metadata>

<content>
Write the blog post body as clean semantic HTML.
Use: h2 (with id attributes for table of contents), h3, p, ul, li, strong, a, blockquote.
DO NOT include an h1 tag — the template/layout adds the h1.
DO NOT include a "Quick Answer" box or summary box at the top.
Use class="stat-highlight" for important numbers (sparingly — max 3).
Use class="cta-box" for call-to-action sections (max 2 — one mid-post, one end).
Use class="callout" for tip/info boxes.
Use class="table-wrap" around comparison tables.
Use class="faq-section" with class="faq-item" for FAQs at the end.
Internal links as <a href="${linkPrefix}slug-here${linkSuffix}">descriptive anchor text</a>.
Service page links as <a href="${serviceBaseUrl}/path">anchor text</a>.

Make your H2 opening paragraphs naturally concise and quotable — an AI engine should be able to extract the first 2 sentences under any H2 as a standalone answer.
</content>

<self_review>
BEFORE outputting your final response, mentally review against these checks:

STATISTICS CHECK:
1. Every percentage and dollar figure — did it come from VERIFIED STATISTICS? If not, remove or rewrite qualitatively.
2. Calculations using real pricing from the company context are fine.

MATH CHECK:
3. Every formula — does the math produce the stated result?

BUSINESS CHECK:
4. Does any sentence undermine the value proposition?
5. Have you described features not in the company context?

INTERNAL LINKING CHECK:
6. At least 3 internal links? Each using a real slug from the list?

QUALITY CHECK:
7. Would a reader who Googled "${targetKeyword}" learn something they couldn't find on the first page of results?
8. Same formula/template used 3+ times? Fix it.
9. Any fabricated anecdote presented as real? Change to hypothetical.
10. Review the SELF-REVIEW ADDITIONS in the content_strategy section above and verify compliance.
</self_review>
${notes ? `\n<publisher_notes>${notes}</publisher_notes>` : ''}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    thinking: { type: 'enabled', budget_tokens: 5000 },
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlocks = response.content.filter(b => b.type === 'text');
  return textBlocks.map(b => b.text).join('\n').trim();
}

/**
 * Post-type-specific instructions — multi-tenant
 */
function getPostTypeInstructions(postType, companyName) {
  const instructions = {
    'industry': `Write a comprehensive guide about why this specific industry needs the solution.
Structure: Pain points specific to the industry → How the solution solves each → Feature highlights relevant to the industry → Pricing section → FAQ (5+ questions) → CTA.
Include industry-specific terminology and scenarios. Be specific — mention actual workflows, not generic benefits.`,

    'comparison': `Write an honest, detailed comparison between ${companyName} and the specified competitor.
Structure: Quick comparison table → Pricing comparison → Feature-by-feature breakdown → Pros/cons of each → Who should choose which → Verdict → FAQ.
Be fair but highlight ${companyName}'s genuine advantages. If the competitor has advantages in certain areas, acknowledge them — this builds trust.
IMPORTANT: If you don't have current pricing/features for the competitor, note what you do know and be transparent about what may have changed.`,

    'how-to': `Write a practical, step-by-step guide that solves a specific problem.
Structure: The problem and its cost → Step-by-step solution → How ${companyName} fits in → Tips and best practices → FAQ → CTA.
Be actionable — every section should give the reader something they can do right now.`,

    'statistics': `Write a data-driven post packed with specific numbers, statistics, and data points.
Structure: Key statistics overview → Category breakdowns → What the data means → FAQ → CTA.
Every statistic must have context (what it means, source type). Do NOT fabricate specific study names or URLs.`,

    'guide': `Write a comprehensive, authoritative guide on the topic.
Structure: Introduction with the core problem → Detailed sections covering all aspects → Practical examples → Comparison or evaluation criteria → FAQ → CTA.
This should be the definitive resource on the topic.`,

    'about': `Write an AEO-optimized brand awareness post about ${companyName}.
Structure: What it is → Who it's for → How it works → Key features → Pricing → Company background → FAQ.
Optimize for AI engine consumption — clear, factual, structured data that AI assistants can cite.`,

    'cost-analysis': `Write a detailed cost comparison and ROI analysis.
Structure: The current cost of the problem → Traditional solution costs → AI solution costs → Side-by-side comparison → ROI calculation → Break-even timeline → FAQ → CTA.
Use specific dollar figures and calculations. Show the math.`
  };

  return instructions[postType] || instructions['guide'];
}

// ─────────────────────────────────────────────────────────
//  STEP 3: WRAP IN HTML TEMPLATE (~15s)
//  Only used for static (CallBird) mode — nextjs mode
//  extracts metadata+content in the generate route instead
// ─────────────────────────────────────────────────────────

export async function wrapInTemplate(contentOutput, domain, phone, gtmId, blogPrefix) {
  const metaMatch = contentOutput.match(/<metadata>([\s\S]*?)<\/metadata>/);
  const contentMatch = contentOutput.match(/<content>([\s\S]*?)<\/content>/);

  if (!metaMatch) throw new Error('No <metadata> in content output');
  if (!contentMatch) throw new Error('No <content> in content output');

  let metadata;
  try { metadata = JSON.parse(metaMatch[1].trim()); }
  catch (e) { throw new Error(`Metadata parse failed: ${e.message}`); }

  const articleContent = contentMatch[1].trim();
  const today = new Date().toISOString().split('T')[0];

  const prompt = `Take this blog post content and wrap it in a complete, standalone HTML file.

=== METADATA ===
${JSON.stringify(metadata, null, 2)}

=== ARTICLE CONTENT ===
${articleContent}

=== TEMPLATE PARTS TO USE VERBATIM ===

CSS (put in <style> in <head>):
${CALLBIRD_BLOG_CSS}

NAV (put right after <body>):
${CALLBIRD_NAV_HTML}

FOOTER (put before </body>):
${CALLBIRD_FOOTER_HTML}

FAQ SCRIPT (put before </body>):
${CALLBIRD_FAQ_SCRIPT}

=== INSTRUCTIONS ===
${TEMPLATE_INSTRUCTIONS}

Build a complete HTML file with:
1. <!DOCTYPE html> with proper <head> (title, meta description, canonical, OG tags, GTM)
2. Domain: https://${domain}
3. Phone: ${phone}
4. GTM ID: ${gtmId}
5. Canonical URL: https://${domain}/${blogPrefix}${metadata.slug}
6. Article schema + FAQPage schema in single @graph JSON-LD with datePublished: "${today}", dateModified: "${today}", author: "Gibson Thompson"
7. The nav HTML verbatim
8. Hero section with title, meta, read time
9. The article content
10. The footer HTML verbatim
11. The FAQ script verbatim

Return ONLY the complete HTML. No explanation, no markdown fences. Start with <!DOCTYPE html>.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  });

  let html = response.content[0].text.trim();
  html = html.replace(/^```html\n?/, '').replace(/\n?```$/, '');

  return { metadata, html };
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

  // Load reference posts (best existing posts with full content for style matching)
  const { data: referencePosts } = await supabase
    .from('blog_existing_posts')
    .select('title, slug, text_content')
    .eq('business_id', biz.id)
    .eq('is_reference', true)
    .not('text_content', 'is', null)
    .limit(7);

  return {
    business: biz,
    brandKit,
    existingPosts: [...(existingPosts || []), ...(generatedPosts || [])],
    referencePosts: referencePosts || [],
  };
}

// ─────────────────────────────────────────────────────────
//  HTML SANITIZER — runs after template generation
//  Only used for static mode (CallBird)
// ─────────────────────────────────────────────────────────

/**
 * Deterministic post-processing that fixes common generation errors.
 * Runs AFTER wrapInTemplate, BEFORE validation.
 * This is more reliable than prompting — code doesn't hallucinate.
 */
export function sanitizeGeneratedHtml(html, existingSlugs = []) {
  let sanitized = html;

  // Pass 1: Fix multiple H1 tags — keep only the first, convert rest to H2
  const h1Matches = sanitized.match(/<h1[^>]*>/g);
  if (h1Matches && h1Matches.length > 1) {
    let firstH1Found = false;
    sanitized = sanitized.replace(/<h1([^>]*)>([\s\S]*?)<\/h1>/g, (match, attrs, content) => {
      if (!firstH1Found) { firstH1Found = true; return match; }
      return `<h2${attrs}>${content}</h2>`;
    });
  }

  // Pass 2: Fix broken internal links
  // Remove links to non-existent posts
  sanitized = sanitized.replace(/<a\s+href="blog-([^"]+)\.html"([^>]*)>([\s\S]*?)<\/a>/g, (match, slug, attrs, text) => {
    if (existingSlugs.includes(slug)) return match;
    return text; // Keep the text, remove the link
  });

  // Also fix /blog/ format links for nextjs mode
  sanitized = sanitized.replace(/<a\s+href="\/blog\/([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g, (match, slug, attrs, text) => {
    if (existingSlugs.includes(slug)) return match;
    return text;
  });

  // Pass 3: Fix CSS injection — remove any inline <style> tags in article body
  // (Template CSS goes in <head>, not in the article)
  const bodyStart = sanitized.indexOf('<article') || sanitized.indexOf('class="article');
  if (bodyStart > 0) {
    const beforeBody = sanitized.substring(0, bodyStart);
    let afterBody = sanitized.substring(bodyStart);
    afterBody = afterBody.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    sanitized = beforeBody + afterBody;
  }

  return sanitized;
}