import { NextResponse } from 'next/server';
import { scanForStaleContent, analyzePostForRefresh, applyYearRefresh, notifyRefresh } from '@/lib/content-refresh.js';
import supabase from '@/lib/supabase.js';

/**
 * GET /api/refresh?business=callbird — Scan all posts for staleness
 * POST /api/refresh — Analyze or refresh a specific post
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const businessSlug = searchParams.get('business') || 'callbird';

  const { data: biz } = await supabase
    .from('blog_businesses').select('id').eq('slug', businessSlug).single();
  if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  try {
    const result = await scanForStaleContent(biz.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const body = await request.json();
  const { businessSlug = 'callbird', slug, action = 'analyze' } = body;

  const { data: biz } = await supabase
    .from('blog_businesses').select('*').eq('slug', businessSlug).single();
  if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  try {
    if (action === 'analyze') {
      const analysis = await analyzePostForRefresh(
        biz.id, slug, biz.github_owner, biz.github_repo, biz.github_branch || 'main', biz.blog_file_prefix
      );
      return NextResponse.json({ slug, analysis });
    }

    if (action === 'year-refresh') {
      const { oldYear, newYear } = body;
      const result = await applyYearRefresh(
        biz.github_owner, biz.github_repo, biz.github_branch || 'main', biz.blog_file_prefix, slug, oldYear, newYear
      );
      const cleanUrl = `https://${biz.domain}/${biz.blog_file_prefix}${slug}`;
      await notifyRefresh(biz.domain, biz.sitemap_path, biz.indexnow_key, biz.gsc_property_url, cleanUrl);
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}