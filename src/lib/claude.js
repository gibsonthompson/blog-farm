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

const RATE_LIMIT_DELAY_MS = 65000; // 65 seconds between API calls

// ─────────────────────────────────────────────────────────
//  CONTENT FRAMEWORKS LIBRARY
// ─────────────────────────────────────────────────────────

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
//  UTILITY
// ─────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────
//  PHASE 1: RESEARCH (web search)
//  ~3K input tokens
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

Return JSON:
{
  "top_results_summary": "What the top results cover and their weaknesses",
  "content_gaps": ["Topics/angles the top results miss"],
  "unique_angle": "Our specific angle that creates information gain",
  "hook": "Compelling opening — stat, scenario, or surprising fact",
  "fresh_data_points": ["Stats/data found with source context"],
  "questions_people_ask": ["Real questions from search results"],
  "recommended_framework": "A/B/C/D/E/F/G/H",
  "framework_reasoning": "Why this framework fits",
  "suggested_sections": ["Section ideas that create information gain"],
  "competitor_claims_to_verify": ["Claims from competitors to address"]
}

Return ONLY valid JSON. No markdown fences.`
    }],
  });

  const textBlocks = response.content.filter(b => b.type === 'text');
  const text = textBlocks.map(b => b.text).join('\n').trim();

  let research;
  try {
    research = JSON.parse(text.replace(/```json\n?|```/g, '').trim());
  } catch {
    research = {
      top_results_summary: 'Parsing failed — using training knowledge.',
      content_gaps: [], unique_angle: `Fresh perspective on ${targetKeyword}`,
      hook: null, fresh_data_points: [], questions_people_ask: [],
      recommended_framework: postType === 'comparison' ? 'B' : postType === 'industry' ? 'C' : 'E',
      framework_reasoning: 'Default', suggested_sections: [], competitor_claims_to_verify: [],
    };
  }

  return { research, duration: Date.now() - startTime };
}

// ─────────────────────────────────────────────────────────
//  PHASE 2: WRITE CONTENT (no HTML template — just content)
//  ~8K input tokens
// ─────────────────────────────────────────────────────────

async function writeContent(brandKit, existingPosts, research, postType, targetKeyword, notes) {
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
//  PHASE 3: WRAP IN HTML TEMPLATE
//  ~6K input tokens (template + content from phase 2)
// ─────────────────────────────────────────────────────────

async function wrapInTemplate(contentOutput, domain, phone, gtmId, blogPrefix) {
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
  // Strip markdown fences if present
  html = html.replace(/^```html\n?/, '').replace(/\n?```$/, '');

  return { metadata, html };
}


// ─────────────────────────────────────────────────────────
//  MAIN: generateBlogPost
//  Research → delay → Write → delay → Template → Save
// ─────────────────────────────────────────────────────────

export async function generateBlogPost(businessSlug, targetKeyword, postType, notes = '') {
  const totalStart = Date.now();
  const { business, brandKit, existingPosts } = await loadBusinessContext(businessSlug);

  // Slug conflict check
  const proposedSlug = targetKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const conflict = existingPosts.find(p => p.slug === proposedSlug);
  if (conflict) throw new Error(`Slug "${proposedSlug}" already exists: "${conflict.title}".`);

  // PHASE 1: Research
  console.log('[blog-farm] Phase 1: Research...');
  const { research, duration: researchDuration } = await researchTopic(targetKeyword, postType);
  console.log(`[blog-farm] Research done (${researchDuration}ms). Waiting for rate limit...`);

  await delay(RATE_LIMIT_DELAY_MS);

  // PHASE 2: Write content
  console.log('[blog-farm] Phase 2: Writing content...');
  const writeStart = Date.now();
  const contentOutput = await writeContent(brandKit, existingPosts, research, postType, targetKeyword, notes);
  const writeDuration = Date.now() - writeStart;
  console.log(`[blog-farm] Content written (${writeDuration}ms). Waiting for rate limit...`);

  await delay(RATE_LIMIT_DELAY_MS);

  // PHASE 3: Wrap in HTML template
  console.log('[blog-farm] Phase 3: HTML template wrapping...');
  const templateStart = Date.now();
  const { metadata, html: htmlContent } = await wrapInTemplate(
    contentOutput, business.domain, business.phone, business.gtm_id, business.blog_file_prefix
  );
  const templateDuration = Date.now() - templateStart;
  console.log(`[blog-farm] HTML done (${templateDuration}ms).`);

  // Word count validation
  const wordCount = htmlContent.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 500) throw new Error(`Too short: ${wordCount} words`);

  const totalDuration = Date.now() - totalStart;

  // Save to database
  const { data: post, error } = await supabase
    .from('blog_generated_posts')
    .insert({
      business_id: business.id,
      title: metadata.title,
      slug: metadata.slug,
      meta_description: metadata.meta_description,
      primary_keyword: metadata.primary_keyword || targetKeyword,
      secondary_keywords: metadata.secondary_keywords || [],
      category: metadata.category || postType,
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

  // Log all phases
  await supabase.from('blog_generation_logs').insert([
    {
      post_id: post.id, step: 'research', status: 'success',
      details: { target_keyword: targetKeyword, framework: research.recommended_framework,
        unique_angle: research.unique_angle, gaps_found: (research.content_gaps || []).length },
      duration_ms: researchDuration,
    },
    {
      post_id: post.id, step: 'write_content', status: 'success',
      details: { model: 'claude-sonnet-4-20250514', framework_used: metadata.framework_used,
        information_gain: metadata.information_gain },
      duration_ms: writeDuration,
    },
    {
      post_id: post.id, step: 'html_template', status: 'success',
      details: { word_count: wordCount },
      duration_ms: templateDuration,
    },
  ]);

  console.log(`[blog-farm] Complete! "${metadata.title}" (${wordCount} words, ${Math.round(totalDuration/1000)}s total)`);
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