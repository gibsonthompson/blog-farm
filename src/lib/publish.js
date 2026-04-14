import supabase from './supabase.js';
import { commitMultipleFiles, fetchFileContent } from './github.js';
import { submitSitemap } from './google-search-console.js';
import { submitToIndexNow } from './indexnow.js';

/**
 * Build the blog card HTML for inserting into blog.html
 */
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

/**
 * Insert a new card into blog.html content
 */
function insertCardIntoBlogHtml(blogHtml, cardHtml) {
  // Strategy 1: Look for insertion marker comment
  const markerPattern = '<!-- NEW_POSTS_INSERTION_POINT -->';
  if (blogHtml.includes(markerPattern)) {
    return blogHtml.replace(markerPattern, markerPattern + '\n' + cardHtml);
  }

  // Strategy 2: Insert after "Latest Articles" heading and posts-grid opening
  const gridPattern = /<div class="posts-grid">/i;
  if (gridPattern.test(blogHtml)) {
    return blogHtml.replace(gridPattern, `<div class="posts-grid">\n${cardHtml}`);
  }

  // Strategy 3: Insert after section-title
  const sectionPattern = /<h2[^>]*class="section-title"[^>]*>.*?<\/h2>/i;
  const match = blogHtml.match(sectionPattern);
  if (match) {
    const insertPos = blogHtml.indexOf(match[0]) + match[0].length;
    return blogHtml.slice(0, insertPos) + '\n' + cardHtml + blogHtml.slice(insertPos);
  }

  throw new Error('Could not find insertion point in blog.html. Add <!-- NEW_POSTS_INSERTION_POINT --> to the file.');
}

/**
 * Insert a new URL entry into sitemap.xml
 */
function insertUrlIntoSitemap(sitemapXml, url, date) {
  const newEntry = `
  <url>
    <loc>${url}</loc>
    <lastmod>${date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`;

  // Insert before </urlset>
  const updatedSitemap = sitemapXml.replace('</urlset>', `${newEntry}\n</urlset>`);

  // Update blog index lastmod
  const blogIndexPattern = /(<loc>https?:\/\/[^<]*blog\.html<\/loc>\s*<lastmod>)[^<]*(<\/lastmod>)/;
  const finalSitemap = updatedSitemap.replace(blogIndexPattern, `$1${date}$2`);

  return finalSitemap;
}

/**
 * Full publish pipeline
 * Called when user clicks "Approve & Publish"
 */
export async function publishPost(postId) {
  const startTime = Date.now();

  // 1. Load the post and business context
  const { data: post, error: postError } = await supabase
    .from('blog_generated_posts')
    .select('*, blog_businesses(*)')
    .eq('id', postId)
    .single();

  if (postError || !post) throw new Error(`Post not found: ${postError?.message}`);
  if (post.status === 'published') throw new Error('Post is already published');

  const biz = post.blog_businesses;
  const owner = biz.github_owner;
  const repo = biz.github_repo;
  const branch = biz.github_branch || 'main';
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const blogFilePath = `${biz.blog_file_prefix}${post.slug}.html`;
  const blogUrl = `https://${biz.domain}/${blogFilePath}`;

  const results = { steps: [], errors: [] };

  try {
    // 2. Fetch current blog.html and sitemap.xml from GitHub
    const [blogHtmlFile, sitemapFile] = await Promise.all([
      fetchFileContent(owner, repo, biz.blog_index_path, branch),
      fetchFileContent(owner, repo, biz.sitemap_path, branch),
    ]);

    if (!blogHtmlFile) throw new Error(`Could not fetch ${biz.blog_index_path} from GitHub`);
    if (!sitemapFile) throw new Error(`Could not fetch ${biz.sitemap_path} from GitHub`);

    // 3. Build updated files
    const cardHtml = buildBlogCard(post, biz.domain, biz.blog_file_prefix);
    const updatedBlogHtml = insertCardIntoBlogHtml(blogHtmlFile.content, cardHtml);
    const updatedSitemap = insertUrlIntoSitemap(sitemapFile.content, blogUrl, today);

    // 4. Commit all 3 files in a SINGLE commit
    const commitResult = await commitMultipleFiles(owner, repo, [
      { path: blogFilePath, content: post.html_content },
      { path: biz.blog_index_path, content: updatedBlogHtml },
      { path: biz.sitemap_path, content: updatedSitemap },
    ], `blog: add ${post.slug}`, branch);

    results.steps.push({ step: 'github_commit', status: 'success', sha: commitResult.sha });

    // 5. Update post status in DB
    await supabase.from('blog_generated_posts').update({
      status: 'published',
      publish_date: today,
      github_commit_sha: commitResult.sha,
      updated_at: new Date().toISOString(),
    }).eq('id', postId);

    // 6. Also add to existing posts registry
    await supabase.from('blog_existing_posts').insert({
      business_id: biz.id,
      url: blogUrl,
      title: post.title,
      slug: post.slug,
      primary_keyword: post.primary_keyword,
      secondary_keywords: post.secondary_keywords,
      meta_description: post.meta_description,
      category: post.category,
      publish_date: today,
      word_count: post.word_count,
    }).onConflict('business_id, slug').merge();

    results.steps.push({ step: 'database_update', status: 'success' });

  } catch (err) {
    results.errors.push({ step: 'github_commit', error: err.message });
    await logStep(postId, 'publish', 'error', { error: err.message }, Date.now() - startTime);
    throw err; // Critical failure — stop here
  }

  // 7. Submit sitemap to Google Search Console (non-critical)
  try {
    await submitSitemap(biz.gsc_property_url, `https://${biz.domain}/${biz.sitemap_path}`);
    await supabase.from('blog_generated_posts').update({ gsc_submitted: true }).eq('id', postId);
    results.steps.push({ step: 'gsc_sitemap', status: 'success' });
  } catch (err) {
    results.errors.push({ step: 'gsc_sitemap', error: err.message });
  }

  // 8. Submit to IndexNow for Bing/Yandex (non-critical)
  try {
    if (biz.indexnow_key) {
      await submitToIndexNow(biz.domain, biz.indexnow_key, [
        blogUrl,
        `https://${biz.domain}/${biz.blog_index_path}`,
      ]);
      await supabase.from('blog_generated_posts').update({ indexnow_submitted: true }).eq('id', postId);
      results.steps.push({ step: 'indexnow', status: 'success' });
    }
  } catch (err) {
    results.errors.push({ step: 'indexnow', error: err.message });
  }

  // 9. Log the publish event
  await logStep(postId, 'publish', 'success', results, Date.now() - startTime);

  return results;
}

async function logStep(postId, step, status, details, durationMs) {
  await supabase.from('blog_generation_logs').insert({
    post_id: postId,
    step,
    status,
    details,
    duration_ms: durationMs,
  });
}
