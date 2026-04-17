import { NextResponse } from 'next/server';
import { recommendNextPosts } from '@/lib/content-strategist.js';
import supabase from '@/lib/supabase.js';

export const maxDuration = 300;

const MIN_QC_OVERALL = 7;
const MIN_QC_INFO_GAIN = 6;
const BASE_URL = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}` 
  : 'https://blog-farm.vercel.app';

/**
 * GET /api/cron/autopilot
 * 
 * Chains existing API endpoints so each step gets its own timeout.
 * Picks topic → calls /api/generate 4 times (steps 1-4) → quality gate → /api/approve
 */
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const businessSlug = 'callbird';
  const log = { timestamp: new Date().toISOString(), steps: [], result: null };

  try {
    const { data: biz } = await supabase
      .from('blog_businesses').select('id').eq('slug', businessSlug).single();
    if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    // ── STEP 0: Pick topic ──
    let targetKeyword, postType;

    // Check content queue first
    const { data: queued } = await supabase
      .from('blog_content_queue')
      .select('*').eq('business_id', biz.id).eq('status', 'pending')
      .lte('scheduled_date', new Date().toISOString().split('T')[0])
      .order('scheduled_date', { ascending: true }).limit(1).single();

    if (queued) {
      targetKeyword = queued.keyword;
      postType = queued.post_type;
      log.steps.push({ step: 'topic', source: 'queue', keyword: targetKeyword });
      await supabase.from('blog_content_queue').update({ status: 'generating' }).eq('id', queued.id);
    } else {
      try {
        const strategy = await recommendNextPosts(businessSlug, 1);
        const rec = strategy.recommendations?.[0];
        if (!rec) {
          log.result = 'no_topics';
          return NextResponse.json({ success: true, ...log, message: 'No recommendations available' });
        }
        targetKeyword = rec.keyword || rec.title;
        postType = rec.post_type || 'guide';
        log.steps.push({ step: 'topic', source: 'ai', keyword: targetKeyword });
      } catch (err) {
        log.result = 'topic_error';
        log.steps.push({ step: 'topic', error: err.message });
        return NextResponse.json({ success: false, ...log });
      }
    }

    // ── STEP 1: Research (via /api/generate) ──
    const step1 = await callGenerate({ step: 1, businessSlug, targetKeyword, postType });
    log.steps.push({ step: 'research', ...step1 });
    if (!step1.success) { log.result = 'research_failed'; return NextResponse.json({ success: false, ...log }); }
    const postId = step1.postId;

    // ── STEP 2: Write (via /api/generate) ──
    const step2 = await callGenerate({ step: 2, businessSlug, postId });
    log.steps.push({ step: 'write', ...step2 });
    if (!step2.success) { log.result = 'write_failed'; return NextResponse.json({ success: false, ...log }); }

    // ── STEP 3: Template + Validate (via /api/generate) ──
    const step3 = await callGenerate({ step: 3, businessSlug, postId });
    log.steps.push({ step: 'template', ...step3 });
    if (!step3.success) { log.result = 'template_failed'; return NextResponse.json({ success: false, ...log }); }
    if (step3.validation && !step3.validation.valid) {
      log.result = 'validation_failed';
      return NextResponse.json({ success: true, ...log });
    }

    // ── STEP 4: QC (via /api/generate) ──
    const step4 = await callGenerate({ step: 4, businessSlug, postId });
    log.steps.push({ step: 'qc', ...step4 });
    if (!step4.success) { log.result = 'qc_failed'; return NextResponse.json({ success: false, ...log }); }

    // ── STEP 5: QUALITY GATE ──
    const scores = step4.qc?.scores || {};
    const overall = scores.overall || 0;
    const infoGain = scores.information_gain || 0;
    const hasHallucinations = (step4.qc?.hallucination_flags?.length || 0) > 0;
    const hasBusinessFlags = (step4.qc?.business_protection_flags?.length || 0) > 0;

    const shouldPublish =
      overall >= MIN_QC_OVERALL &&
      infoGain >= MIN_QC_INFO_GAIN &&
      !hasHallucinations &&
      !hasBusinessFlags;

    if (!shouldPublish) {
      const reason = overall < MIN_QC_OVERALL ? `QC ${overall}/10 < ${MIN_QC_OVERALL}`
        : infoGain < MIN_QC_INFO_GAIN ? `Info gain ${infoGain}/10 < ${MIN_QC_INFO_GAIN}`
        : hasHallucinations ? 'Hallucination flags' : 'Business protection flags';

      log.result = 'held_for_review';
      log.steps.push({ step: 'quality_gate', decision: 'HOLD', reason, scores });
      return NextResponse.json({ success: true, ...log });
    }

    log.steps.push({ step: 'quality_gate', decision: 'AUTO_PUBLISH', scores });

    // ── STEP 6: Publish (via /api/approve) ──
    const publishResult = await callApprove(postId);
    log.steps.push({ step: 'publish', ...publishResult });

    if (publishResult.blocked) {
      log.result = 'cadence_blocked';
      return NextResponse.json({ success: true, ...log });
    }

    log.result = publishResult.success ? 'published' : 'publish_failed';

    if (queued && publishResult.success) {
      await supabase.from('blog_content_queue').update({ status: 'published' }).eq('id', queued.id);
    }

    // Log the run
    await supabase.from('blog_generation_logs').insert({
      post_id: postId, step: 'autopilot', status: log.result,
      details: log, duration_ms: Date.now() - new Date(log.timestamp).getTime(),
    });

    return NextResponse.json({ success: true, ...log });

  } catch (err) {
    log.result = 'fatal_error';
    log.steps.push({ step: 'fatal', error: err.message });
    return NextResponse.json({ error: err.message, ...log }, { status: 500 });
  }
}

// ── HELPERS ──

async function callGenerate(body) {
  try {
    const res = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function callApprove(postId) {
  try {
    const res = await fetch(`${BASE_URL}/api/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId }),
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}