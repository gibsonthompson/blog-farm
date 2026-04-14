import Anthropic from '@anthropic-ai/sdk';
import supabase from './supabase.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Pre-generation validation: Check if a target keyword is too close
 * to any existing post's keyword/title before spending tokens on generation.
 * 
 * Uses normalized string matching + Claude as a judge for borderline cases.
 * 
 * @returns {{ safe: boolean, conflicts: Array, reason?: string }}
 */
export async function validateKeywordUniqueness(businessId, targetKeyword, postType) {
  // Load all existing posts
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

  const targetNorm = normalize(targetKeyword);
  const conflicts = [];

  for (const post of allPosts) {
    const titleNorm = normalize(post.title);
    const kwNorm = normalize(post.primary_keyword || '');
    const slugNorm = normalize(post.slug);

    // Check 1: High word overlap between target keyword and existing keyword/title
    const kwOverlap = wordOverlap(targetNorm, kwNorm);
    const titleOverlap = wordOverlap(targetNorm, titleNorm);
    const slugOverlap = wordOverlap(targetNorm, slugNorm);

    // Check 2: One contains the other
    const containsMatch = 
      targetNorm.includes(kwNorm) || kwNorm.includes(targetNorm) ||
      targetNorm.includes(slugNorm) || slugNorm.includes(targetNorm);

    if (kwOverlap >= 0.7 || titleOverlap >= 0.6 || containsMatch) {
      conflicts.push({
        existingTitle: post.title,
        existingKeyword: post.primary_keyword,
        existingSlug: post.slug,
        matchType: containsMatch ? 'contains' : 'word_overlap',
        overlapScore: Math.max(kwOverlap, titleOverlap, slugOverlap),
      });
    }
  }

  if (conflicts.length === 0) return { safe: true, conflicts: [] };

  // For borderline cases (1-2 conflicts with < 0.85 overlap), use Claude as a judge
  const highConfidence = conflicts.filter(c => c.overlapScore >= 0.85 || c.matchType === 'contains');
  
  if (highConfidence.length > 0) {
    return {
      safe: false,
      conflicts: highConfidence,
      reason: `Target keyword "${targetKeyword}" directly overlaps with existing post(s): ${highConfidence.map(c => `"${c.existingTitle}" (keyword: ${c.existingKeyword})`).join(', ')}. Choose a different angle or keyword.`,
    };
  }

  // Borderline — ask Claude to judge
  const judgment = await judgeWithClaude(targetKeyword, postType, conflicts);
  return judgment;
}

/**
 * Post-generation validation: After a post is generated, check its
 * actual title and content against all existing posts for overlap.
 * This catches cases where the AI drifted into existing territory
 * despite the prompt instructions.
 * 
 * @returns {{ unique: boolean, conflicts: Array, recommendation?: string }}
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
  const newTitleNorm = normalize(newTitle);
  const newKwNorm = normalize(newKeyword);
  const newSlugNorm = normalize(newSlug);
  const conflicts = [];

  for (const post of allPosts) {
    if (normalize(post.slug) === newSlugNorm) {
      conflicts.push({ ...post, matchType: 'exact_slug' });
      continue;
    }

    const titleSim = wordOverlap(newTitleNorm, normalize(post.title));
    const kwSim = wordOverlap(newKwNorm, normalize(post.primary_keyword || ''));

    if (titleSim >= 0.65 || kwSim >= 0.75) {
      conflicts.push({
        ...post,
        matchType: 'similar',
        titleSimilarity: titleSim,
        keywordSimilarity: kwSim,
      });
    }
  }

  if (conflicts.length === 0) return { unique: true, conflicts: [] };

  return {
    unique: false,
    conflicts,
    recommendation: `Generated post "${newTitle}" (keyword: "${newKeyword}") is too similar to: ${conflicts.map(c => `"${c.title}"`).join(', ')}. The AI should target a different angle.`,
  };
}


// ── Helpers ──────────────────────────────────────────────

/**
 * Normalize a string for comparison:
 * lowercase, remove punctuation, collapse whitespace, remove stop words
 */
function normalize(str) {
  if (!str) return '';
  const stopWords = new Set([
    'a','an','the','for','and','or','but','in','on','at','to','of','is','it',
    'by','with','from','as','are','was','were','be','been','being','have','has',
    'had','do','does','did','will','would','shall','should','may','might','can',
    'could','your','my','our','their','his','her','its','this','that','these',
    'those','what','which','who','whom','how','why','when','where','vs','versus',
  ]);

  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w))
    .join(' ');
}

/**
 * Calculate word overlap ratio between two normalized strings.
 * Returns 0-1 where 1 means identical word sets.
 */
function wordOverlap(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  // Jaccard-like but weighted toward the smaller set
  const smaller = Math.min(wordsA.size, wordsB.size);
  return intersection / smaller;
}

/**
 * Use Claude as a semantic judge for borderline cases.
 */
async function judgeWithClaude(targetKeyword, postType, conflicts) {
  const conflictList = conflicts
    .map(c => `- "${c.existingTitle}" [keyword: ${c.existingKeyword}] [overlap: ${(c.overlapScore * 100).toFixed(0)}%]`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `You are an SEO expert checking for keyword cannibalization.

I want to write a NEW ${postType} blog post targeting: "${targetKeyword}"

These EXISTING posts have some keyword overlap:
${conflictList}

Would the new post cannibalize any of these existing posts? Consider:
- Would they compete for the same search queries?
- Is the target keyword just a slight variation of an existing one?
- Or is it genuinely a different topic/angle despite sharing some words?

Respond with ONLY valid JSON:
{"safe": true/false, "reason": "one sentence explanation"}

No markdown fences.`
    }],
  });

  try {
    const text = response.content[0].text.trim().replace(/```json\n?|```/g, '');
    const result = JSON.parse(text);
    return {
      safe: result.safe,
      conflicts,
      reason: result.reason,
    };
  } catch {
    // If parsing fails, be conservative — block it
    return {
      safe: false,
      conflicts,
      reason: 'Could not determine uniqueness — review manually.',
    };
  }
}