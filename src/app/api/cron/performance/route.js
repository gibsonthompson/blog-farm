import { NextResponse } from 'next/server';
import { dailyPerformanceSnapshot, analyzeWinningPatterns, detectCannibalization } from '@/lib/performance.js';
import supabase from '@/lib/supabase.js';

export const maxDuration = 300;

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = [];

  try {
    // Get ALL businesses with GSC configured
    const { data: businesses } = await supabase
      .from('blog_businesses')
      .select('id, slug, name, gsc_property_url')
      .not('gsc_property_url', 'is', null);

    if (!businesses || businesses.length === 0) {
      return NextResponse.json({ success: true, message: 'No businesses with GSC configured' });
    }

    for (const biz of businesses) {
      const bizResult = { business: biz.slug, steps: [], errors: [] };

      try {
        const snapshot = await dailyPerformanceSnapshot(biz.id);
        bizResult.steps.push({ step: 'snapshot', postsTracked: snapshot?.postsTracked || 0 });
      } catch (err) {
        bizResult.errors.push({ step: 'snapshot', error: err.message });
      }

      try {
        const patterns = await analyzeWinningPatterns(biz.id);
        bizResult.steps.push({ step: 'patterns', patternsFound: patterns ? 'yes' : 'no' });
      } catch (err) {
        bizResult.errors.push({ step: 'patterns', error: err.message });
      }

      try {
        const cannibal = await detectCannibalization(biz.id);
        bizResult.steps.push({ step: 'cannibalization', issuesFound: cannibal?.issues?.length || 0 });
      } catch (err) {
        bizResult.errors.push({ step: 'cannibalization', error: err.message });
      }

      results.push(bizResult);
    }

    return NextResponse.json({ success: true, timestamp: new Date().toISOString(), businesses: results });
  } catch (err) {
    console.error('[performance cron] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}