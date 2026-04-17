import { NextResponse } from 'next/server';
import {
  dailyPerformanceSnapshot,
  analyzeWinningPatterns,
  detectCannibalization,
  discoverContentGaps,
} from '@/lib/performance.js';
import { scanForStaleContent } from '@/lib/content-refresh.js';
import supabase from '@/lib/supabase.js';

export const maxDuration = 120;

/**
 * GET /api/cron/performance
 * 
 * Called daily by Vercel Cron. Runs different tasks based on the day:
 * - EVERY DAY: GSC performance snapshot (pull data, classify posts)
 * - MONDAYS: + winning pattern analysis + cannibalization detection + content gap discovery + stale content scan
 * 
 * Protected by CRON_SECRET to prevent unauthorized access.
 */
export async function GET(request) {
  // Verify cron secret (Vercel sends this automatically for cron jobs)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = { timestamp: new Date().toISOString(), tasks: [] };

  try {
    // Get callbird business ID
    const { data: biz } = await supabase
      .from('blog_businesses').select('id').eq('slug', 'callbird').single();
    if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    // DAILY: Performance snapshot
    try {
      const snapshot = await dailyPerformanceSnapshot(biz.id);
      results.tasks.push({ task: 'snapshot', status: 'success', ...snapshot });
    } catch (err) {
      results.tasks.push({ task: 'snapshot', status: 'error', error: err.message });
    }

    // WEEKLY (Monday): Run deeper analysis
    const dayOfWeek = new Date().getDay(); // 0 = Sunday, 1 = Monday
    if (dayOfWeek === 1) {
      // Winning patterns
      try {
        const patterns = await analyzeWinningPatterns(biz.id);
        results.tasks.push({ task: 'patterns', status: 'success', ...patterns });
      } catch (err) {
        results.tasks.push({ task: 'patterns', status: 'error', error: err.message });
      }

      // Cannibalization
      try {
        const cannibal = await detectCannibalization(biz.id);
        results.tasks.push({ task: 'cannibalization', status: 'success', ...cannibal });
      } catch (err) {
        results.tasks.push({ task: 'cannibalization', status: 'error', error: err.message });
      }

      // Content gaps
      try {
        const gaps = await discoverContentGaps(biz.id);
        results.tasks.push({ task: 'gaps', status: 'success', gapCount: gaps.gaps?.length || 0 });
      } catch (err) {
        results.tasks.push({ task: 'gaps', status: 'error', error: err.message });
      }

      // Stale content scan
      try {
        const stale = await scanForStaleContent(biz.id);
        results.tasks.push({ task: 'stale_scan', status: 'success', staleCount: stale.stale?.length || 0 });
      } catch (err) {
        results.tasks.push({ task: 'stale_scan', status: 'error', error: err.message });
      }
    }

    return NextResponse.json({ success: true, ...results });
  } catch (err) {
    return NextResponse.json({ error: err.message, tasks: results.tasks }, { status: 500 });
  }
}