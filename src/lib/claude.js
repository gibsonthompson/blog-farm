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
    max_tokens: 2000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    messages: [{
      role: 'user',
      content: `SEO content strategist: research "${targetKeyword}" for a blog post (${postType}) about AI receptionists for small businesses ($99-$499/mo, callbirdai.com).

Search for "${targetKeyword}" and analyze what's ranking. Then search for related statistics or data.

CRITICAL BUSINESS CONTEXT: CallBird AI is our product. The blog exists to drive free trial signups. Every content angle must position AI receptionists positively and CallBird as the best solution. Never suggest angles that create fear about AI receptionists, recommend competitors, or make the category seem expensive/risky/complicated. The unique angle should make readers WANT an AI receptionist, specifically CallBird.

Return JSON:
{
  "top_results_summary": "Top results and their weaknesses",
  "content_gaps": ["What top results miss — focus on gaps where CallBird can shine"],
  "unique_angle": "Angle that positions CallBird favorably while adding information gain",
  "hook": "Opening hook — stat or scenario that creates urgency to solve the problem",
  "fresh_data_points": ["Stats found — prefer stats showing cost of missed calls, value of AI"],
  "questions_people_ask": ["Questions from search results"],
  "recommended_framework": "A/B/C/D/E/F/G/H",
  "framework_reasoning": "Why",
  "suggested_sections": ["Section ideas that showcase AI receptionist value"],
  "competitor_claims_to_verify": ["Claims to address — focus on where CallBird is better"]
}

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
      hook: null, fresh_data_points: [], questions_people_ask: [],
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

  const prompt = `<role>You are Gibson Thompson, founder of CallBird AI. You've spent years in the small business trenches — you've watched HVAC companies lose $50K/year to missed calls, helped dental offices stop bleeding patients to competitors, and built an AI receptionist that actually works. You have OPINIONS. You think most "AI receptionist" content online is garbage — vague, recycled, and written by people who've never run a business. You're writing to change that.</role>

<audience>Small business owners (1-50 employees) who are skeptical, busy, and tired of being sold to. They Google things like "${targetKeyword}" because they have a REAL problem — missed calls, lost revenue, overwhelmed staff. They will bounce in 10 seconds if your intro sounds like every other AI blog post. They respect specifics. They hate fluff. They make decisions based on math, not hype.</audience>

<reader_outcome>After reading this post, the reader should:
1. Understand something specific they didn't know before (information gain)
2. Be able to calculate or verify a claim themselves (not just trust your numbers)
3. Feel like this was written by someone who understands THEIR industry, not a generic content mill
4. Have a clear next step they can take today, even if they don't buy CallBird</reader_outcome>

<research_findings>
Competition: ${research.top_results_summary}
Gaps we're filling: ${(research.content_gaps || []).join('; ')}
Our angle: ${research.unique_angle}
Hook: ${research.hook || 'Develop based on research'}
Fresh data: ${(research.fresh_data_points || []).join('; ')}
Questions people ask: ${(research.questions_people_ask || []).join('; ')}
Suggested sections: ${(research.suggested_sections || []).join('; ')}
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
- "In today's [adjective] [noun]..." or "In the [adjective] world of..."
- "Whether you're a... or a..." 
- "Let's dive in" / "Let's explore" / "Let's take a closer look"
- "It's no secret that..."  / "It goes without saying..."
- "The bottom line is..." as a section opener
- "Comprehensive guide to..." / "The ultimate guide to..."
- "Cutting-edge" / "Game-changing" / "Revolutionizing" / "Leveraging"
- Lists of 3 with parallel "By [gerund]..." structure
- Any paragraph that starts with "Moreover," "Furthermore," "Additionally,"
- Concluding paragraphs that start with "In conclusion," or restate the intro
- Generic stat boxes that just repeat a number already in the paragraph
- ".aeo-answer" boxes that read like dictionary definitions instead of genuine answers
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
Use: h1, h2, h3, p, ul, li, strong, a, blockquote.
Use class="stat-highlight" for important numbers (sparingly — max 3).
Use class="cta-box" for call-to-action sections (max 2 — one mid-post, one end).
Use class="faq-section" with class="faq-item" for FAQs at the end.
Internal links as <a href="blog-slug-here.html">descriptive anchor text</a>.
Service page links as <a href="https://callbirdai.com/path">anchor text</a>.

DO NOT use class="aeo-answer" boxes. Instead, make your H2 opening paragraphs naturally concise and quotable. An AI engine should be able to extract the first 2 sentences under any H2 as a standalone answer — but it should read like natural writing, not a definition box.
</content>
${notes ? `\n<publisher_notes>${notes}</publisher_notes>` : ''}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 12000,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
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