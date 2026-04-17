import { NextResponse } from 'next/server';
import { recommendNextPosts } from '@/lib/content-strategist.js';
import { runResearch, writeContent, wrapInTemplate, sanitizeGeneratedHtml, loadBusinessContext } from '@/lib/claude.js';
import { runQualityControl } from '@/lib/quality-control.js';
import { validatePost } from '@/lib/post-validation.js';
import { validateKeywordUniqueness } from '@/lib/dedup-validator.js';
import { publishPost } from '@/lib/publish.js';
import { extractContentAttributes } from '@/lib/performance.js';
import supabase from '@/lib/supabase.js';

// Fluid Compute on Hobby: 300s max. AI I/O (waiting for Claude) does NOT count as CPU time.
export const maxDuration = 300;

const MIN_QC_OVERALL = 7;
const MIN_QC_INFO_GAIN = 6;

/**
 * GET /api/cron/autopilot
 * 
 * Fully autonomous: pick topic → research → write → template → QC → quality gate → publish
 * All logic runs directly (no HTTP self-calls) to avoid Vercel routing issues.
 * Each step has its own try/catch so the function ALWAYS returns a response.
 */
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const businessSlug = 'callbird';
  const startTime = Date.now();
  const log = { timestamp: new Date().toISOString(), steps: [], result: null };

  try {
    const { data: biz } = await supabase
      .from('blog_businesses').select('*').eq('slug', businessSlug).single();
    if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    // ── STEP 0: Pick topic ──
    let targetKeyword, postType;

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
      const strategy = await recommendNextPosts(businessSlug, 1);
      const rec = strategy.recommendations?.[0];
      if (!rec) {
        log.result = 'no_topics';
        return NextResponse.json({ success: true, ...log });
      }
      targetKeyword = rec.keyword || rec.title;
      postType = rec.post_type || 'guide';
      log.steps.push({ step: 'topic', source: 'ai', keyword: targetKeyword });
    }

    // ── STEP 1: Research ──
    let research;
    try {
      // Dedup check
      const dedup = await validateKeywordUniqueness(biz.id, targetKeyword, postType);
      if (!dedup.unique) {
        log.result = 'duplicate_topic';
        log.steps.push({ step: 'research', status: 'skipped', reason: dedup.reason });
        return NextResponse.json({ success: true, ...log });
      }

      research = await runResearch(targetKeyword, postType);
      log.steps.push({ step: 'research', status: 'success', elapsed: `${Date.now() - startTime}ms` });
    } catch (err) {
      log.result = 'research_error';
      log.steps.push({ step: 'research', error: err.message });
      return NextResponse.json({ success: false, ...log });
    }

    // Create post record
    const baseSlug = targetKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80);

    // Clean up old failed attempts
    const { data: existing } = await supabase
      .from('blog_generated_posts').select('id, status')
      .eq('business_id', biz.id).eq('slug', baseSlug);
    if (existing?.length) {
      const live = existing.filter(r => ['published', 'approved'].includes(r.status));
      if (live.length) {
        log.result = 'slug_exists';
        return NextResponse.json({ success: true, ...log });
      }
      const deadIds = existing.map(r => r.id);
      await supabase.from('blog_generation_logs').delete().in('post_id', deadIds);
      await supabase.from('blog_generated_posts').delete().in('id', deadIds);
    }

    const { data: post } = await supabase.from('blog_generated_posts').insert({
      business_id: biz.id, title: `[Generating] ${targetKeyword}`, slug: baseSlug,
      primary_keyword: targetKeyword, category: postType,
      html_content: '<p>Generating...</p>', status: 'pending',
      generation_prompt: JSON.stringify({ research, targetKeyword, postType }),
      word_count: 0,
    }).select().single();

    const postId = post.id;

    // ── STEP 2: Write ──
    let contentOutput;
    try {
      const { brandKit, existingPosts, referencePosts } = await loadBusinessContext(businessSlug);
      contentOutput = await writeContent(brandKit, existingPosts, research, postType, targetKeyword, '', referencePosts);

      if (!contentOutput || contentOutput.length < 500) throw new Error('Content too short');

      await supabase.from('blog_generated_posts').update({
        html_content: contentOutput, updated_at: new Date().toISOString(),
      }).eq('id', postId);

      log.steps.push({ step: 'write', status: 'success', length: contentOutput.length, elapsed: `${Date.now() - startTime}ms` });
    } catch (err) {
      log.result = 'write_error';
      log.steps.push({ step: 'write', error: err.message });
      await supabase.from('blog_generated_posts').update({ status: 'failed' }).eq('id', postId);
      return NextResponse.json({ success: false, ...log });
    }

    // ── STEP 3: Template + Validate ──
    let metadata;
    try {
      const templateResult = await wrapInTemplate(contentOutput, biz.domain, biz.phone, biz.gtm_id, biz.blog_file_prefix);
      metadata = templateResult.metadata;

      const { data: allExisting } = await supabase.from('blog_existing_posts').select('slug').eq('business_id', biz.id);
      const existingSlugs = (allExisting || []).map(p => p.slug);

      const html = sanitizeGeneratedHtml(templateResult.html, existingSlugs);
      const validation = validatePost(html, metadata, existingSlugs);

      if (!validation.valid) {
        await supabase.from('blog_generated_posts').update({
          title: metadata.title, slug: metadata.slug, html_content: html,
          status: 'revision_needed',
          qc_notes: JSON.stringify({ validation_errors: validation.errors }),
        }).eq('id', postId);

        log.result = 'validation_failed';
        log.steps.push({ step: 'template', status: 'validation_failed', errors: validation.errors });
        return NextResponse.json({ success: true, ...log });
      }

      await supabase.from('blog_generated_posts').update({
        title: metadata.title, slug: metadata.slug,
        meta_description: metadata.meta_description,
        primary_keyword: metadata.primary_keyword,
        secondary_keywords: metadata.secondary_keywords || [],
        read_time: metadata.read_time, emoji: metadata.emoji,
        excerpt: metadata.excerpt, html_content: html,
        word_count: html.replace(/<[^>]*>/g, ' ').split(/\s+/).length,
      }).eq('id', postId);

      // Track attributes (non-blocking)
      try {
        const attrs = extractContentAttributes(html, metadata, null);
        attrs.post_id = postId;
        await supabase.from('blog_post_attributes').upsert(attrs, { onConflict: 'post_id' });
      } catch { /* skip */ }

      log.steps.push({ step: 'template', status: 'success', title: metadata.title, elapsed: `${Date.now() - startTime}ms` });
    } catch (err) {
      log.result = 'template_error';
      log.steps.push({ step: 'template', error: err.message });
      await supabase.from('blog_generated_posts').update({ status: 'failed' }).eq('id', postId);
      return NextResponse.json({ success: false, ...log });
    }

    // ── STEP 4: QC ──
    let qcResult;
    try {
      const { data: brandKit } = await supabase.from('blog_brand_kits').select('*').eq('business_id', biz.id).single();
      qcResult = await runQualityControl(postId, biz, brandKit);

      try {
        await supabase.from('blog_post_attributes').upsert({
          post_id: postId,
          qc_overall: qcResult.scores?.overall || null,
          qc_info_gain: qcResult.scores?.information_gain || null,
          qc_aeo: qcResult.scores?.aeo_readiness || null,
        }, { onConflict: 'post_id' });
      } catch { /* skip */ }

      log.steps.push({
        step: 'qc', status: 'success', scores: qcResult.scores,
        hallucinations: qcResult.hallucination_flags?.length || 0,
        business_flags: qcResult.business_protection_flags?.length || 0,
        elapsed: `${Date.now() - startTime}ms`,
      });
    } catch (err) {
      log.result = 'qc_error';
      log.steps.push({ step: 'qc', error: err.message });
      await supabase.from('blog_generated_posts').update({ status: 'revision_needed' }).eq('id', postId);
      return NextResponse.json({ success: false, ...log });
    }

    // ── STEP 5: Quality Gate ──
    const overall = qcResult.scores?.overall || 0;
    const infoGain = qcResult.scores?.information_gain || 0;
    const hasHallucinations = (qcResult.hallucination_flags?.length || 0) > 0;
    const hasBusinessFlags = (qcResult.business_protection_flags?.length || 0) > 0;

    const shouldPublish =
      overall >= MIN_QC_OVERALL &&
      infoGain >= MIN_QC_INFO_GAIN &&
      !hasHallucinations &&
      !hasBusinessFlags &&
      qcResult.verdict !== 'reject';

    if (!shouldPublish) {
      const reason = overall < MIN_QC_OVERALL ? `QC ${overall} < ${MIN_QC_OVERALL}`
        : infoGain < MIN_QC_INFO_GAIN ? `Info gain ${infoGain} < ${MIN_QC_INFO_GAIN}`
        : hasHallucinations ? 'Hallucination flags' : 'Business protection flags';

      await supabase.from('blog_generated_posts').update({
        status: 'pending',
        qc_notes: JSON.stringify({ scores: qcResult.scores, held_reason: reason }),
      }).eq('id', postId);

      log.result = 'held_for_review';
      log.steps.push({ step: 'quality_gate', decision: 'HOLD', reason, scores: qcResult.scores });
      return NextResponse.json({ success: true, ...log });
    }

    log.steps.push({ step: 'quality_gate', decision: 'AUTO_PUBLISH', scores: qcResult.scores });

    // ── STEP 6: Publish ──
    try {
      const pubResult = await publishPost(postId);

      if (pubResult.blocked) {
        await supabase.from('blog_generated_posts').update({ status: 'approved' }).eq('id', postId);
        log.result = 'cadence_blocked';
        log.steps.push({ step: 'publish', status: 'blocked' });
        return NextResponse.json({ success: true, ...log });
      }

      log.result = 'published';
      log.steps.push({ step: 'publish', status: 'success', elapsed: `${Date.now() - startTime}ms` });

      if (queued) await supabase.from('blog_content_queue').update({ status: 'published' }).eq('id', queued.id);
    } catch (err) {
      log.result = 'publish_error';
      log.steps.push({ step: 'publish', error: err.message });
      await supabase.from('blog_generated_posts').update({ status: 'approved' }).eq('id', postId);
    }

    await supabase.from('blog_generation_logs').insert({
      post_id: postId, step: 'autopilot', status: log.result,
      details: log, duration_ms: Date.now() - startTime,
    });

    return NextResponse.json({ success: true, ...log });

  } catch (err) {
    log.result = 'fatal_error';
    log.steps.push({ step: 'fatal', error: err.message });
    return NextResponse.json({ error: err.message, ...log }, { status: 500 });
  }
}