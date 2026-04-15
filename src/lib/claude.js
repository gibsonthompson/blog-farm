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

const CONTENT_FRAMEWORKS = `
Choose the ONE framework that best fits the topic and research. Variety is critical.

A — "The Hidden Cost": The cost of NOT solving the problem. Hook with what missed calls/manual processes cost. Walk through the math. Show ROI of the solution.
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
// ─────────────────────────────────────────────────────────

export async function runResearch(targetKeyword, postType) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 3000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{
      role: 'user',
      content: `You are researching "${targetKeyword}" to write a blog post (${postType}) for callbirdai.com (AI receptionist, $99-$499/mo).

PERFORM THESE SEARCHES IN ORDER:
1. Search "${targetKeyword}" — analyze top 3-5 results for structure and gaps
2. Search for statistics related to the topic (e.g., "missed call statistics small business" or "AI receptionist market data 2026")
3. Search for a second set of statistics (e.g., "cost of missed calls" or "small business phone answering statistics")

YOUR TWO JOBS:
JOB 1: Find the content gap — what do the top results NOT cover well?
JOB 2: Find REAL statistics from REAL sources. Every stat you return must include the source name and be something you actually found in search results. Do NOT invent statistics.

ANALYZE EACH TOP RESULT FOR:
1. What structure do they use? (so we can deliberately use a DIFFERENT structure)
2. What claims do they make without evidence? (we can do better with real sources)
3. What questions would a reader still have? (we answer those)
4. What industry-specific detail do they skip?

BUSINESS CONTEXT: CallBird AI is our product. Angles must position AI receptionists positively. CallBird has NO setup fees, NO per-minute charges, setup takes 10 minutes.

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

Frameworks: A=Hidden Cost (of NOT having AI), B=Comparison, C=Industry Insider, D=Data Story, E=Step-by-Step, F=Myth Buster, G=Decision Framework, H=Expert Roundup.

ONLY valid JSON. No fences.`
    }],
  });

  const textBlocks = response.content.filter(b => b.type === 'text');
  const text = textBlocks.map(b => b.text).join('\n').trim();

  try {
    return JSON.parse(text.replace(/```json\n?|```/g, '').trim());
  } catch {
    return {
      top_results_summary: 'Parsing failed — using training knowledge.',
      content_gaps: [], unique_angle: `Fresh perspective on ${targetKeyword}`,
      hook: null, verified_statistics: [], questions_people_ask: [],
      recommended_framework: postType === 'comparison' ? 'B' : postType === 'industry' ? 'C' : 'E',
      framework_reasoning: 'Default', suggested_sections: [], competitor_claims_to_verify: [],
    };
  }
}

// ─────────────────────────────────────────────────────────
//  STEP 2: WRITE CONTENT (~20s)
// ─────────────────────────────────────────────────────────

export async function writeContent(brandKit, existingPosts, research, postType, targetKeyword, notes, referencePosts = []) {
  const existingList = existingPosts
    .map(p => `- "${p.title}" → blog-${p.slug}.html`)
    .join('\n');

  const linkTargets = JSON.stringify(brandKit.internal_link_targets || [], null, 2);

  const prompt = `<role>You are Gibson Thompson, founder of CallBird AI. You write like a business owner who's obsessed with the specific problem this post addresses — not like a content marketer filling a keyword slot. Before writing a single word, ask yourself: "If a business owner has already read the top 3 Google results for this keyword, what does THIS post tell them that those didn't?" If you can't answer that, you need a different angle.</role>

<audience>Small business owners (1-50 employees) who are skeptical, busy, and have probably already read 2-3 articles on this topic. They've seen the generic ROI calculators, the "top 7 AI receptionists" listicles, and the comparison tables. They are NOT impressed by another version of the same content. They will ONLY keep reading if the first 3 sentences tell them something they haven't heard before.</audience>

<reader_outcome>After reading this post, the reader should:
1. Know ONE specific thing they didn't know before — not a vague insight, but a concrete fact, framework, or calculation they can use immediately
2. Be able to take action TODAY without buying anything — the post must be useful even to readers who never become customers
3. Feel like this was written by someone who thinks differently about this topic than everyone else online
4. Want to try CallBird because the content proved its value, not because the CTAs were persuasive</reader_outcome>

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
- Follow the same section order as the top Google results (research tells you what they cover — deliberately reorder or restructure)
- Use the same calculation/formula template 3+ times with different numbers swapped in (show ONE detailed example, then summarize others in a comparison table or single paragraph)
- Have more than 3 H2 sections that could be swapped between any two AI receptionist blog posts and no one would notice (each section title should only make sense for THIS specific post)
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
You may ONLY use statistics that appear in the verified list above. If a stat isn't listed above, you CANNOT use it in the post. No exceptions. If you need a number and don't have one, use qualitative language: "most small businesses," "the majority of callers," "a significant portion." NEVER invent a percentage, sample size, or dollar figure. The verified stats above are all you have — use them well, and supplement with your own calculations based on CallBird's real pricing ($99/$249/$499).

Your post should be structured around the unique angle above — not around covering the same ground as competitors.
</research_findings>

<company_context>
${brandKit.company_description}
Pricing: ${brandKit.pricing_info}
Phone: Call (505) 594-5806 to test the AI yourself
Trial: https://callbirdai.com/start
</company_context>

<writing_examples>
These are REAL published posts from our site. Study the tone, structure, specificity, and flow. 
Your new post must feel like it belongs alongside these — same voice, same quality, same level of detail.

${referencePosts.length > 0 ? referencePosts.map((ref, i) => {
    return `--- REFERENCE POST ${i + 1}: "${ref.title}" (${ref.slug}.html) ---
${ref.text_content || '(content not loaded)'}
--- END REFERENCE ${i + 1} ---`;
  }).join('\n\n') : `No reference posts loaded. Write in a direct, specific, conversational tone.
Use specific numbers, real scenarios, and industry terminology.
Write like a business owner talking to another business owner.`}

MATCH THESE PATTERNS from the reference posts:
- How comparisons are structured (tables, honest pros/cons, real pricing)
- How pricing is always specific ($99/$249/$499), never "affordable" or "competitive"
- How each section delivers standalone value — no filler paragraphs
- The conversational but authoritative tone — confident without being salesy
- Specific scenarios and industry examples, not abstract business advice
- How CTAs feel natural, not forced — they flow from the content
- How competitor strengths are acknowledged honestly
</writing_examples>

<framework>
${CONTENT_FRAMEWORKS}
Use framework: ${research.recommended_framework || 'Best fit'}
Reason: ${research.framework_reasoning || 'Match topic'}

IMPORTANT: The framework is a GUIDE, not a straitjacket. If a section doesn't earn its place, cut it. A 1,800-word post where every paragraph matters beats a 2,500-word post padded with filler.
</framework>

<hard_rules>
- Author: Gibson Thompson (never "CallBird Team")
- Year: 2026 (never 2025)  
- Pricing: $99/mo Starter, $249/mo Professional, $499/mo Enterprise (exact figures only)
- Phone: (505) 594-5806
- NEVER invent organization names. No "Customer Service Institute." No "[Industry] Research Foundation." If you don't know the real source, write "industry data suggests" or "research indicates"
- NEVER fabricate precise statistics. "roughly 60%" not "62.3%". Ranges over false precision.
- Every internal link must use real slugs from the existing posts list below
- Min 3 internal links, spread naturally across the post
- 4-6 FAQ items with standalone answers (each answer works if quoted alone by an AI engine)

EXPERIENCE & CREDIBILITY RULES:
- NEVER fabricate first-person anecdotes. No "I've seen businesses...", "I've helped companies...", "After working with hundreds of..."
  Instead use HYPOTHETICAL framing: "Consider a plumber who..." or "A typical HVAC company..."
- NEVER claim to have "tested" or "reviewed" or "analyzed data from" products/businesses you haven't.
- NEVER invent sample sizes or data sets. No "after analyzing 2,074 businesses" or "based on data from 500 implementations." These are fabricated authority claims.
- NEVER present invented percentages as data. No "23% of businesses abandon" or "15% of integrations fail" or "3% failure rate vs 8% failure rate." If you don't have a real source, DON'T QUOTE A SPECIFIC NUMBER. Use qualitative language: "some businesses," "a significant portion," "most users."
- NEVER describe CallBird features that aren't explicitly listed in the company context above. If the brand kit doesn't mention Salesforce integration, don't claim it exists. If the brand kit doesn't mention website scraping, don't describe it as a feature. ONLY describe capabilities that are explicitly mentioned.
- For industry scenarios, describe what an AI RECEPTIONIST actually does — answer calls, schedule appointments, detect urgency, send SMS notifications, transfer calls. Do NOT describe it performing technician tasks (diagnosing furnace error codes), clinical tasks (checking medical symptoms), or legal tasks (running conflict checks). The AI answers the phone and connects people to the right human — it doesn't replace the professional.
- If you include a calculation, VERIFY THE MATH ADDS UP internally.
- Statistics must be internally consistent throughout the post.

STRUCTURAL VARIETY:
- Do NOT use numbered "Hidden Cost #1, #2, #3" or "Step 1, Step 2, Step 3" patterns for more than 3 items. Break up long numbered lists into natural prose sections with descriptive H3 headings.
- Vary paragraph length. Some short (1-2 sentences). Some medium (3-4 sentences). Never 5+ identical-length paragraphs in a row.
- Not every section needs a stat box or callout. Use them only when the number genuinely deserves visual emphasis.

BUSINESS-CRITICAL — VIOLATION MEANS INSTANT REJECTION:
- NEVER recommend a competitor over CallBird. Acknowledge competitor strengths in comparisons, but never say "use [competitor] instead" or "only [competitor] offers [feature]." If CallBird has a gap, frame it as a workaround or future feature.
- NEVER create fear about the AI receptionist category. Posts about costs, risks, or complexity must frame these as problems CallBird SOLVES — not reasons to avoid AI receptionists.
- EVERY post must end with the reader wanting to try CallBird. If someone finishes reading and thinks "this seems too expensive/risky/complicated," the post has FAILED.
- CallBird is the GUIDE, customer is the HERO (StoryBrand). Customer has a problem. CallBird helps them solve it. Never position CallBird as the hero.
- CallBird setup takes MINUTES, not months. ROI is immediate from day one. Break-even in DAYS, not months. Never suggest long implementation timelines.
- CallBird IS SOC 2 Type II certified and A2P 10DLC compliant. Always position as a compliant, trustworthy option.
- Cost narrative is SAVINGS: $99-$499/month vs $33,000-$60,000/year for human receptionists. Never frame CallBird as expensive.
- Never suggest users skip CallBird features or use manual workarounds when CallBird handles it natively.
</hard_rules>

<link_targets>
Service pages (use exact URLs):
${JSON.stringify(brandKit.internal_link_targets || [], null, 2)}

Existing blog posts — ONLY link to these. DO NOT invent slugs that aren't on this list:
${existingList || '(none)'}

INTERNAL LINK FORMAT: <a href="blog-{slug}.html">descriptive anchor text</a>
Example: <a href="blog-callbird-vs-rosie.html">our CallBird vs Rosie comparison</a>

⚠️ If a slug is not in the list above, DO NOT link to it. Broken internal links hurt SEO.
</link_targets>

<anti_patterns>
NEVER write these patterns — they instantly mark content as AI-generated:

LANGUAGE PATTERNS:
- "In today's [adjective] [noun]..." or "In the [adjective] world of..."
- "Whether you're a... or a..." 
- "Let's dive in" / "Let's explore" / "Let's take a closer look"
- "It's no secret that..."  / "It goes without saying..."
- "The bottom line is..." as a section opener
- "Comprehensive guide to..." / "The ultimate guide to..."
- "Cutting-edge" / "Game-changing" / "Revolutionizing" / "Leveraging"
- Any paragraph that starts with "Moreover," "Furthermore," "Additionally,"
- Concluding paragraphs that start with "In conclusion," or restate the intro
- "Here's the brutal math" / "Here's what you need to know" — announces the pitch

CREDIBILITY KILLERS:
- First-person fabricated claims: "I've seen...", "I've helped...", "After testing seven services..."
  Instead use: "Consider a business that...", "A typical HVAC company...", "Based on published data..."
- The specific number "$126,000 annually" — unverified viral stat. Use your own calculation instead.
- "85% of callers never call back" without a source — either find the real study or say "most callers move on"
- "Research shows" or "studies indicate" used more than twice — it becomes a credibility crutch

STRUCTURAL TEMPLATE-FILLING (the biggest quality problem):
- Same formula/calculation repeated 3+ times with different industry numbers swapped in.
  INSTEAD: Show ONE detailed walkthrough, then summarize others in a comparison table or single paragraph.
- "Industry 1: [formula] / Industry 2: [formula] / Industry 3: [formula]" parallel structure.
  INSTEAD: Pick the ONE industry most relevant to the keyword and go deep. Mention others briefly.
- More than 3 sections that follow identical internal structure (stat → explanation → formula → result).
  INSTEAD: Vary section formats — one might be a narrative scenario, one a comparison table, one a Q&A.
- Stat boxes or callout boxes appearing in every single section — they lose impact through overuse.
  INSTEAD: Use stat boxes only 2-3 times in the entire post for the most important numbers.
- "Quick Answer" boxes at the top of the post
- Lists of 3 with parallel "By [gerund]..." structure
- Starting the post with a statistic that's immediately restated in a box below it
</anti_patterns>

<output_format>
Return TWO blocks:

<metadata>
{
  "title": "under 60 chars, includes keyword, includes 2026, NOT clickbait",
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
Use: h2, h3, p, ul, li, strong, a, blockquote.
DO NOT include an h1 tag — the template wrapper adds the h1 in the hero section.
DO NOT include a "Quick Answer" box or summary box at the top.
Use class="stat-highlight" for important numbers (sparingly — max 3).
Use class="cta-box" for call-to-action sections (max 2 — one mid-post, one end).
Use class="faq-section" with class="faq-item" for FAQs at the end.
Internal links as <a href="blog-slug-here.html">descriptive anchor text</a>.
Service page links as <a href="https://callbirdai.com/path">anchor text</a>.

Make your H2 opening paragraphs naturally concise and quotable — an AI engine should be able to extract the first 2 sentences under any H2 as a standalone answer without needing a special box.
</content>

<self_review>
BEFORE outputting your final response, mentally review the entire post against these questions:
1. Would a reader who Googled "${targetKeyword}" learn something they couldn't find on the first page of results? If not, your angle isn't unique enough.
2. Does any sentence undermine CallBird's value proposition? (e.g., calling ROI "fiction," suggesting setup is complex, creating doubt about AI receptionists)
3. Have you invented any statistics, sample sizes, data sets, or organization names? Remove them.
4. Have you described CallBird doing things not in the company context? (e.g., integrating with software not listed, performing professional tasks like diagnosis or legal checks) Remove them.
5. Does the math check out? If you show a formula, does the result match the claim?
6. Would Gibson Thompson — a real business owner — actually write this sentence? If it sounds like a content marketer, rewrite it.
7. Are you using the same formula/template 3+ times with different numbers? Show one detailed example and summarize the rest.
</self_review>
${notes ? `\n<publisher_notes>${notes}</publisher_notes>` : ''}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    thinking: { type: 'enabled', budget_tokens: 5000 },
    messages: [{ role: 'user', content: prompt }],
  });

  // With extended thinking, response has thinking blocks + text blocks
  const textBlocks = response.content.filter(b => b.type === 'text');
  return textBlocks.map(b => b.text).join('\n').trim();
}

// ─────────────────────────────────────────────────────────
//  STEP 3: WRAP IN HTML TEMPLATE (~15s)
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
    model: 'claude-sonnet-4-20250514',
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
// ─────────────────────────────────────────────────────────

/**
 * Deterministic post-processing that fixes common generation errors.
 * Runs AFTER wrapInTemplate, BEFORE validation.
 * This is more reliable than prompting — code doesn't hallucinate.
 */
export function sanitizeGeneratedHtml(html, existingSlugs = []) {
  let result = html;

  // 1. Remove duplicate H1 tags inside <article> (hero already has one)
  //    Keep the FIRST h1 (in the hero), remove any inside <article>
  const articleMatch = result.match(/<article[\s\S]*?<\/article>/i);
  if (articleMatch) {
    const articleHtml = articleMatch[0];
    const cleanedArticle = articleHtml.replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, '');
    result = result.replace(articleMatch[0], cleanedArticle);
  }

  // 2. Remove Quick Answer boxes
  result = result.replace(/<div[^>]*class="[^"]*quick-answer[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');

  // 3. Remove .aeo-answer boxes
  result = result.replace(/<div[^>]*class="[^"]*aeo-answer[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');

  // 4. Fix broken internal links — replace with # if slug doesn't exist
  if (existingSlugs.length > 0) {
    result = result.replace(/href="(blog-[^"]*\.html)"/gi, (match, url) => {
      const slug = url.replace(/^blog-/, '').replace(/\.html$/, '');
      if (existingSlugs.includes(slug)) {
        return match; // valid link, keep it
      }
      // Try to find a close match
      const closeMatch = existingSlugs.find(s =>
        s.includes(slug.split('-').slice(0, 2).join('-')) ||
        slug.includes(s.split('-').slice(0, 2).join('-'))
      );
      if (closeMatch) {
        return `href="blog-${closeMatch}.html"`;
      }
      // No match found — remove the link but keep the anchor text
      return 'href="#"';
    });
  }

  // 5. Fix "By CallBird Team" → "By Gibson Thompson" anywhere in hero-meta
  result = result.replace(/By CallBird Team/g, 'By Gibson Thompson');
  result = result.replace(/"CallBird Team"/g, '"Gibson Thompson"');

  // 6. Fix FAQ structure — ensure faq-question buttons have the icon span
  result = result.replace(
    /<button class="faq-question">([^<]*?)(?:<span class="faq-icon">.*?<\/span>)?<\/button>/gi,
    '<button class="faq-question">$1<span class="faq-icon">+</span></button>'
  );

  // 7. Strip any CSS class references to removed components
  result = result.replace(/class="[^"]*(?:quick-answer|aeo-answer|stats-row)[^"]*"/gi, (match) => {
    return match.replace(/quick-answer|aeo-answer|stats-row/g, '').replace(/\s+/g, ' ').trim();
  });

  return result;
}