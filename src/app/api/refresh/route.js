import { NextResponse } from 'next/server';
import { scanForStaleContent, analyzePostForRefresh, applyYearRefresh, applyFullRefresh, notifyRefresh } from '@/lib/content-refresh.js';
import supabase from '@/lib/supabase.js';

export const maxDuration = 300;

/**
 * GET /api/refresh?business=callbird
 * Scan all posts for staleness. Returns prioritized list.
 * 
 * POST /api/refresh
 * Three actions:
 *   { action: "analyze", slug }       → Claude analyzes what's stale in a specific post
 *   { action: "year-refresh", slug, oldYear, newYear } → Find/replace year + update dateModified + sitemap + notify
 *   { action: "full-refresh", slug }   → Analyze + Claude rewrites stale sections + commit + sitemap + notify
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

  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const { data: biz } = await supabase
    .from('blog_businesses').select('*').eq('slug', businessSlug).single();
  if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  const owner = biz.github_owner;
  const repo = biz.github_repo;
  const branch = biz.github_branch || 'main';
  const prefix = biz.blog_file_prefix || 'blog-';

  try {
    // ── ANALYZE: Claude checks what's stale ──
    if (action === 'analyze') {
      const analysis = await analyzePostForRefresh(biz.id, slug, owner, repo, branch, prefix);
      return NextResponse.json({ slug, analysis });
    }

    // ── YEAR REFRESH: Simple find/replace + dateModified + sitemap + notify ──
    if (action === 'year-refresh') {
      const { oldYear, newYear } = body;
      if (!oldYear || !newYear) {
        return NextResponse.json({ error: 'oldYear and newYear are required' }, { status: 400 });
      }

      const result = await applyYearRefresh(owner, repo, branch, prefix, slug, oldYear, newYear, biz.sitemap_path);
      const notify = await notifyRefresh(biz.id, biz.domain, biz.sitemap_path, biz.indexnow_key, biz.gsc_property_url, slug);

      return NextResponse.json({ success: true, action: 'year-refresh', slug, ...result, notifications: notify });
    }

    // ── FULL REFRESH: Analyze → Claude rewrites → commit → sitemap → notify ──
    if (action === 'full-refresh') {
      // Step 1: Analyze what's stale
      const analysis = await analyzePostForRefresh(biz.id, slug, owner, repo, branch, prefix);

      if (!analysis.needs_refresh) {
        return NextResponse.json({ success: true, action: 'full-refresh', slug, skipped: true, reason: 'Post does not need refresh' });
      }

      // Step 2: Apply changes
      const result = await applyFullRefresh(owner, repo, branch, prefix, slug, biz.sitemap_path, analysis);

      if (result.skipped) {
        return NextResponse.json({ success: true, action: 'full-refresh', slug, ...result });
      }

      // Step 3: Notify search engines + update DB
      const notify = await notifyRefresh(biz.id, biz.domain, biz.sitemap_path, biz.indexnow_key, biz.gsc_property_url, slug);

      return NextResponse.json({ success: true, action: 'full-refresh', slug, analysis, ...result, notifications: notify });
    }

    return NextResponse.json({ error: `Invalid action: ${action}. Use "analyze", "year-refresh", or "full-refresh"` }, { status: 400 });

  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}