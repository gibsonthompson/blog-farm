import { NextResponse } from 'next/server';
import { analyzePerformance } from '@/lib/performance.js';
import supabase from '@/lib/supabase.js';

/**
 * GET /api/performance?business=callbird&days=28
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const businessSlug = searchParams.get('business') || 'callbird';
  const days = parseInt(searchParams.get('days') || '28', 10);

  const { data: biz } = await supabase
    .from('blog_businesses').select('*').eq('slug', businessSlug).single();
  if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  try {
    const result = await analyzePerformance(biz.id, biz.gsc_property_url, days);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}