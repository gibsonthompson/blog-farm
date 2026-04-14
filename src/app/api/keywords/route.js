import { NextResponse } from 'next/server';
import { recommendNextPosts, getGapAnalysis } from '@/lib/content-strategist.js';

/**
 * GET /api/keywords — Quick gap analysis (instant, no AI cost)
 * GET /api/keywords?recommend=true&count=5 — AI-powered recommendations
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const businessSlug = searchParams.get('business') || 'callbird';
  const recommend = searchParams.get('recommend') === 'true';
  const count = parseInt(searchParams.get('count') || '5', 10);

  try {
    if (recommend) {
      const result = await recommendNextPosts(businessSlug, count);
      return NextResponse.json(result);
    } else {
      const gaps = await getGapAnalysis(businessSlug);
      return NextResponse.json(gaps);
    }
  } catch (err) {
    console.error('Strategist error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
