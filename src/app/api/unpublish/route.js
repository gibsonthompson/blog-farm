import { NextResponse } from 'next/server';
import { fetchFileContent, commitMultipleFiles } from '@/lib/github.js';
import supabase from '@/lib/supabase.js';

/**
 * POST /api/unpublish
 * 
 * Two modes:
 *   { slug, businessSlug, mode: "remove" }  → Deletes post file, removes from blog.html + sitemap
 *   { slug, businessSlug, mode: "noindex" } → Adds <meta name="robots" content="noindex"> to post
 * 
 * Both modes update the DB record.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { slug, businessSlug = 'callbird', mode = 'noindex' } = body;

    if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });
    if (!['remove', 'noindex'].includes(mode)) {
      return NextResponse.json({ error: 'mode must be "remove" or "noindex"' }, { status: 400 });
    }

    const { data: biz } = await supabase
      .from('blog_businesses').select('*').eq('slug', businessSlug).single();
    if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const owner = biz.github_owner;
    const repo = biz.github_repo;
    const branch = biz.github_branch || 'main';
    const prefix = biz.blog_file_prefix || 'blog-';
    const filename = `${prefix}${slug}.html`;

    const results = { slug, mode, steps: [] };

    if (mode === 'noindex') {
      // ── NOINDEX MODE: Add meta robots noindex to the post ──
      const file = await fetchFileContent(owner, repo, filename, branch);
      if (!file) return NextResponse.json({ error: `File not found: ${filename}` }, { status: 404 });

      // Check if already noindexed
      if (file.content.includes('name="robots" content="noindex"')) {
        return NextResponse.json({ success: true, message: 'Already noindexed', ...results });
      }

      // Insert noindex meta tag after <head> or after charset meta
      let updated = file.content;
      const insertPoint = updated.indexOf('<meta charset');
      if (insertPoint !== -1) {
        const endOfLine = updated.indexOf('>', insertPoint) + 1;
        updated = updated.slice(0, endOfLine) + '\n    <meta name="robots" content="noindex, nofollow">' + updated.slice(endOfLine);
      } else {
        updated = updated.replace('<head>', '<head>\n    <meta name="robots" content="noindex, nofollow">');
      }

      // Also remove from sitemap
      const sitemapFile = await fetchFileContent(owner, repo, biz.sitemap_path, branch);
      let updatedSitemap = sitemapFile?.content;
      if (updatedSitemap) {
        // Remove the URL entry for this post
        const sitemapPattern = new RegExp(
          `\\s*<url>\\s*<loc>[^<]*${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*</loc>[\\s\\S]*?</url>`,
          'i'
        );
        updatedSitemap = updatedSitemap.replace(sitemapPattern, '');
      }

      const files = [{ path: filename, content: updated }];
      if (updatedSitemap && updatedSitemap !== sitemapFile.content) {
        files.push({ path: biz.sitemap_path, content: updatedSitemap });
      }

      const commit = await commitMultipleFiles(owner, repo, files,
        `noindex: ${slug}`, branch);
      results.steps.push({ step: 'noindex_added', sha: commit.sha });

    } else {
      // ── REMOVE MODE: Delete from blog.html + sitemap ──
      // We can't delete files via Git Trees API, so we replace content with a redirect
      const redirectHtml = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/blog"><link rel="canonical" href="https://${biz.domain}/blog"></head><body><p>Redirecting to <a href="/blog">blog</a>...</p></body></html>`;

      // Remove from blog.html
      const blogFile = await fetchFileContent(owner, repo, biz.blog_index_path, branch);
      let updatedBlog = blogFile?.content;
      if (updatedBlog) {
        // Remove the post card (between AUTO-GENERATED comments or by href match)
        const cardPattern = new RegExp(
          `\\s*<!-- AUTO-GENERATED: ${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->[\\s\\S]*?</a>`,
          'i'
        );
        const hrefPattern = new RegExp(
          `\\s*<a[^>]*href="[^"]*${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*"[^>]*class="post-card"[\\s\\S]*?</a>`,
          'i'
        );
        updatedBlog = updatedBlog.replace(cardPattern, '');
        if (updatedBlog === blogFile.content) {
          updatedBlog = updatedBlog.replace(hrefPattern, '');
        }
      }

      // Remove from sitemap
      const sitemapFile = await fetchFileContent(owner, repo, biz.sitemap_path, branch);
      let updatedSitemap = sitemapFile?.content;
      if (updatedSitemap) {
        const sitemapPattern = new RegExp(
          `\\s*<url>\\s*<loc>[^<]*${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*</loc>[\\s\\S]*?</url>`,
          'i'
        );
        updatedSitemap = updatedSitemap.replace(sitemapPattern, '');
      }

      const files = [{ path: filename, content: redirectHtml }];
      if (updatedBlog && updatedBlog !== blogFile?.content) {
        files.push({ path: biz.blog_index_path, content: updatedBlog });
      }
      if (updatedSitemap && updatedSitemap !== sitemapFile?.content) {
        files.push({ path: biz.sitemap_path, content: updatedSitemap });
      }

      const commit = await commitMultipleFiles(owner, repo, files,
        `unpublish: remove ${slug}`, branch);
      results.steps.push({ step: 'removed', sha: commit.sha, filesChanged: files.length });
    }

    // Update DB
    await supabase.from('blog_existing_posts')
      .update({ status: mode === 'noindex' ? 'noindexed' : 'removed' })
      .eq('slug', slug).eq('business_id', biz.id);

    await supabase.from('blog_generated_posts')
      .update({ status: mode === 'noindex' ? 'noindexed' : 'removed' })
      .eq('slug', slug).eq('business_id', biz.id);

    results.steps.push({ step: 'db_updated' });

    return NextResponse.json({ success: true, ...results });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}