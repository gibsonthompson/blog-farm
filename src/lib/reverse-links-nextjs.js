import supabase from './supabase.js';

/**
 * ─────────────────────────────────────────────────────────────
 *  NEXTJS REVERSE-LINKER  (cluster-aware)
 * ─────────────────────────────────────────────────────────────
 *
 * The original reverse-links.js only works for STATIC (CallBird) mode: it
 * rewrites committed .html files on GitHub. nextjs businesses (VoiceAI, GTC,
 * RSA, JB, Green Line) store post bodies as html_content in Supabase, so they
 * had NO internal reverse-linking at all — a real ranking gap.
 *
 * This module is the nextjs equivalent. When a new post publishes, it:
 *   1. finds 2-3 related already-published posts (cluster > category > keyword)
 *   2. injects a contextual link to the new post into each one's html_content
 *   3. writes the updated html_content back to both blog_existing_posts and
 *      blog_generated_posts (kept in sync)
 *   4. returns the list of updated slugs so the publisher can revalidate them
 *
 * Cluster is the strongest signal: a spoke and its pillar share a cluster
 * label, so they link to each other preferentially, building topical authority
 * instead of scattering disconnected links.
 */

const STOP = new Set(['a','an','the','for','and','or','in','on','at','to','of','is','are','vs','best','how','what','why','your','you','with','2025','2026']);

function normalize(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w)).join(' ');
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Score existing published posts by relevance to the new post.
 * Cluster match dominates, then category, then keyword/title overlap.
 */
function scoreRelated(existing, newPost) {
  let score = 0;

  // Cluster match is the strongest signal (pillar <-> spoke).
  if (newPost.cluster && existing.cluster &&
      newPost.cluster !== 'standalone' &&
      existing.cluster.toLowerCase() === newPost.cluster.toLowerCase()) {
    score += 5;
  }

  // Same category.
  if (existing.category && existing.category === newPost.category) score += 2;

  // Related category pairs.
  const relatedPairs = [
    ['industry', 'guide'], ['industry', 'how-to'], ['industry', 'cost-analysis'],
    ['comparison', 'guide'], ['comparison', 'cost-analysis'],
    ['how-to', 'guide'], ['statistics', 'cost-analysis'],
    ['lawn-maintenance', 'seasonal'], ['cost-and-hiring', 'diagnosis'],
  ];
  for (const [a, b] of relatedPairs) {
    if ((existing.category === a && newPost.category === b) ||
        (existing.category === b && newPost.category === a)) score += 1;
  }

  // Keyword + title overlap.
  const newSet = new Set(normalize(newPost.primary_keyword).split(/\s+/).filter(Boolean));
  for (const w of normalize(existing.primary_keyword || '').split(/\s+/)) if (newSet.has(w)) score += 1;
  for (const w of normalize(existing.title || '').split(/\s+/)) if (newSet.has(w)) score += 0.5;

  // Broad posts naturally link to specific ones.
  if (['guide', 'statistics', 'cost-analysis', 'pillar'].includes(existing.category)) score += 0.5;

  // Avoid linking two direct competitor-comparison posts together.
  if (existing.category === 'comparison' && newPost.category === 'comparison') score -= 2;

  return score;
}

/**
 * Inject a contextual link to newPost into an existing nextjs post body.
 * nextjs bodies are article HTML (h2/p/ul/table/faq), no wrapper chrome.
 * Returns updated html or null if no safe injection point / already linked.
 */
function injectNextjsBacklink(existingHtml, newPost) {
  if (!existingHtml) return null;
  const href = `/blog/${newPost.slug}`;

  // Already links to it — skip.
  if (existingHtml.includes(href) || existingHtml.includes(`/blog/${newPost.slug}"`)) return null;

  const anchor = `<a href="${href}">${escapeHtml(newPost.title)}</a>`;
  const relatedP = `\n<p><strong>Related:</strong> ${anchor}</p>\n`;

  // Strategy 1: before an FAQ section if present.
  const faqPattern = /<(?:div|section)[^>]*class="[^"]*faq[^"]*"[^>]*>/i;
  if (faqPattern.test(existingHtml)) {
    return existingHtml.replace(faqPattern, (m) => relatedP + m);
  }

  // Strategy 2: before the last <h2> (usually the conclusion/CTA area).
  const h2s = [...existingHtml.matchAll(/<h2[\s>]/gi)];
  if (h2s.length >= 2) {
    const lastH2Index = h2s[h2s.length - 1].index;
    return existingHtml.slice(0, lastH2Index) + relatedP + existingHtml.slice(lastH2Index);
  }

  // Strategy 3: append at the end of the body.
  return existingHtml + relatedP;
}

/**
 * Main entry point. Called from publish.js for nextjs businesses.
 * @returns {Promise<{updatedSlugs: string[], count: number}>}
 */
export async function applyNextjsReverseLinks(businessId, newPost, maxLinks = 3) {
  // Only look at published posts with a body to edit.
  const { data: candidates } = await supabase
    .from('blog_existing_posts')
    .select('id, slug, title, primary_keyword, category, cluster, html_content')
    .eq('business_id', businessId)
    .eq('status', 'published')
    .neq('slug', newPost.slug);

  if (!candidates || candidates.length === 0) return { updatedSlugs: [], count: 0 };

  const ranked = candidates
    .map(c => ({ ...c, _score: scoreRelated(c, newPost) }))
    .filter(c => c._score > 1 && c.html_content)
    .sort((a, b) => b._score - a._score)
    .slice(0, maxLinks);

  const updatedSlugs = [];

  for (const related of ranked) {
    const updated = injectNextjsBacklink(related.html_content, newPost);
    if (!updated) continue;

    // Write back to blog_existing_posts (source the site reads for existing set)
    await supabase.from('blog_existing_posts')
      .update({ html_content: updated, last_refreshed: new Date().toISOString() })
      .eq('id', related.id);

    // Keep blog_generated_posts in sync (the table the site actually renders from)
    await supabase.from('blog_generated_posts')
      .update({ html_content: updated, updated_at: new Date().toISOString() })
      .eq('business_id', businessId)
      .eq('slug', related.slug)
      .eq('status', 'published');

    updatedSlugs.push(related.slug);
  }

  return { updatedSlugs, count: updatedSlugs.length };
}