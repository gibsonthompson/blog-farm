import { NextResponse } from 'next/server';
import { commitMultipleFiles, fetchFileContent } from '@/lib/github.js';
import supabase from '@/lib/supabase.js';

export const maxDuration = 60;

/**
 * POST /api/rewrite-titles
 * Rewrites titles and meta descriptions on live blog posts.
 * Takes an array of { slug, newTitle, metaDescription } and pushes to GitHub.
 */
export async function POST(request) {
  try {
    const { rewrites, businessSlug = 'callbird' } = await request.json();
    if (!rewrites?.length) return NextResponse.json({ error: 'rewrites array required' }, { status: 400 });

    const { data: biz } = await supabase
      .from('blog_businesses').select('*').eq('slug', businessSlug).single();
    if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const owner = biz.github_owner;
    const repo = biz.github_repo;
    if (!owner || !repo) {
      return NextResponse.json({ error: `GitHub not configured. Set github_owner and github_repo on the business record. Expected: gibsonthompson / callbird-site` }, { status: 400 });
    }
    const prefix = biz.blog_file_prefix || 'blog-';
    const branch = 'main';

    const files = [];
    const results = [];

    for (const rw of rewrites) {
      const filename = `${prefix}${rw.slug}.html`;

      const file = await fetchFileContent(owner, repo, filename, branch);
      if (!file) {
        results.push({ slug: rw.slug, status: 'error', message: `File not found: ${filename}` });
        continue;
      }

      let updated = file.content;

      // 1. Replace <title> tag
      updated = updated.replace(
        /<title>[^<]*<\/title>/i,
        `<title>${rw.newTitle}</title>`
      );

      // 2. Add or replace <meta name="description">
      if (/<meta\s+name=["']description["']/i.test(updated)) {
        updated = updated.replace(
          /<meta\s+name=["']description["']\s+content=["'][^"']*["'][^>]*>/i,
          `<meta name="description" content="${escapeAttr(rw.metaDescription)}">`
        );
      } else {
        // No meta description exists — insert after <title>
        updated = updated.replace(
          /(<\/title>)/i,
          `$1\n    <meta name="description" content="${escapeAttr(rw.metaDescription)}">`
        );
      }

      // 3. Update the <h1> tag — preserve attributes, replace inner content
      updated = updated.replace(
        /(<h1[^>]*>)[\s\S]*?(<\/h1>)/i,
        `$1${rw.newTitle}$2`
      );

      // 4. Update schema.org "headline"
      updated = updated.replace(
        /"headline"\s*:\s*"[^"]*"/,
        `"headline": "${escapeJson(rw.newTitle)}"`
      );

      // 5. Update dateModified in schema
      const today = new Date().toISOString().split('T')[0];
      if (updated.includes('"dateModified"')) {
        updated = updated.replace(
          /"dateModified"\s*:\s*"[^"]*"/,
          `"dateModified": "${today}"`
        );
      }

      if (updated !== file.content) {
        files.push({ path: filename, content: updated });
        results.push({ slug: rw.slug, status: 'updated', newTitle: rw.newTitle });
      } else {
        results.push({ slug: rw.slug, status: 'no_changes' });
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ success: true, message: 'No files changed', results });
    }

    // Commit all changes in one push
    await commitMultipleFiles(owner, repo, files,
      `Rewrite ${files.length} titles and meta descriptions for CTR improvement`, branch);

    // Update blog_existing_posts in DB to match (non-blocking — column might not exist)
    for (const rw of rewrites) {
      try {
        await supabase.from('blog_existing_posts')
          .update({ title: rw.newTitle })
          .eq('slug', rw.slug)
          .eq('business_id', biz.id);
      } catch { /* column might not exist */ }
    }

    return NextResponse.json({
      success: true,
      filesUpdated: files.length,
      results,
    });
  } catch (err) {
    console.error('[rewrite-titles]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeJson(str) {
  return str.replace(/"/g, '\\"');
}