import { NextResponse } from 'next/server';
import supabase from '@/lib/supabase.js';
import { fetchFileContent } from '@/lib/github.js';

export const maxDuration = 60;

/**
 * GET /api/scrape-content?business=callbird&limit=10&offset=0
 * 
 * Fetches actual HTML content for existing posts from GitHub repo,
 * strips to text, and stores both in the database.
 * Run in batches (limit=10) to stay under Vercel timeout.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const businessSlug = searchParams.get('business') || 'callbird';
  const limit = parseInt(searchParams.get('limit') || '10', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const { data: biz } = await supabase
    .from('blog_businesses').select('*').eq('slug', businessSlug).single();
  if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  // Get posts that don't have content yet
  const { data: posts } = await supabase
    .from('blog_existing_posts')
    .select('id, slug, url, title')
    .eq('business_id', biz.id)
    .is('html_content', null)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (!posts?.length) {
    return NextResponse.json({ message: 'All posts already have content', scraped: 0 });
  }

  const results = { scraped: 0, failed: 0, errors: [] };

  for (const post of posts) {
    try {
      // Fetch from GitHub repo directly (faster and more reliable than HTTP)
      const filePath = `${biz.blog_file_prefix}${post.slug}.html`;
      const file = await fetchFileContent(biz.github_owner, biz.github_repo, filePath, biz.github_branch || 'main');

      if (!file?.content) {
        results.failed++;
        results.errors.push({ slug: post.slug, error: 'File not found in repo' });
        continue;
      }

      // Extract text content (strip HTML tags)
      const textContent = file.content
        .replace(/<script[\s\S]*?<\/script>/gi, '') // Remove scripts
        .replace(/<style[\s\S]*?<\/style>/gi, '')   // Remove styles
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')       // Remove nav
        .replace(/<footer[\s\S]*?<\/footer>/gi, '') // Remove footer
        .replace(/<[^>]*>/g, ' ')                    // Strip remaining HTML
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/\s+/g, ' ')                       // Collapse whitespace
        .trim();

      await supabase.from('blog_existing_posts').update({
        html_content: file.content,
        text_content: textContent,
      }).eq('id', post.id);

      results.scraped++;
    } catch (err) {
      results.failed++;
      results.errors.push({ slug: post.slug, error: err.message });
    }
  }

  // Count remaining
  const { count } = await supabase
    .from('blog_existing_posts')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', biz.id)
    .is('html_content', null);

  return NextResponse.json({
    ...results,
    remaining: count || 0,
    nextUrl: count > 0 ? `/api/scrape-content?business=${businessSlug}&limit=${limit}&offset=0` : null,
    message: count > 0 ? `${count} posts still need content. Hit the URL again.` : 'All posts scraped!',
  });
}

/**
 * POST /api/scrape-content — Mark posts as reference examples
 * Body: { businessSlug, slugs: ["callbird-vs-rosie", "callbird-vs-ruby-receptionists", ...] }
 */
export async function POST(request) {
  const body = await request.json();
  const { businessSlug = 'callbird', slugs = [] } = body;

  if (!slugs.length) return NextResponse.json({ error: 'slugs array required' }, { status: 400 });

  const { data: biz } = await supabase
    .from('blog_businesses').select('id').eq('slug', businessSlug).single();
  if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  // Clear existing references
  await supabase.from('blog_existing_posts')
    .update({ is_reference: false })
    .eq('business_id', biz.id);

  // Set new references
  const { data, error } = await supabase.from('blog_existing_posts')
    .update({ is_reference: true })
    .eq('business_id', biz.id)
    .in('slug', slugs)
    .select('slug, title');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    references: data,
    message: `${data?.length || 0} posts marked as reference examples`,
  });
}