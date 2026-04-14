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

/**
 * Load brand kit + existing posts for a business
 */
async function loadBusinessContext(businessSlug) {
  const { data: biz } = await supabase
    .from('blog_businesses')
    .select('*')
    .eq('slug', businessSlug)
    .single();

  if (!biz) throw new Error(`Business "${businessSlug}" not found`);

  const { data: brandKit } = await supabase
    .from('blog_brand_kits')
    .select('*')
    .eq('business_id', biz.id)
    .single();

  if (!brandKit) throw new Error(`Brand kit for "${businessSlug}" not found`);

  const { data: existingPosts } = await supabase
    .from('blog_existing_posts')
    .select('title, slug, primary_keyword, category')
    .eq('business_id', biz.id)
    .order('publish_date', { ascending: false });

  // Also check generated posts that are published or pending
  const { data: generatedPosts } = await supabase
    .from('blog_generated_posts')
    .select('title, slug, primary_keyword, category')
    .eq('business_id', biz.id)
    .in('status', ['pending', 'approved', 'published']);

  const allPosts = [...(existingPosts || []), ...(generatedPosts || [])];

  return { business: biz, brandKit, existingPosts: allPosts };
}

/**
 * Build the system prompt from brand kit context
 */
function buildSystemPrompt(brandKit, existingPosts, postType) {
  const existingPostsList = existingPosts
    .map(p => `- "${p.title}" [keyword: ${p.primary_keyword || 'N/A'}] [type: ${p.category || 'N/A'}]`)
    .join('\n');

  return `You are an expert SEO/AEO content strategist and blog writer for a specific business. Your job is to create a complete, publish-ready HTML blog post that meets strict brand, SEO, and quality standards.

=== COMPANY ===
${brandKit.company_description}

=== TARGET AUDIENCE ===
${brandKit.target_audience}

=== BRAND VOICE ===
${brandKit.brand_voice}

=== VALUE PROPOSITIONS ===
${brandKit.value_propositions.map(v => `• ${v}`).join('\n')}

=== PRICING (USE THESE EXACT FIGURES) ===
${brandKit.pricing_info}

=== PRIMARY KEYWORDS TO TARGET ===
${brandKit.primary_keywords.join(', ')}

=== KNOWN COMPETITORS ===
${brandKit.competitor_names.join(', ')}

=== CONTENT RULES — DO ===
${brandKit.dos.map(d => `✅ ${d}`).join('\n')}

=== CONTENT RULES — DON'T ===
${brandKit.donts.map(d => `❌ ${d}`).join('\n')}

=== WRITING STYLE EXAMPLES ===
${brandKit.writing_style_examples}

=== CTA TEMPLATES (use one or adapt) ===
${brandKit.cta_templates.map(c => `• ${c}`).join('\n')}

=== INTERNAL LINK TARGETS (use at least 2) ===
${JSON.stringify(brandKit.internal_link_targets, null, 2)}

=== EXISTING BLOG POSTS (DO NOT CANNIBALIZE THESE KEYWORDS) ===
The following posts already exist. DO NOT target the same primary keyword as any of these.
Choose a DIFFERENT angle, keyword, or topic variation.
${existingPostsList || '(none yet)'}

=== POST TYPE: ${postType.toUpperCase()} ===
${getPostTypeInstructions(postType)}

=== HTML TEMPLATE — USE THIS EXACT STRUCTURE ===
${TEMPLATE_INSTRUCTIONS}

=== EXACT CSS TO USE (copy verbatim into <style> tag) ===
${CALLBIRD_BLOG_CSS}

=== EXACT NAV HTML (copy verbatim) ===
${CALLBIRD_NAV_HTML}

=== EXACT FOOTER HTML (copy verbatim) ===
${CALLBIRD_FOOTER_HTML}

=== EXACT FAQ SCRIPT (copy verbatim before </body>) ===
${CALLBIRD_FAQ_SCRIPT}

=== OUTPUT FORMAT ===
You must return TWO things, clearly separated:

1. A JSON metadata block wrapped in <metadata> tags:
<metadata>
{
  "title": "The blog post title (also used in <title> tag)",
  "slug": "the-url-slug-no-prefix",
  "meta_description": "Under 160 chars, includes primary keyword",
  "primary_keyword": "the main keyword this post targets",
  "secondary_keywords": ["keyword2", "keyword3"],
  "category": "${postType}",
  "read_time": "X min read",
  "emoji": "📋",
  "excerpt": "2-3 sentence excerpt for the blog index card",
  "word_count": 1800
}
</metadata>

2. The complete HTML file wrapped in <html_content> tags:
<html_content>
<!DOCTYPE html>
<html lang="en">
... complete blog post HTML using the exact template above ...
</html>
</html_content>

The HTML must be a COMPLETE standalone file matching the template structure exactly.`;
}

/**
 * Post-type-specific instructions
 */
function getPostTypeInstructions(postType) {
  const instructions = {
    'industry': `Write a comprehensive guide about why this specific industry needs an AI receptionist.
Structure: Pain points specific to the industry → How AI receptionist solves each → Feature highlights relevant to the industry → Pricing section → FAQ (5+ questions) → CTA.
Include industry-specific terminology and scenarios. Be specific — mention actual workflows, not generic benefits.`,

    'comparison': `Write an honest, detailed comparison between CallBird and the specified competitor.
Structure: Quick comparison table → Pricing comparison → Feature-by-feature breakdown → Pros/cons of each → Who should choose which → Verdict → FAQ.
Be fair but highlight CallBird's genuine advantages. If the competitor has advantages in certain areas, acknowledge them — this builds trust.
IMPORTANT: If you don't have current pricing/features for the competitor, note what you do know and be transparent about what may have changed.`,

    'how-to': `Write a practical, step-by-step guide that solves a specific problem.
Structure: The problem and its cost → Step-by-step solution → How CallBird fits in → Tips and best practices → FAQ → CTA.
Be actionable — every section should give the reader something they can do right now.`,

    'statistics': `Write a data-driven post packed with specific numbers, statistics, and data points.
Structure: Key statistics overview → Category breakdowns (market size, cost data, adoption rates, ROI metrics) → What the data means for small businesses → FAQ → CTA.
Every statistic must have context (what it means, source type). Do NOT fabricate specific study names or URLs.`,

    'guide': `Write a comprehensive, authoritative guide on the topic.
Structure: Introduction with the core problem → Detailed sections covering all aspects → Practical examples → Comparison or evaluation criteria → FAQ → CTA.
This should be the definitive resource on the topic — thorough enough that readers don't need to look elsewhere.`,

    'about': `Write an AEO-optimized brand awareness post about CallBird AI.
Structure: What CallBird is → Who it's for → How it works → Key features → Pricing → Company background → FAQ.
Optimize for AI engine consumption — clear, factual, structured data that AI assistants can cite.`,

    'cost-analysis': `Write a detailed cost comparison and ROI analysis.
Structure: The current cost of the problem → Traditional solution costs (with specific salary data) → AI solution costs → Side-by-side comparison → ROI calculation → Break-even timeline → FAQ → CTA.
Use specific dollar figures and calculations. Show the math.`
  };

  return instructions[postType] || instructions['guide'];
}

/**
 * Generate a blog post
 */
export async function generateBlogPost(businessSlug, targetKeyword, postType, notes = '') {
  const startTime = Date.now();
  const { business, brandKit, existingPosts } = await loadBusinessContext(businessSlug);

  // Check for slug conflicts
  const proposedSlug = targetKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const conflict = existingPosts.find(p => p.slug === proposedSlug);
  if (conflict) {
    throw new Error(`Slug "${proposedSlug}" already exists: "${conflict.title}". Choose a different keyword angle.`);
  }

  const systemPrompt = buildSystemPrompt(brandKit, existingPosts, postType);

  const userMessage = `Generate a blog post for the following:

TARGET KEYWORD: ${targetKeyword}
POST TYPE: ${postType}
${notes ? `ADDITIONAL INSTRUCTIONS: ${notes}` : ''}

Domain: https://${business.domain}
File will be saved as: ${business.blog_file_prefix}[slug].html

Remember:
- Complete standalone HTML file
- All SEO elements (title, meta, OG, canonical, JSON-LD FAQ)
- GTM tag: ${business.gtm_id}
- Phone: ${business.phone}
- Minimum 1,500 words of actual content
- At least 2 internal links from the provided targets
- Mobile responsive CSS
- Return both <metadata> and <html_content> blocks`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0].text;

  // Parse metadata
  const metaMatch = text.match(/<metadata>([\s\S]*?)<\/metadata>/);
  if (!metaMatch) throw new Error('No <metadata> block found in generation response');
  
  let metadata;
  try {
    metadata = JSON.parse(metaMatch[1].trim());
  } catch (e) {
    throw new Error(`Failed to parse metadata JSON: ${e.message}`);
  }

  // Parse HTML content
  const htmlMatch = text.match(/<html_content>([\s\S]*?)<\/html_content>/);
  if (!htmlMatch) throw new Error('No <html_content> block found in generation response');
  const htmlContent = htmlMatch[1].trim();

  // Validate minimum requirements
  const wordCount = htmlContent.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 500) {
    throw new Error(`Generated content too short: ${wordCount} words (minimum 500)`);
  }

  const duration = Date.now() - startTime;

  // Save to database
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
      generation_prompt: userMessage.substring(0, 2000),
      word_count: wordCount,
    })
    .select()
    .single();

  if (error) throw new Error(`Database insert failed: ${error.message}`);

  // Log generation
  await supabase.from('blog_generation_logs').insert({
    post_id: post.id,
    step: 'generate',
    status: 'success',
    details: { model: 'claude-sonnet-4-20250514', word_count: wordCount, target_keyword: targetKeyword },
    duration_ms: duration,
  });

  return post;
}

export { loadBusinessContext };