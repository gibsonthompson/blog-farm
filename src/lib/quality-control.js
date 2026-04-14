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
    "brand_voice": <1-10>,
    "factual_accuracy": <1-10>,
    "technical": <1-10>,
    "content_quality": <1-10>,
    "overall": <1-10>
  },
  "checks": {
    "has_title_tag": <true/false>,
    "title_under_60_chars": <true/false>,
    "has_meta_description": <true/false>,
    "meta_under_160_chars": <true/false>,
    "has_canonical_url": <true/false>,
    "has_og_tags": <true/false>,
    "has_gtm": <true/false>,
    "has_faq_schema": <true/false>,
    "has_h1": <true/false>,
    "single_h1": <true/false>,
    "has_internal_links": <true/false>,
    "min_2_internal_links": <true/false>,
    "correct_phone_number": <true/false>,
    "correct_pricing": <true/false>,
    "has_cta": <true/false>,
    "has_footer_compliance": <true/false>,
    "mobile_responsive_css": <true/false>,
    "no_fabricated_testimonials": <true/false>,
    "no_fabricated_revenue_figures": <true/false>,
    "no_generic_ai_intro": <true/false>
  },
  "issues": ["list of specific issues found"],
  "suggestions": ["list of improvement suggestions"],
  "verdict": "PASS" | "NEEDS_REVISION" | "REJECT"
}

Verdict rules:
- PASS: overall >= 8 AND all critical checks pass (gtm, phone, pricing, no fabrications)
- NEEDS_REVISION: overall 5-7 OR minor issues that can be auto-fixed
- REJECT: overall < 5 OR critical brand violations

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
