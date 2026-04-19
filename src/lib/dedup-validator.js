import Anthropic from '@anthropic-ai/sdk';
import supabase from './supabase.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────
//  DOMAIN-SPECIFIC STOP WORDS
//  On a site about AI receptionists, these words appear in
//  EVERY title. They're noise, not signal. The meaningful
//  differentiation is in the OTHER words.
// ─────────────────────────────────────────────────────────
const DOMAIN_STOP_WORDS = new Set([
  'ai', 'receptionist', 'receptionists', 'best', 'callbird',
  'call', 'bird', 'answering', 'service', 'phone', 'virtual',
]);

const GENERAL_STOP_WORDS = new Set([
  'a','an','the','for','and','or','but','in','on','at','to','of','is','it',
  'by','with','from','as','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','shall','should','may','might','can',
  'could','your','my','our','their','his','her','its','this','that','these',
  'those','what','which','who','whom','how','why','when','where','vs','versus',
  'top','guide','complete','ultimate','about','need','know','why','get',
]);

/**
 * Pre-generation validation.
 * 
 * Strategy (based on SEO best practices):
 * 1. Exact slug match → hard block (true duplicate)
 * 2. High word overlap after removing domain noise → send to Claude for INTENT judgment
 * 3. Low overlap → safe, pass through
 * 
 * Word matching is a FAST PRE-FILTER. Claude makes the actual cannibalization decision
 * based on search intent, not word similarity.
 */
export async function validateKeywordUniqueness(businessId, targetKeyword, postType) {
  const { data: existing } = await supabase
    .from('blog_existing_posts')
    .select('title, slug, primary_keyword, category')
    .eq('business_id', businessId);

  const { data: generated } = await supabase
    .from('blog_generated_posts')
    .select('title, slug, primary_keyword, category')
    .eq('business_id', businessId)
    .in('status', ['pending', 'approved', 'published']);

  const allPosts = [...(existing || []), ...(generated || [])];
  if (allPosts.length === 0) return { safe: true, conflicts: [] };

  // Check for exact slug collision (true duplicate — hard block)
  const targetSlug = targetKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const slugMatch = allPosts.find(p => p.slug === targetSlug);
  if (slugMatch) {
    return {
      safe: false,
      conflicts: [slugMatch],
      reason: `Exact slug collision: "${targetSlug}" already exists as "${slugMatch.title}".`,
    };
  }

  // Find potentially overlapping posts using domain-aware word matching
  const targetWords = domainNormalize(targetKeyword);
  const candidates = [];

  for (const post of allPosts) {
    const titleWords = domainNormalize(post.title);
    const kwWords = post.primary_keyword ? domainNormalize(post.primary_keyword) : '';
    const slugWords = domainNormalize(post.slug.replace(/-/g, ' '));

    // Jaccard on domain-normalized strings (domain noise removed)
    const titleScore = jaccard(targetWords, titleWords);
    const kwScore = kwWords ? jaccard(targetWords, kwWords) : 0;
    const slugScore = jaccard(targetWords, slugWords);
    const bestScore = Math.max(titleScore, kwScore, slugScore);

    // Only consider posts with meaningful overlap (after domain words removed)
    if (bestScore >= 0.4) {
      candidates.push({
        title: post.title,
        keyword: post.primary_keyword,
        slug: post.slug,
        category: post.category,
        overlapScore: bestScore,
      });
    }
  }

  // No meaningful overlap → safe
  if (candidates.length === 0) return { safe: true, conflicts: [] };

  // Send candidates to Claude for INTENT-BASED judgment
  return await judgeWithClaude(targetKeyword, postType, candidates);
}

/**
 * Post-generation validation.
 * Checks the GENERATED title/keyword (which may have drifted from the target).
 */
export async function validatePostUniqueness(businessId, newTitle, newKeyword, newSlug) {
  const { data: existing } = await supabase
    .from('blog_existing_posts')
    .select('title, slug, primary_keyword')
    .eq('business_id', businessId);

  const { data: generated } = await supabase
    .from('blog_generated_posts')
    .select('title, slug, primary_keyword')
    .eq('business_id', businessId)
    .in('status', ['pending', 'approved', 'published']);

  const allPosts = [...(existing || []), ...(generated || [])];

  // Exact slug match = real problem
  const slugMatch = allPosts.find(p => normalize(p.slug) === normalize(newSlug));
  if (slugMatch) {
    return {
      unique: false,
      conflicts: [{ ...slugMatch, matchType: 'exact_slug' }],
      recommendation: `Slug "${newSlug}" already exists. Needs a different slug.`,
    };
  }

  // Check domain-normalized overlap
  const newTitleWords = domainNormalize(newTitle);
  const conflicts = [];

  for (const post of allPosts) {
    const titleScore = jaccard(newTitleWords, domainNormalize(post.title));
    if (titleScore >= 0.6) {
      conflicts.push({ ...post, matchType: 'similar', titleSimilarity: titleScore });
    }
  }

  if (conflicts.length === 0) return { unique: true, conflicts: [] };

  return {
    unique: false,
    conflicts,
    recommendation: `Generated post "${newTitle}" may overlap with: ${conflicts.map(c => `"${c.title}"`).join(', ')}. Review before publishing.`,
  };
}


// ── Helpers ──────────────────────────────────────────────

/**
 * Normalize removing BOTH general and domain-specific stop words.
 * After this, "Best AI Receptionist for Dentists" becomes just "dentists"
 * and "AI Receptionist Medical Offices" becomes "medical offices".
 * This isolates the ACTUAL differentiating topic.
 */
function domainNormalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !GENERAL_STOP_WORDS.has(w) && !DOMAIN_STOP_WORDS.has(w))
    .join(' ');
}

/**
 * Basic normalize (no domain stop words) for slug comparison.
 */
function normalize(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Jaccard similarity: intersection / union.
 */
function jaccard(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(a.split(/\s+/).filter(Boolean));
  const setB = new Set(b.split(/\s+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/**
 * Claude judges SEARCH INTENT overlap, not word similarity.
 * This is the actual cannibalization check.
 */
async function judgeWithClaude(targetKeyword, postType, candidates) {
  const candidateList = candidates
    .map(c => `- "${c.title}" [category: ${c.category || 'unknown'}] [word overlap: ${(c.overlapScore * 100).toFixed(0)}%]`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `You are an SEO expert checking for keyword CANNIBALIZATION — when two pages compete for the SAME search query and user intent.

I want to write a NEW "${postType}" blog post targeting: "${targetKeyword}"

These existing posts have some word overlap:
${candidateList}

IMPORTANT: Shared domain terms like "AI receptionist" do NOT indicate cannibalization. 
What matters is whether a user searching for "${targetKeyword}" would find the existing post equally relevant.

Examples of NOT cannibalization:
- "AI receptionist for dentists" vs "AI receptionist for plumbers" → different industries
- "AI receptionist ROI calculator" vs "What is an AI receptionist" → different intent (cost analysis vs definition)
- "CallBird vs Smith.ai" vs "CallBird vs Ruby" → different competitors

Examples of REAL cannibalization:
- "AI receptionist cost guide" vs "AI receptionist pricing guide" → same intent
- "Best AI receptionist for dental offices" vs "Best AI receptionist for dentists" → same audience

Is the new post safe to write, or would it cannibalize an existing post?
Respond with ONLY valid JSON: {"safe": true/false, "reason": "one sentence explanation"}
No markdown fences.`
    }],
  });

  try {
    const text = response.content[0].text.trim().replace(/```json\n?|```/g, '');
    const result = JSON.parse(text);
    return {
      safe: result.safe,
      conflicts: candidates,
      reason: result.reason,
    };
  } catch {
    // Parse failed — default to SAFE (don't block on parsing errors)
    return { safe: true, conflicts: candidates, reason: 'Could not parse judgment — allowing with caution.' };
  }
}