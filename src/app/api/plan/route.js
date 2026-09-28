import { NextResponse } from 'next/server';
import { generateContentPlan } from '@/lib/content-strategist.js';

export const maxDuration = 300;

/**
 * POST /api/plan
 * Body: { businessSlug, count?, perWeek?, startDate?, dryRun? }
 *
 * Builds a balanced, anti-repetition content plan and writes it to
 * blog_content_queue. The daily autopilot then drains the queue one post
 * per day. Run this manually from the dashboard, or on a weekly cron, to
 * refill the queue.
 *
 * GET /api/plan?business=slug&count=12[&dryRun=1]
 * Same thing via GET so it can be triggered by a Vercel cron. Requires the
 * CRON_SECRET bearer when called as a cron (Vercel sends it); manual dashboard
 * calls go through POST.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json({ error: `Invalid body: ${e.message}` }, { status: 400 });
  }
  const { businessSlug, count = 12, perWeek = 5, startDate, dryRun } = body;
  if (!businessSlug) return NextResponse.json({ error: 'businessSlug is required' }, { status: 400 });

  try {
    const result = await generateContentPlan(businessSlug, count, { perWeek, startDate, dryRun });
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const authHeader = request.headers.get('authorization');

  // If called as a cron (Vercel sends the bearer), require it. Manual browser
  // hits without the header are allowed only for dryRun previews.
  const dryRun = searchParams.get('dryRun') === '1';
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron && !dryRun) {
    return NextResponse.json({ error: 'Unauthorized (use POST from dashboard, or dryRun=1 to preview)' }, { status: 401 });
  }

  const businessSlug = searchParams.get('business');
  if (!businessSlug) return NextResponse.json({ error: 'business query param required' }, { status: 400 });
  const count = parseInt(searchParams.get('count') || '12', 10);
  const perWeek = parseInt(searchParams.get('perWeek') || '5', 10);

  try {
    const result = await generateContentPlan(businessSlug, count, { perWeek, dryRun });
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}