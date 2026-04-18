import supabase from './supabase.js';
import { commitMultipleFiles, fetchFileContent } from './github.js';
import { submitSitemap } from './google-search-console.js';
import { submitToIndexNow } from './indexnow.js';
import { checkPublishCadence } from './cadence.js';
import { buildBacklinkUpdates } from './reverse-links.js';
import { generateRssFeed } from './rss.js';

function buildBlogCard(post, domain, prefix) {
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  return `
        <!-- AUTO-GENERATED: ${post.slug} -->
        <a href="${prefix}${post.slug}.html" class="post-card">
            <div class="post-image">${post.emoji || '📝'}</div>
            <div class="post-content">
                <span class="post-category">${post.category || 'Guide'}</span>
                <h3 class="post-title">${post.title}</h3>
                <p class="post-excerpt">${post.excerpt || post.meta_description || ''}</p>
                <div class="post-meta">
                    <span>📅 ${dateStr}</span>
                    <span>•</span>
                    <span>${post.read_time || '10 min read'}</span>
                </div>
            </div>
        </a>`;
}

function insertCardIntoBlogHtml(blogHtml, cardHtml) {
  const markerPattern = '<!-- NEW_POSTS_INSERTION_POINT -->';
  if (blogHtml.includes(markerPattern)) return blogHtml.replace(markerPattern, markerPattern + '\n' + cardHtml);
  const gridPattern = /<div class="posts-grid">/i;
  if (gridPattern.test(blogHtml)) return blogHtml.replace(gridPattern, `<div class="posts-grid">\n${cardHtml}`);
  const sectionPattern = /<h2[^>]*class="section-title"[^>]*>.*?<\/h2>/i;
  const match = blogHtml.match(sectionPattern);
  if (match) { const p = blogHtml.indexOf(match[0]) + match[0].length; return blogHtml.slice(0, p) + '\n' + cardHtml + blogHtml.slice(p); }
  throw new Error('Could not find insertion point in blog.html.');
}

function insertUrlIntoSitemap(sitemapXml, url, date) {
  const entry = `\n  <url>\n    <loc>${url}</loc>\n    <lastmod>${date}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  const updated = sitemapXml.replace('</urlset>', `${entry}\n</urlset>`);
  const pat = /(<loc>https?:\/\/[^<]*\/blog(?:\.html)?<\/loc>\s*<lastmod>)[^<]*(<\/lastmod>)/;
  return updated.replace(pat, `$1${date}$2`);
}

/**
 * Full publish pipeline.
 * Branches on biz.publish_mode:
 *   'static'  → commit HTML to GitHub (CallBird)
 *   'nextjs'  → DB update + ISR revalidation (VoiceAI Connect)
 */
export async function publishPost(postId) {
  const startTime = Date.now();

  const { data: post, error: postError } = await supabase
    .from('blog_generated_posts').select('*, blog_businesses(*)').eq('id', postId).single();
  if (postError || !post) throw new Error(`Post not found: ${postError?.message}`);
  if (post.status === 'published') throw new Error('Post is already published');

  const biz = post.blog_businesses;
  const today = new Date().toISOString().split('T')[0];
  const publishMode = biz.publish_mode || 'static';
  const results = { steps: [], errors: [] };

  // Cadence check (shared)
  const cadence = await checkPublishCadence(biz.id, post.category);
  if (!cadence.allowed) return { steps: [], errors: [{ step: 'cadence_check', error: cadence.reason }], blocked: true, suggestedDate: cadence.suggestedDate };
  results.steps.push({ step: 'cadence_check', status: 'passed' });

  // ─── STATIC MODE (CallBird) ───────────────────────────────────────────────
  if (publishMode === 'static') {
    const owner = biz.github_owner, repo = biz.github_repo, branch = biz.github_branch || 'main';
    const blogFilePath = `${biz.blog_file_prefix}${post.slug}.html`;
    const blogUrl = `https://${biz.domain}/${blogFilePath}`;
    const sitemapUrl = blogUrl.replace(/\.html$/, '');

    try {
      const [blogHtmlFile, sitemapFile] = await Promise.all([
        fetchFileContent(owner, repo, biz.blog_index_path, branch),
        fetchFileContent(owner, repo, biz.sitemap_path, branch),
      ]);
      if (!blogHtmlFile) throw new Error(`Could not fetch ${biz.blog_index_path}`);
      if (!sitemapFile) throw new Error(`Could not fetch ${biz.sitemap_path}`);

      const cardHtml = buildBlogCard(post, biz.domain, biz.blog_file_prefix);
      const updatedBlogHtml = insertCardIntoBlogHtml(blogHtmlFile.content, cardHtml);
      const updatedSitemap = insertUrlIntoSitemap(sitemapFile.content, sitemapUrl, today);

      let backlinkUpdates = [];
      try {
        backlinkUpdates = await buildBacklinkUpdates(owner, repo, branch, biz.id, post, biz.blog_file_prefix);
        if (backlinkUpdates.length > 0) results.steps.push({ step: 'reverse_links', status: 'success', count: backlinkUpdates.length });
      } catch (err) { results.errors.push({ step: 'reverse_links', error: err.message }); }

      const allFiles = [
        { path: blogFilePath, content: post.html_content },
        { path: biz.blog_index_path, content: updatedBlogHtml },
        { path: biz.sitemap_path, content: updatedSitemap },
        ...backlinkUpdates,
      ];
      const commitResult = await commitMultipleFiles(owner, repo, allFiles,
        `blog: add ${post.slug}${backlinkUpdates.length > 0 ? ` + ${backlinkUpdates.length} backlinks` : ''}`, branch);
      results.steps.push({ step: 'github_commit', status: 'success', sha: commitResult.sha, filesCommitted: allFiles.length });

      await supabase.from('blog_generated_posts').update({
        status: 'published', publish_date: today, github_commit_sha: commitResult.sha, updated_at: new Date().toISOString(),
      }).eq('id', postId);

      await supabase.from('blog_existing_posts').upsert({
        business_id: biz.id, url: blogUrl, title: post.title, slug: post.slug,
        primary_keyword: post.primary_keyword, secondary_keywords: post.secondary_keywords,
        meta_description: post.meta_description, category: post.category,
        publish_date: today, word_count: post.word_count,
      }, { onConflict: 'business_id,slug', ignoreDuplicates: false });
      results.steps.push({ step: 'database_update', status: 'success' });

    } catch (err) {
      results.errors.push({ step: 'static_publish', error: err.message });
      await logStep(postId, 'publish', 'error', { error: err.message }, Date.now() - startTime);
      throw err;
    }

    // RSS feed (static — commit file)
    try {
      const feedXml = await generateRssFeed(biz.id);
      if (feedXml) {
        await commitMultipleFiles(biz.github_owner, biz.github_repo,
          [{ path: 'feed.xml', content: feedXml }],
          `rss: update feed after ${post.slug}`, biz.github_branch || 'main');
        results.steps.push({ step: 'rss_feed', status: 'success' });
      }
    } catch (err) { results.errors.push({ step: 'rss_feed', error: err.message }); }

  // ─── NEXTJS MODE (VoiceAI Connect) ────────────────────────────────────────
  } else if (publishMode === 'nextjs') {
    const blogUrl = `https://${biz.domain}/blog/${post.slug}`;

    try {
      // DB updates only — no GitHub commits
      await supabase.from('blog_generated_posts').update({
        status: 'published', publish_date: today, updated_at: new Date().toISOString(),
      }).eq('id', postId);

      await supabase.from('blog_existing_posts').upsert({
        business_id: biz.id, url: blogUrl, title: post.title, slug: post.slug,
        primary_keyword: post.primary_keyword, secondary_keywords: post.secondary_keywords,
        meta_description: post.meta_description, category: post.category,
        publish_date: today, word_count: post.word_count,
      }, { onConflict: 'business_id,slug', ignoreDuplicates: false });
      results.steps.push({ step: 'database_update', status: 'success' });

      // Trigger ISR revalidation
      if (biz.revalidate_url) {
        try {
          const res = await fetch(biz.revalidate_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: process.env.REVALIDATION_SECRET, slug: post.slug }),
          });
          const data = await res.json().catch(() => ({ raw: 'non-json response' }));
          results.steps.push({ step: 'isr_revalidation', status: 'success', ...data });
        } catch (err) {
          results.errors.push({ step: 'isr_revalidation', error: err.message });
        }
      }
    } catch (err) {
      results.errors.push({ step: 'nextjs_publish', error: err.message });
      await logStep(postId, 'publish', 'error', { error: err.message }, Date.now() - startTime);
      throw err;
    }
    // RSS/sitemap are dynamic routes in nextjs mode — no file commits needed
  }

  // ─── SHARED: Search engine notifications ──────────────────────────────────
  try {
    if (biz.gsc_property_url) {
      const sitemapUrl = publishMode === 'nextjs' ? `https://${biz.domain}/sitemap.xml` : `https://${biz.domain}/${biz.sitemap_path}`;
      await submitSitemap(biz.gsc_property_url, sitemapUrl);
      await supabase.from('blog_generated_posts').update({ gsc_submitted: true }).eq('id', postId);
      results.steps.push({ step: 'gsc_sitemap', status: 'success' });
    }
  } catch (err) { results.errors.push({ step: 'gsc_sitemap', error: err.message }); }

  try {
    if (biz.indexnow_key) {
      const postUrl = publishMode === 'nextjs' ? `https://${biz.domain}/blog/${post.slug}` : `https://${biz.domain}/${biz.blog_file_prefix}${post.slug}`;
      await submitToIndexNow(biz.domain, biz.indexnow_key, [postUrl, `https://${biz.domain}/blog`]);
      await supabase.from('blog_generated_posts').update({ indexnow_submitted: true }).eq('id', postId);
      results.steps.push({ step: 'indexnow', status: 'success' });
    }
  } catch (err) { results.errors.push({ step: 'indexnow', error: err.message }); }

  await logStep(postId, 'publish', 'success', results, Date.now() - startTime);
  return results;
}

async function logStep(postId, step, status, details, durationMs) {
  await supabase.from('blog_generation_logs').insert({ post_id: postId, step, status, details, duration_ms: durationMs });
}