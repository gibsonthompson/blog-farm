import { NextResponse } from 'next/server';
import { dailyPerformanceSnapshot, analyzeWinningPatterns, detectCannibalization } from '@/lib/performance.js';
import supabase from '@/lib/supabase.js';

export const maxDuration = 120;

/**
 * GET /api/performance?business=callbird
 * Dashboard view — latest tier for each post + patterns + alerts.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const businessSlug = searchParams.get('business') || 'callbird';
  try {
    const { data: biz } = await supabase.from('blog_businesses').select('id').eq('slug', businessSlug).single();
    if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    // Latest snapshot per post (deduplicate)
    const { data: snapshots } = await supabase.from('blog_post_performance')
      .select('post_id, snapshot_date, clicks_28d, impressions_28d, ctr_28d, position_28d, clicks_prev_28d, impressions_prev_28d, performance_tier, tier_reason, ai_overview_likely, top_queries')
      .order('snapshot_date', { ascending: false }).limit(200);
    const latest = new Map();
    for (const s of (snapshots||[])) { if (!latest.has(s.post_id)) latest.set(s.post_id, s); }

    const { data: posts } = await supabase.from('blog_existing_posts')
      .select('id, title, slug, primary_keyword, category, publish_date').eq('business_id', biz.id);
    const postMap = new Map((posts||[]).map(p => [p.id, p]));

    const results = [...latest.values()].map(s => ({ ...s, post: postMap.get(s.post_id)||null })).filter(r => r.post);
    const tiers = {};
    for (const r of results) { const t = r.performance_tier||'unknown'; tiers[t] = (tiers[t]||0)+1; }

    const { data: patternsRow } = await supabase.from('blog_winning_patterns')
      .select('patterns, updated_at, sample_size').eq('business_id', biz.id).single();
    const { data: alerts } = await supabase.from('blog_cannibalization_alerts')
      .select('*').eq('business_id', biz.id).eq('resolution', 'pending').order('detected_at', { ascending: false }).limit(20);

    return NextResponse.json({
      posts: results.sort((a,b) => b.clicks_28d - a.clicks_28d),
      tierSummary: tiers,
      totalClicks: results.reduce((s,r) => s+r.clicks_28d, 0),
      totalImpressions: results.reduce((s,r) => s+r.impressions_28d, 0),
      winningPatterns: patternsRow?.patterns || null,
      cannibalizationAlerts: alerts || [],
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/performance
 * Actions: snapshot (daily), patterns (weekly), cannibalization (weekly)
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { action = 'snapshot', businessSlug = 'callbird' } = body;
    const { data: biz } = await supabase.from('blog_businesses').select('id').eq('slug', businessSlug).single();
    if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    switch (action) {
      case 'snapshot': return NextResponse.json({ success: true, ...await dailyPerformanceSnapshot(biz.id) });
      case 'patterns': return NextResponse.json({ success: true, ...await analyzeWinningPatterns(biz.id) });
      case 'cannibalization': return NextResponse.json({ success: true, ...await detectCannibalization(biz.id) });
      default: return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[Performance]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}