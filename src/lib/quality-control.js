import Anthropic from '@anthropic-ai/sdk';
import supabase from './supabase.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Run quality control check on a generated blog post.
 * Uses a separate Claude call to review the content against brand standards.
 */
export async function runQualityControl(postId, business, brandKit) {
  const { data: post } = await supabase
    .from('blog_generated_posts')
    .select('*')
    .eq('id', postId)
    .single();

  if (!post) throw new Error('Post not found');

  const startTime = Date.now();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    system: `You are a strict quality control reviewer for blog posts. You review content against specific brand standards and SEO requirements. You MUST be critical — do not pass content that has issues.

Score each category 1-10 and provide specific feedback. Return ONLY valid JSON.`,

    messages: [{
      role: 'user',
      content: `Review this blog post for ${business.name} (${business.domain}).

=== PRICING THAT MUST BE ACCURATE ===
${brandKit.pricing_info}

=== PHONE NUMBER THAT MUST BE CORRECT ===
${business.phone}

=== GTM ID THAT MUST BE PRESENT ===
${business.gtm_id}

=== THINGS THAT MUST BE PRESENT ===
${brandKit.dos.join('\n')}

=== THINGS THAT MUST NOT APPEAR ===
${brandKit.donts.join('\n')}

=== THE BLOG POST HTML TO REVIEW ===
${post.html_content}

=== INSTRUCTIONS ===
Review the HTML and return a JSON object with this exact structure:
{
  "scores": {
    "seo": <1-10>,
    "aeo_readiness": <1-10>,
    "brand_voice": <1-10>,
    "factual_accuracy": <1-10>,
    "information_gain": <1-10>,
    "technical": <1-10>,
    "content_quality": <1-10>,
    "overall": <1-10>
  },
  "checks": {
    "has_title_tag": <true/false>,
    "title_under_60_chars": <true/false>,
    "title_includes_year": <true/false>,
    "has_meta_description": <true/false>,
    "meta_under_160_chars": <true/false>,
    "has_canonical_url": <true/false>,
    "has_og_tags": <true/false>,
    "has_gtm": <true/false>,
    "has_faq_schema": <true/false>,
    "schema_uses_graph": <true/false — check for @graph combining Article+FAQPage>,
    "has_date_modified": <true/false — dateModified in Article schema>,
    "has_author_attribution": <true/false — author name in schema and visible on page>,
    "has_h1": <true/false>,
    "single_h1": <true/false>,
    "has_internal_links": <true/false>,
    "min_3_internal_links": <true/false>,
    "correct_phone_number": <true/false>,
    "correct_pricing": <true/false>,
    "has_cta": <true/false>,
    "has_footer_compliance": <true/false>,
    "mobile_responsive_css": <true/false>,
    "no_fabricated_testimonials": <true/false>,
    "no_fabricated_revenue_figures": <true/false>,
    "no_generic_ai_intro": <true/false — first 200 words must NOT be generic>,
    "answer_first_structure": <true/false — do H2 sections lead with a direct 40-60 word answer?>,
    "has_statistics_throughout": <true/false — verifiable data points every 150-200 words?>,
    "entity_clarity_in_intro": <true/false — first 200 words define what/who/cost/where?>
  },
  "issues": ["list of specific issues found"],
  "suggestions": ["list of improvement suggestions"],
  "information_gain_assessment": "1-2 sentences on what unique value this post adds vs typical competitor content",
  "aeo_assessment": "1-2 sentences on how well-structured this is for AI engine citation",
  "verdict": "PASS" | "NEEDS_REVISION" | "REJECT"
}

Verdict rules:
- PASS: overall >= 8 AND all critical checks pass (gtm, phone, pricing, no fabrications, answer_first_structure, has_statistics_throughout)
- NEEDS_REVISION: overall 5-7 OR AEO/information gain scores below 7
- REJECT: overall < 5 OR critical brand violations OR information_gain score below 4

IMPORTANT SCORING GUIDANCE:
- information_gain: Score 8+ ONLY if the post contains insights, data, or analysis you would NOT find in the first page of Google results for this keyword. Score 5 or below if it reads like a rewrite of existing content.
- aeo_readiness: Score 8+ ONLY if each major section has a clear, extractable answer that an AI engine could cite standalone. Score 5 or below if answers are buried in paragraphs or require surrounding context.
- content_quality: Score 8+ ONLY if a human expert in this industry would find this genuinely useful. Score 5 or below if it reads like generic AI content with industry terms swapped in.

Return ONLY the JSON — no markdown fences, no explanation.`
    }],
  });

  let qcResult;
  try {
    const text = response.content[0].text.trim().replace(/```json\n?|```/g, '');
    qcResult = JSON.parse(text);
  } catch (e) {
    throw new Error(`QC response was not valid JSON: ${e.message}`);
  }

  const duration = Date.now() - startTime;

  // Update the post with QC results
  await supabase.from('blog_generated_posts').update({
    qc_score: qcResult.scores,
    qc_notes: JSON.stringify({
      checks: qcResult.checks,
      issues: qcResult.issues,
      suggestions: qcResult.suggestions,
    }),
    qc_passed: qcResult.verdict === 'PASS',
    status: qcResult.verdict === 'REJECT' ? 'rejected' : 
            qcResult.verdict === 'NEEDS_REVISION' ? 'revision_needed' : 'pending',
    updated_at: new Date().toISOString(),
  }).eq('id', postId);

  // Log QC step
  await supabase.from('blog_generation_logs').insert({
    post_id: postId,
    step: 'qc',
    status: qcResult.verdict.toLowerCase(),
    details: qcResult,
    duration_ms: duration,
  });

  return qcResult;
}