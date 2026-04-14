import supabase from './supabase.js';
import { fetchFileContent } from './github.js';

/**
 * Find existing posts that should link BACK to the new post.
 * Returns 2-3 posts with the best topical relevance.
 */
export async function findRelatedPosts(businessId, newPost, maxLinks = 3) {
  const { data: existingPosts } = await supabase
    .from('blog_existing_posts')
    .select('*')
    .eq('business_id', businessId)
    .neq('slug', newPost.slug);

  if (!existingPosts || existingPosts.length === 0) return [];

  // Score each existing post by relevance to the new post
  const scored = existingPosts.map(existing => {
    let score = 0;

    // Same category = moderate relevance
    if (existing.category === newPost.category) score += 2;

    // Related categories (industry ↔ guide, comparison ↔ guide, etc.)
    const relatedPairs = [
      ['industry', 'guide'], ['industry', 'how-to'], ['industry', 'cost-analysis'],
      ['comparison', 'guide'], ['comparison', 'cost-analysis'],
      ['how-to', 'guide'], ['statistics', 'cost-analysis'],
    ];
    for (const [a, b] of relatedPairs) {
      if ((existing.category === a && newPost.category === b) ||
          (existing.category === b && newPost.category === a)) {
        score += 1;
      }
    }

    // Keyword overlap
    const newWords = normalize(newPost.primary_keyword);
    const existingWords = normalize(existing.primary_keyword || '');
    const titleWords = normalize(existing.title);

    // Shared meaningful words
    const newSet = new Set(newWords.split(/\s+/));
    for (const word of existingWords.split(/\s+/)) {
      if (newSet.has(word)) score += 1;
    }
    for (const word of titleWords.split(/\s+/)) {
      if (newSet.has(word)) score += 0.5;
    }

    // Boost broad/guide posts (they naturally link to specific ones)
    if (['guide', 'statistics', 'cost-analysis'].includes(existing.category)) score += 1;

    // Don't link from direct competitors (comparison of same competitor)
    if (existing.category === 'comparison' && newPost.category === 'comparison') score -= 2;

    return { ...existing, relevanceScore: score };
  });

  // Sort by relevance, take top N
  return scored
    .filter(p => p.relevanceScore > 1) // Minimum relevance threshold
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxLinks);
}

/**
 * Inject a contextual link to the new post into an existing post's HTML.
 * Finds the "Related Posts" or "Learn More" section and adds a card.
 * Falls back to adding a contextual paragraph link before the CTA.
 * 
 * @returns {string|null} Updated HTML, or null if injection failed
 */
export function injectBacklink(existingHtml, newPost, blogPrefix) {
  const newUrl = `${blogPrefix}${newPost.slug}.html`;
  
  // Skip if this post already links to the new one
  if (existingHtml.includes(newUrl) || existingHtml.includes(newPost.slug)) {
    return null;
  }

  // Strategy 1: Add to existing related-grid
  const relatedGridPattern = /<div class="related-grid">/;
  if (relatedGridPattern.test(existingHtml)) {
    const newCard = `
                <a href="${newUrl}" class="related-card"><h4>${escapeHtml(newPost.title)}</h4><p>${escapeHtml(newPost.excerpt || newPost.meta_description || '')}</p></a>`;

    return existingHtml.replace(relatedGridPattern, `<div class="related-grid">${newCard}`);
  }

  // Strategy 2: Add a "See also" paragraph before the last CTA box
  const ctaPattern = /(<div class="cta-box">(?:(?!<div class="cta-box">)[\s\S])*$)/;
  const lastCtaMatch = existingHtml.match(ctaPattern);
  
  if (lastCtaMatch) {
    const seeAlso = `
        <p><strong>Related:</strong> <a href="${newUrl}">${escapeHtml(newPost.title)}</a></p>

`;
    return existingHtml.replace(ctaPattern, seeAlso + lastCtaMatch[0]);
  }

  // Strategy 3: Add before the FAQ section
  const faqPattern = /<div class="faq-section">/;
  if (faqPattern.test(existingHtml)) {
    const seeAlso = `
        <p><strong>You might also like:</strong> <a href="${newUrl}">${escapeHtml(newPost.title)}</a></p>

`;
    return existingHtml.replace(faqPattern, seeAlso + '<div class="faq-section">');
  }

  // No safe injection point found
  return null;
}

/**
 * Build the list of existing post files to update with backlinks.
 * Returns array of { path, content } for the GitHub commit.
 */
export async function buildBacklinkUpdates(owner, repo, branch, businessId, newPost, blogPrefix) {
  const relatedPosts = await findRelatedPosts(businessId, newPost);
  const updates = [];

  for (const related of relatedPosts) {
    const filePath = `${blogPrefix}${related.slug}.html`;
    
    try {
      const file = await fetchFileContent(owner, repo, filePath, branch);
      if (!file) continue;

      const updatedHtml = injectBacklink(file.content, newPost, blogPrefix);
      if (updatedHtml) {
        updates.push({ path: filePath, content: updatedHtml });
      }
    } catch (err) {
      // Skip if file not found or other error — non-critical
      console.error(`Backlink injection skipped for ${filePath}: ${err.message}`);
    }
  }

  return updates;
}


// ── Helpers ──

function normalize(str) {
  if (!str) return '';
  const stopWords = new Set(['a','an','the','for','and','or','in','on','at','to','of','is','vs','best','how']);
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w)).join(' ');
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}