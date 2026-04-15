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
    "entity_clarity_in_intro": <true/false — first 200 words define what/who/cost/where?>,
    "no_hallucinated_sources": <true/false — CRITICAL: are ALL named organizations, institutes, studies real and verifiable? Flag ANY that look invented like "Customer Service Institute" or "Emergency Service Institute">,
    "no_fake_statistics": <true/false — are statistics presented with appropriate hedging when source is unknown? No hyper-specific unattributed percentages like "73.2%">,
    "author_is_gibson_thompson": <true/false — author byline says "Gibson Thompson" not "CallBird Team" or generic>,
    "correct_year_references": <true/false — all year references use 2026, not 2025 or earlier as if current>,
    "no_competitor_recommendations": <true/false — CRITICAL: does the post EVER tell readers to use a competitor instead of CallBird? Does it say "only [competitor] offers [feature]" or "choose [competitor] for [use case]"? This is an INSTANT REJECT.>,
    "no_category_fear": <true/false — does the post create fear/doubt about AI receptionists as a category? Posts should make readers WANT an AI receptionist, not afraid of hidden costs, complexity, or risks.>,
    "callbird_positioned_favorably": <true/false — does the reader finish wanting to try CallBird? Or do they finish thinking "this is too expensive/complicated/risky"?>,
    "callbird_setup_accurate": <true/false — does the post accurately reflect that CallBird setup takes minutes, not weeks/months? That ROI is immediate from captured calls?>
  },
  "issues": ["list of specific issues found"],
  "suggestions": ["list of improvement suggestions"],
  "hallucination_flags": ["list any organization names, study names, or statistics that appear fabricated — be specific"],
  "business_protection_flags": ["list any statements that recommend competitors over CallBird, create fear about AI receptionists, or position CallBird unfavorably"],
  "information_gain_assessment": "1-2 sentences on what unique value this post adds vs typical competitor content",
  "aeo_assessment": "1-2 sentences on how well-structured this is for AI engine citation",
  "verdict": "PASS" | "NEEDS_REVISION" | "REJECT"
}

Verdict rules:
- PASS: overall >= 8 AND all critical checks pass (gtm, phone, pricing, no fabrications, no_hallucinated_sources, no_competitor_recommendations, callbird_positioned_favorably)
- NEEDS_REVISION: overall 5-7 OR AEO/information gain scores below 7 OR hallucination flags found OR category fear detected
- REJECT: overall < 5 OR critical brand violations OR competitor recommendations OR multiple hallucinated sources OR post actively drives readers away from CallBird

IMPORTANT SCORING GUIDANCE:
- information_gain: Score 8+ ONLY if the post contains insights, data, or analysis you would NOT find in the first page of Google results for this keyword. Score 5 or below if it reads like a rewrite of existing content.
- aeo_readiness: Score 8+ ONLY if each major section has a clear, extractable answer that an AI engine could cite standalone. Score 5 or below if answers are buried in paragraphs or require surrounding context.
- content_quality: Score 8+ ONLY if a human expert in this industry would find this genuinely useful. Score 5 or below if it reads like generic AI content with industry terms swapped in.
- factual_accuracy: Score 5 or below if ANY named organization, institute, or study cannot be verified as real. Common AI fabrications include: "[Industry] Service Institute," "[Topic] Research Foundation," or any organization with a generic "[Adjective] [Noun] Institute" pattern. If you aren't confident an organization exists, FLAG IT in hallucination_flags.
- YEAR CHECK: The current year is 2026. If the title or content says "2025" as if it's the current year, that's an immediate NEEDS_REVISION.
- BUSINESS PROTECTION: This is the most important check. If the post recommends ANY competitor over CallBird, suggests users avoid AI receptionists, creates fear about costs/complexity/risks of the product category, or leaves readers thinking "I shouldn't get an AI receptionist" — that is an INSTANT REJECT regardless of all other scores. CallBird's blog exists to drive trial signups, not to scare people away.
- FABRICATED EXPERIENCE: Flag any first-person claims like "I've seen businesses...", "After helping hundreds of...", "I've tested seven services..." These are AI-generated fake anecdotes. The author's name is Gibson Thompson but these experiences are fabricated. Flag them in issues.
- MATH VERIFICATION: If the post includes a calculation or formula, verify the math adds up. If the headline says "$126,000" but the formula calculates to $101,750, that's a factual_accuracy failure. Inconsistent statistics (62% in one section, 74% in another for the same claim) should also be flagged.
- STRUCTURAL VARIETY: If the post uses "Hidden Cost #1, #2, #3, #4, #5" or similar numbered lists with 5+ items, flag as needs_revision. Human experts don't write in rigid numbered sequences — they use narrative flow with descriptive subheadings.

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