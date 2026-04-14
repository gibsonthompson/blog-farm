import { NextResponse } from 'next/server';
import { recommendNextPosts } from '@/lib/content-strategist.js';
import { calculateBatchDates } from '@/lib/cadence.js';
import supabase from '@/lib/supabase.js';

/**
 * POST /api/batch-generate
 * 
 * Step 1: Get AI recommendations for N posts
 * Step 2: Calculate staggered publish dates (Mon/Wed/Fri)
 * Step 3: Queue them all in blog_content_queue with scheduled dates
 * Step 4: Return the plan for review before generating
 * 
 * Does NOT generate content yet — just creates the plan.
 * Individual posts are generated via /api/generate when ready.
 */
export async function POST(request) {
  const body = await request.json();
  const { businessSlug = 'callbird', count = 5 } = body;

  const { data: biz } = await supabase
    .from('blog_businesses').select('id').eq('slug', businessSlug).single();
  if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  try {
    // Get AI recommendations
    const strategy = await recommendNextPosts(businessSlug, count);
    const recs = strategy.recommendations;

    if (!recs || recs.length === 0) {
      return NextResponse.json({ error: 'No recommendations generated' }, { status: 500 });
    }

    // Calculate staggered dates
    const categories = recs.map(r => r.post_type);
    const dates = calculateBatchDates(recs.length, categories);

    // Queue each recommendation
    const queued = [];
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      const scheduledDate = dates[i] || null;

      const { data: entry, error } = await supabase
        .from('blog_content_queue')
        .insert({
          business_id: biz.id,
          target_keyword: rec.target_keyword,
          secondary_keywords: [],
          post_type: rec.post_type,
          title_suggestion: rec.title,
          notes: rec.notes || '',
          status: 'queued',
          priority: recs.length - i, // First rec = highest priority
          scheduled_date: scheduledDate,
        })
        .select()
        .single();

      if (!error) {
        queued.push({
          id: entry.id,
          title: rec.title,
          keyword: rec.target_keyword,
          type: rec.post_type,
          scheduledDate,
          reasoning: rec.reasoning,
          impact: rec.business_impact,
        });
      }
    }

    return NextResponse.json({
      success: true,
      plan: {
        totalPosts: queued.length,
        dateRange: `${dates[0]} to ${dates[dates.length - 1]}`,
        postsPerWeek: Math.min(queued.length, 3),
        posts: queued,
      },
      coverage: strategy.coverage,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET /api/batch-generate?business=callbird — View current queue
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const businessSlug = searchParams.get('business') || 'callbird';

  const { data: biz } = await supabase
    .from('blog_businesses').select('id').eq('slug', businessSlug).single();
  if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  const { data: queue } = await supabase
    .from('blog_content_queue')
    .select('*')
    .eq('business_id', biz.id)
    .in('status', ['queued', 'in_progress'])
    .order('priority', { ascending: false });

  return NextResponse.json({ queue: queue || [] });
}