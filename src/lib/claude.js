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

A — "The Hidden Cost": Hook with a dollar figure. Walk through the math. Show ROI.
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

Return JSON:
{
  "top_results_summary": "Top results and their weaknesses",
  "content_gaps": ["What top results miss"],
  "unique_angle": "Our angle for information gain",
  "hook": "Opening hook — stat or scenario",
  "fresh_data_points": ["Stats found"],
  "questions_people_ask": ["Questions from search results"],
  "recommended_framework": "A/B/C/D/E/F/G/H",
  "framework_reasoning": "Why",
  "suggested_sections": ["Unique section ideas"],
  "competitor_claims_to_verify": ["Claims to address"]
}

Frameworks: A=Hidden Cost, B=Comparison, C=Industry Insider, D=Data Story, E=Step-by-Step, F=Myth Buster, G=Decision Framework, H=Expert Roundup.

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

export async function writeContent(brandKit, existingPosts, research, postType, targetKeyword, notes) {
  const existingList = existingPosts
    .map(p => `- "${p.title}" → ${p.slug}.html`)
    .join('\n');

  const linkTargets = JSON.stringify(brandKit.internal_link_targets || [], null, 2);

  const prompt = `You are an expert blog writer for an AI receptionist company.
Write a high-quality blog post with genuine INFORMATION GAIN.

=== COMPANY ===
${brandKit.company_description}

=== AUDIENCE ===
${brandKit.target_audience}

=== VOICE ===
${brandKit.brand_voice}

=== PRICING ===
${brandKit.pricing_info}

=== DO ===
${brandKit.dos.map(d => `✅ ${d}`).join('\n')}

=== DON'T ===
${brandKit.donts.map(d => `❌ ${d}`).join('\n')}

=== CTAs ===
${brandKit.cta_templates.map(c => `• ${c}`).join('\n')}

=== LINK TARGETS (service pages) ===
${linkTargets}

=== EXISTING POSTS (link to these + do NOT cannibalize) ===
${existingList || '(none)'}

=== RESEARCH ===
Competition: ${research.top_results_summary}
Gaps: ${(research.content_gaps || []).join('; ')}
Our angle: ${research.unique_angle}
Hook: ${research.hook || 'Develop based on research'}
Fresh data: ${(research.fresh_data_points || []).join('; ')}
Questions: ${(research.questions_people_ask || []).join('; ')}
Sections: ${(research.suggested_sections || []).join('; ')}

=== FRAMEWORK ===
${CONTENT_FRAMEWORKS}
USE: ${research.recommended_framework || 'Best fit'}

=== QUALITY BARS ===
1. ANSWER-FIRST: Every H2 must open with 40-60 word direct answer
2. STATS CADENCE: Verifiable data point every 150-200 words
3. ENTITY CLARITY: First 200 words define what/who/cost/where
4. INTERNAL LINKS: Min 3 natural contextual links
5. FAQ: 4-6 items answering REAL questions from research
6. DEPTH: Min 2,000 words substantive content
7. NO SLOP: No "in today's fast-paced world." Write like a human expert.
8. UNIQUE INTRO: Hook with research angle, not generic definition
9. HONEST: Acknowledge competitor strengths if comparing
10. FRESHNESS: Reference current year, recent data
${notes ? `\nPUBLISHER NOTES: ${notes}` : ''}

=== OUTPUT FORMAT ===
Return TWO blocks:

<metadata>
{
  "title": "under 60 chars, includes keyword and year",
  "slug": "url-slug",
  "meta_description": "under 160 chars",
  "primary_keyword": "${targetKeyword}",
  "secondary_keywords": ["2-4 related"],
  "category": "${postType}",
  "read_time": "X min read",
  "emoji": "relevant",
  "excerpt": "2-3 sentences for blog card",
  "word_count": 2200,
  "framework_used": "letter",
  "information_gain": "what this adds that competitors miss",
  "faq_items": [
    {"question": "Q1?", "answer": "A1"},
    {"question": "Q2?", "answer": "A2"},
    {"question": "Q3?", "answer": "A3"},
    {"question": "Q4?", "answer": "A4"}
  ]
}
</metadata>

<content>
Write the blog post body in clean HTML (just the article content, NOT a full page).
Use semantic HTML: h1, h2, h3, p, ul, li, strong, a.
Use class="aeo-answer" on divs containing direct answers under each H2.
Use class="stat-box" for highlighted statistics.
Use class="cta-box" for call-to-action sections.
Use class="faq-section" with class="faq-item" for FAQs.
Include internal links as <a href="slug.html">anchor text</a>.
</content>`;

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

  return { business: biz, brandKit, existingPosts: [...(existingPosts || []), ...(generatedPosts || [])] };
}