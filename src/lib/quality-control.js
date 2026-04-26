import Anthropic from '@anthropic-ai/sdk';
import supabase from './supabase.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Run quality control check on a generated blog post.
 * Fully multi-tenant — brand references pulled from business + brandKit.
 * Publish-mode aware — skips HTML structure checks for nextjs (article body only).
 */
export async function runQualityControl(postId, business, brandKit) {
  const { data: post } = await supabase
    .from('blog_generated_posts')
    .select('*')
    .eq('id', postId)
    .single();

  if (!post) throw new Error('Post not found');

  const startTime = Date.now();
  const companyName = business.name;
  const publishMode = business.publish_mode || 'static';
  const isNextjs = publishMode === 'nextjs';

  // Extract expected author from brand kit (same logic as claude.js)
  let expectedAuthor = 'Gibson Thompson';
  let authorIsOrg = false;
  const strategy = brandKit?.content_strategy || '';
  const orgMatch = strategy.match(/Author is the ORGANIZATION\s+([^,.\n]+)/i);
  const personMatch = strategy.match(/Author is ALWAYS\s+([^,.\n]+)/i);
  if (orgMatch) {
    expectedAuthor = orgMatch[1].trim();
    authorIsOrg = true;
  } else if (personMatch) {
    expectedAuthor = personMatch[1].trim();
  }

  // For nextjs mode, content is article body only (no DOCTYPE, head, GTM, phone in footer)
  const htmlStructureNote = isNextjs
    ? `\nIMPORTANT: This is article-body-only HTML (rendered inside a Next.js layout). There is NO DOCTYPE, head, title tag, GTM script, footer, or H1. Skip checks for: has_gtm, has_title_tag, has_canonical_url, has_og_tags, has_h1, single_h1, has_footer_compliance, mobile_responsive_css, correct_phone_number. Set those to true (not applicable). Focus on CONTENT QUALITY checks.`
    : '';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    thinking: { type: 'enabled', budget_tokens: 3000 },
    system: `You are a strict quality control reviewer for blog posts. You review content against specific brand standards and SEO requirements. You MUST be critical — do not pass content that has issues. Think carefully before scoring.

Score each category 1-10 and provide specific feedback. Return ONLY valid JSON.`,

    messages: [{
      role: 'user',
      content: `Review this blog post for ${companyName} (${business.domain}).
${htmlStructureNote}

=== COMPANY DESCRIPTION ===
${brandKit.company_description}

=== PRICING THAT MUST BE ACCURATE ===
${brandKit.pricing_info}

${business.phone ? `=== PHONE NUMBER THAT MUST BE CORRECT ===\n${business.phone}` : '=== NO PHONE NUMBER — skip phone checks ==='}

${business.gtm_id ? `=== GTM ID THAT MUST BE PRESENT ===\n${business.gtm_id}` : '=== NO GTM — skip GTM checks ==='}

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
    "schema_uses_graph": <true/false>,
    "has_date_modified": <true/false>,
    "has_author_attribution": <true/false>,
    "has_h1": <true/false>,
    "single_h1": <true/false>,
    "has_internal_links": <true/false>,
    "min_3_internal_links": <true/false>,
    "has_external_links": <true/false — does the post link to any authoritative external source?>,
    "min_2_external_links": <true/false — at least 2 outbound links to non-competing authoritative sources (industry reports, major publications, government data, competitor informational pages)?>,
    "correct_phone_number": <true/false>,
    "correct_pricing": <true/false>,
    "has_cta": <true/false>,
    "has_footer_compliance": <true/false>,
    "mobile_responsive_css": <true/false>,
    "no_fabricated_testimonials": <true/false>,
    "no_fabricated_revenue_figures": <true/false>,
    "no_generic_ai_intro": <true/false — first 200 words must NOT be generic>,
    "answer_first_structure": <true/false — do H2 sections lead with a direct 40-60 word answer?>,
    "has_statistics_throughout": <true/false>,
    "entity_clarity_in_intro": <true/false — first 200 words define what/who/cost/where?>,
    "no_hallucinated_sources": <true/false — CRITICAL: are ALL named organizations real?>,
    "no_fake_statistics": <true/false>,
    "author_matches_expected": <true/false — author byline says "${expectedAuthor}"${authorIsOrg ? ' (organization author)' : ''}, not "${companyName} Team" or generic>,
    "correct_year_references": <true/false — all year references use ${new Date().getFullYear()}, not ${new Date().getFullYear() - 1}>,
    "no_competitor_recommendations": <true/false — Does the post actively PUSH readers toward competitors? Mentioning competitors honestly is FINE and expected in comparison posts. What's NOT okay: "Don't use ${companyName} for [use case], use [competitor] instead." The test: does a reader finish thinking ${companyName} is the best choice for the target audience? If yes, competitor mentions are fine — even generous ones.>,
    "no_category_fear": <true/false — does the post create fear about the product category?>,
    "brand_positioned_favorably": <true/false — does the reader finish wanting to try ${companyName}? NOTE: In comparison posts, acknowledging competitor strengths is a TRUST-BUILDING technique, not a negative signal. The reader should finish thinking "this company is honest AND their product fits my needs better." Both can be true simultaneously.>,
    "brand_claims_accurate": <true/false — does the post accurately reflect the company description and features above? No invented capabilities?>
  },
  "issues": ["list of specific issues found"],
  "suggestions": ["list of improvement suggestions"],
  "hallucination_flags": ["list any organization names, study names, or statistics that appear fabricated — NOTE: statistics from the COMPANY CONTEXT section above (pricing, savings figures, network size, audience stats) are company claims the writer is INSTRUCTED to use — these are NOT hallucinations. Only flag stats attributed to external organizations/studies that cannot be verified."],
  "business_protection_flags": ["list any statements that recommend competitors over ${companyName}, create category fear, or position ${companyName} unfavorably"],
  "information_gain_assessment": "1-2 sentences on unique value vs typical competitor content",
  "aeo_assessment": "1-2 sentences on AI engine citation readiness",
  "verdict": "PASS" | "NEEDS_REVISION" | "REJECT"
}

Verdict rules:
- PASS: overall >= 7 AND seo >= 6 AND aeo_readiness >= 6 AND brand_voice >= 6 AND no hallucination flags AND brand_positioned_favorably
- NEEDS_REVISION: overall 5-6 OR any of (seo, aeo_readiness, brand_voice) below 6 OR hallucination flags found OR category fear
- REJECT: overall < 5 OR factual_accuracy < 5 OR brand_voice < 4 OR multiple fabricated external sources OR post drives readers AWAY from ${companyName}

IMPORTANT: The hallucination_flags array should ONLY contain genuinely fabricated external citations (fake study names, invented organizations, made-up URLs). Company stats from the brand kit, illustrative math, and directional claims labeled as observations are NOT hallucinations and should NOT appear in this array. An empty hallucination_flags array is correct when no external sources are fabricated.

NOTE ON COMPETITOR MENTIONS: Comparison posts SHOULD mention competitors honestly — this builds trust and is the content strategy's explicit instruction. Only flag as a business protection issue if ${companyName} is positioned NEGATIVELY (reader finishes thinking "I should NOT use ${companyName}") or if the post actively recommends a competitor as the better choice for the target audience. Honest acknowledgment of competitor strengths while making the case for ${companyName} is GOOD content, not a violation.

SCORING GUIDANCE — Use these rubrics. Each category has specific criteria per score level.

- seo: Score based on these SPECIFIC criteria:
  9-10: Keyword in title + first 100 words + 2+ H2s. 3+ internal links. 2+ external links to authoritative sources. Clean slug. Meta description under 160 chars with keyword. Image alt tags include keyword variant.
  7-8: Keyword in title + first 100 words. 2+ internal links. 1+ external link. Clean slug. Meta description present.
  5-6: Keyword in title OR first 100 words (not both). Fewer than 2 internal links. No external links. Meta description missing or over 160 chars.
  Below 5: Keyword missing from title AND first 100 words. No internal links. No slug optimization.

- aeo_readiness: Score based on these SPECIFIC criteria:
  9-10: Every H2 section opens with a 40-60 word standalone answer block. FAQ answers work out of context. Product name + price in first 200 words. 2+ stats per 300 words. Comparison table present (if applicable). 2+ external links.
  7-8: Most sections have answer blocks. FAQ answers mostly standalone. Some stats present but density could be higher. Product mentioned in intro.
  5-6: Answer blocks inconsistent — some sections open with context instead of answers. FAQ answers require surrounding context. Low statistics density. No product/price in first 200 words.
  Below 5: No answer block structure. FAQ answers aren't standalone. No data points. AI engines would skip this content.

- brand_voice: Score based on these SPECIFIC criteria:
  9-10: Product mentioned by name 3+ times naturally. Current pricing included. CTA with trial/demo info present.${business.phone ? ' Phone number included.' : ''} Reads like a knowledgeable founder/expert writing to a peer — confident, specific, opinionated. Uses "you/your" throughout. Includes real-world business scenarios. Tone matches the brand voice described in the company context.
  7-8: Product mentioned 2+ times. Some pricing or CTA present. Tone is mostly on-brand. Some business scenarios.
  5-6: Product mentioned 0-1 times. No pricing. Generic CTA or none. Reads like AI-generated content — could be about any product. No specific business scenarios.
  Below 5: Product not mentioned. Wrong product name. Tone completely off-brand or reads like a competitor wrote it.

- content_quality: Score 8+ ONLY if useful to someone who DOESN'T buy ${companyName}. Dressed-up sales pitch = 5 or below.

- technical: Score based on HTML quality:
  9-10: Clean semantic HTML (h2, h3, p, ul, table). Proper heading hierarchy (no skipped levels). All links have correct href format. No broken HTML tags.
  7-8: Mostly clean HTML. Minor issues (skipped heading level, inconsistent formatting).
  5-6: HTML issues (unclosed tags, incorrect nesting, divs where semantic elements should be).
  Below 5: Broken HTML that would render incorrectly.

- factual_accuracy: Score 5 or below if ANY named source cannot be verified. Flag ALL suspicious sources.

- information_gain: Score 8+ ONLY if the post has a unique thesis not in top Google results. "Another comparison" = 4. "A method nobody explains" = 8.

- overall: This is a WEIGHTED score, not a simple average. Calculate as:
  SEO (25%) + AEO_READINESS (25%) + BRAND_VOICE (20%) + INFORMATION_GAIN (15%) + CONTENT_QUALITY (10%) + TECHNICAL (5%).
  If factual_accuracy < 7, cap overall at 6 regardless of other scores.
  The overall score answers: "Would this post rank well, get cited by AI engines, AND represent the brand correctly?"

ADDITIONAL SCORING RULES:
- STRUCTURAL ORIGINALITY: Flag if same calculation template repeated 3+ times. Flag if sections are interchangeable with any competitor blog.
- YEAR CHECK: ${new Date().getFullYear()} only. ${new Date().getFullYear() - 1} used as current = NEEDS_REVISION.
- BUSINESS PROTECTION: Competitor recommendations or category fear = INSTANT REJECT.
- FABRICATED EXPERIENCE: Flag "I've seen..." or "After helping hundreds..." — these are AI hallucinations.
- FABRICATED DATA: Flag "after analyzing X,XXX businesses" without attribution.
- FABRICATED FEATURES: Flag any feature claims not in the company description provided.
- BRAND KIT STATS ARE NOT HALLUCINATIONS: Statistics from the company context above (pricing, savings figures, network size like "35+ carriers", audience stats like "80% of shippers research online") are company claims the writer was given. Do NOT flag these as hallucinations. Only flag stats attributed to EXTERNAL named organizations/studies/reports that cannot be verified.
- ILLUSTRATIVE MATH IS NOT HALLUCINATION: When the writer shows a calculation using hypothetical inputs (e.g., "if your truck runs 100,000 miles at $0.15/mile..."), that is illustrative math, not a fabricated statistic. Only flag it if it's presented as sourced data from a named study.
- MATH VERIFICATION: All calculations must be internally consistent.

Return ONLY the JSON — no markdown fences, no explanation.`
    }],
  });

  let qcResult;
  try {
    const textBlocks = response.content.filter(b => b.type === 'text');
    
    // Try last text block first (most likely to contain the JSON)
    let parsed = null;
    for (let i = textBlocks.length - 1; i >= 0; i--) {
      const blockText = textBlocks[i].text.trim().replace(/```json\n?|```/g, '').trim();
      const jsonMatch = blockText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const attempt = JSON.parse(jsonMatch[0]);
          if (attempt.scores && attempt.verdict) {
            parsed = attempt;
            break;
          }
        } catch { /* try next block */ }
      }
    }

    if (!parsed) throw new Error('No valid QC JSON found in response');
    qcResult = parsed;
  } catch (e) {
    throw new Error(`QC response was not valid JSON: ${e.message}`);
  }

  const duration = Date.now() - startTime;

  // Build descriptive held_reason showing which scores failed
  const scores = qcResult.scores || {};
  const lowScores = Object.entries(scores)
    .filter(([k, v]) => v < 7 && ['seo', 'aeo_readiness', 'brand_voice', 'overall', 'information_gain'].includes(k))
    .map(([k, v]) => `${k}:${v}`)
    .join(', ');
  const heldReason = qcResult.verdict !== 'PASS' && lowScores
    ? `Low scores: ${lowScores}`
    : qcResult.verdict !== 'PASS'
      ? `Verdict: ${qcResult.verdict}`
      : null;

  // Update the post with QC results
  await supabase.from('blog_generated_posts').update({
    qc_score: qcResult.scores,
    qc_notes: JSON.stringify({
      scores: qcResult.scores,
      checks: qcResult.checks,
      issues: qcResult.issues,
      suggestions: qcResult.suggestions,
      held_reason: heldReason,
      hallucination_flags: qcResult.hallucination_flags || [],
      business_protection_flags: qcResult.business_protection_flags || [],
    }),
    qc_passed: qcResult.verdict === 'PASS',
    status: qcResult.verdict === 'REJECT' ? 'rejected' : 
            qcResult.verdict === 'NEEDS_REVISION' ? 'revision_needed' : 'pending',
    updated_at: new Date().toISOString(),
  }).eq('id', postId);

  // Log
  await supabase.from('blog_generation_logs').insert({
    post_id: postId, step: 'qc', status: qcResult.verdict.toLowerCase(),
    details: qcResult, duration_ms: duration,
  });

  return qcResult;
}