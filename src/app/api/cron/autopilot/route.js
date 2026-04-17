import { NextResponse } from 'next/server';
import { recommendNextPosts } from '@/lib/content-strategist.js';
import { loadBusinessContext, runResearch, writeContent, wrapInTemplate, sanitizeGeneratedHtml } from '@/lib/claude.js';
import { runQualityControl } from '@/lib/quality-control.js';
import { validatePost } from '@/lib/post-validation.js';
import { validatePostUniqueness } from '@/lib/dedup-validator.js';
import { publishPost } from '@/lib/publish.js';
import { extractContentAttributes } from '@/lib/performance.js';
import supabase from '@/lib/supabase.js';

export const maxDuration = 300; // 5 minutes — full pipeline

// ── AUTO-PUBLISH THRESHOLDS ──
const MIN_QC_OVERALL = 7;
const MIN_QC_INFO_GAIN = 6;

/**
 * GET /api/cron/autopilot
 * 
 * Fully autonomous content pipeline:
 * 1. Pick next keyword from strategist recommendations or content queue
 * 2. Run full 4-step generation (research → write → template → QC)
 * 3. Quality gate: auto-publish if score meets thresholds, hold if not
 * 4. Respects cadence limits (max 3/week, min 1 day apart)
 * 
 * Schedule: Mon/Wed/Fri at 8am ET (3 posts/week max)
 * Protected by CRON_SECRET.
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
      .from('blog_businesses').select('*').eq('slug', businessSlug).single();
    if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    // ── STEP 0: Pick the next topic ──
    let targetKeyword, postType;

    // First check the content queue for scheduled posts
    const { data: queued } = await supabase
      .from('blog_content_queue')
      .select('*')
      .eq('business_id', biz.id)
      .eq('status', 'pending')
      .lte('scheduled_date', new Date().toISOString().split('T')[0])
      .order('scheduled_date', { ascending: true })
      .limit(1)
      .single();

    if (queued) {
      targetKeyword = queued.keyword;
      postType = queued.post_type;
      log.steps.push({ step: 'topic_selection', source: 'queue', keyword: targetKeyword, type: postType });

      // Mark as in-progress
      await supabase.from('blog_content_queue')
        .update({ status: 'generating' }).eq('id', queued.id);
    } else {
      // No queued posts — get AI recommendation
      try {
        const strategy = await recommendNextPosts(businessSlug, 1);
        const rec = strategy.recommendations?.[0];
        if (!rec) {
          log.result = 'no_recommendation';
          return NextResponse.json({ success: true, ...log, message: 'No content recommendations available' });
        }
        targetKeyword = rec.keyword || rec.title;
        postType = rec.post_type || 'guide';
        log.steps.push({ step: 'topic_selection', source: 'ai_recommendation', keyword: targetKeyword, type: postType });
      } catch (err) {
        log.result = 'recommendation_error';
        log.steps.push({ step: 'topic_selection', error: err.message });
        return NextResponse.json({ success: false, ...log });
      }
    }

    // ── STEP 1: Research ──
    let research;
    try {
      research = await runResearch(targetKeyword, postType);

      if (!research) {
        throw new Error('Research returned empty');
      }

      log.steps.push({ step: 'research', status: 'success', stats_found: research.verified_statistics?.length || 0 });
    } catch (err) {
      log.result = 'research_error';
      log.steps.push({ step: 'research', error: err.message });
      return NextResponse.json({ success: false, ...log });
    }

    // Create the post record
    const baseSlug = targetKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    
    // Clean up any old failed attempts with this slug
    const { data: existingRecords } = await supabase
      .from('blog_generated_posts').select('id, status')
      .eq('business_id', biz.id).eq('slug', baseSlug);
    if (existingRecords?.length) {
      const live = existingRecords.filter(r => ['published', 'approved'].includes(r.status));
      if (live.length) {
        log.result = 'slug_exists';
        log.steps.push({ step: 'create_record', error: `Slug "${baseSlug}" already published` });
        return NextResponse.json({ success: true, ...log });
      }
      const deadIds = existingRecords.map(r => r.id);
      await supabase.from('blog_generation_logs').delete().in('post_id', deadIds);
      await supabase.from('blog_generated_posts').delete().in('id', deadIds);
    }

    const { data: post } = await supabase.from('blog_generated_posts').insert({
      business_id: biz.id,
      title: `[Generating] ${targetKeyword}`,
      slug: baseSlug,
      primary_keyword: targetKeyword,
      category: postType,
      html_content: '<p>Generating...</p>',
      status: 'pending',
      generation_prompt: JSON.stringify({ research, notes: '', targetKeyword, postType }),
      word_count: 0,
    }).select().single();

    const postId = post.id;

    // ── STEP 2: Write Content ──
    let contentOutput;
    try {
      const { brandKit, existingPosts, referencePosts } = await loadBusinessContext(businessSlug);
      contentOutput = await writeContent(brandKit, existingPosts, research, postType, targetKeyword, '', referencePosts);

      if (!contentOutput || contentOutput.length < 500) {
        throw new Error('Content too short or empty');
      }

      await supabase.from('blog_generated_posts').update({
        html_content: contentOutput,
        updated_at: new Date().toISOString(),
      }).eq('id', postId);

      log.steps.push({ step: 'write', status: 'success', length: contentOutput.length });
    } catch (err) {
      log.result = 'write_error';
      log.steps.push({ step: 'write', error: err.message });
      await supabase.from('blog_generated_posts').update({ status: 'failed' }).eq('id', postId);
      return NextResponse.json({ success: false, ...log });
    }

    // ── STEP 3: HTML Template + Sanitization + Validation ──
    let html, metadata;
    try {
      const templateResult = await wrapInTemplate(contentOutput, biz.domain, biz.phone, biz.gtm_id, biz.blog_file_prefix);
      metadata = templateResult.metadata;

      const { data: allExisting } = await supabase.from('blog_existing_posts')
        .select('slug').eq('business_id', biz.id);
      const existingSlugs = (allExisting || []).map(p => p.slug);

      html = sanitizeGeneratedHtml(templateResult.html, existingSlugs);

      const validation = validatePost(html, metadata, existingSlugs);

      if (!validation.valid) {
        await supabase.from('blog_generated_posts').update({
          title: metadata.title, slug: metadata.slug, html_content: html,
          word_count: html.replace(/<[^>]*>/g, ' ').split(/\s+/).length,
          status: 'revision_needed',
          qc_notes: JSON.stringify({ validation_errors: validation.errors }),
          updated_at: new Date().toISOString(),
        }).eq('id', postId);

        log.result = 'validation_failed';
        log.steps.push({ step: 'template', status: 'validation_failed', errors: validation.errors });
        return NextResponse.json({ success: true, ...log });
      }

      // Update post with template data
      await supabase.from('blog_generated_posts').update({
        title: metadata.title, slug: metadata.slug,
        meta_description: metadata.meta_description,
        primary_keyword: metadata.primary_keyword,
        secondary_keywords: metadata.secondary_keywords || [],
        read_time: metadata.read_time, emoji: metadata.emoji,
        excerpt: metadata.excerpt, html_content: html,
        word_count: html.replace(/<[^>]*>/g, ' ').split(/\s+/).length,
        updated_at: new Date().toISOString(),
      }).eq('id', postId);

      // Track content attributes
      try {
        const attrs = extractContentAttributes(html, metadata, null);
        attrs.post_id = postId;
        await supabase.from('blog_post_attributes').upsert(attrs, { onConflict: 'post_id' });
      } catch { /* non-blocking */ }

      log.steps.push({ step: 'template', status: 'success', title: metadata.title });
    } catch (err) {
      log.result = 'template_error';
      log.steps.push({ step: 'template', error: err.message });
      await supabase.from('blog_generated_posts').update({ status: 'failed' }).eq('id', postId);
      return NextResponse.json({ success: false, ...log });
    }

    // ── STEP 4: Quality Control ──
    let qcResult;
    try {
      const { data: brandKit } = await supabase
        .from('blog_brand_kits').select('*').eq('business_id', biz.id).single();
      qcResult = await runQualityControl(postId, biz, brandKit);

      // Update attributes with QC scores
      try {
        await supabase.from('blog_post_attributes').upsert({
          post_id: postId,
          qc_overall: qcResult.scores?.overall || null,
          qc_info_gain: qcResult.scores?.information_gain || null,
          qc_aeo: qcResult.scores?.aeo_readiness || null,
        }, { onConflict: 'post_id' });
      } catch { /* non-blocking */ }

      log.steps.push({
        step: 'qc', status: 'success',
        scores: qcResult.scores,
        verdict: qcResult.verdict,
        hallucination_flags: qcResult.hallucination_flags?.length || 0,
        business_protection_flags: qcResult.business_protection_flags?.length || 0,
      });
    } catch (err) {
      log.result = 'qc_error';
      log.steps.push({ step: 'qc', error: err.message });
      await supabase.from('blog_generated_posts').update({ status: 'revision_needed' }).eq('id', postId);
      return NextResponse.json({ success: false, ...log });
    }

    // ── STEP 5: QUALITY GATE — Auto-publish or hold? ──
    const overall = qcResult.scores?.overall || 0;
    const infoGain = qcResult.scores?.information_gain || 0;
    const hasHallucinations = (qcResult.hallucination_flags?.length || 0) > 0;
    const hasBusinessFlags = (qcResult.business_protection_flags?.length || 0) > 0;

    const autoPublish = 
      overall >= MIN_QC_OVERALL &&
      infoGain >= MIN_QC_INFO_GAIN &&
      !hasHallucinations &&
      !hasBusinessFlags &&
      qcResult.verdict !== 'reject';

    if (!autoPublish) {
      // Hold for manual review
      await supabase.from('blog_generated_posts').update({
        status: 'pending', // Stays in review queue
        qc_notes: JSON.stringify({
          scores: qcResult.scores,
          issues: qcResult.issues,
          held_reason: overall < MIN_QC_OVERALL ? `QC score ${overall} below threshold ${MIN_QC_OVERALL}`
            : infoGain < MIN_QC_INFO_GAIN ? `Info gain ${infoGain} below threshold ${MIN_QC_INFO_GAIN}`
            : hasHallucinations ? 'Hallucination flags detected'
            : hasBusinessFlags ? 'Business protection flags detected'
            : `QC verdict: ${qcResult.verdict}`,
        }),
      }).eq('id', postId);

      log.result = 'held_for_review';
      log.steps.push({
        step: 'quality_gate', decision: 'HOLD',
        reason: `QC: ${overall}/10, Info Gain: ${infoGain}/10, Hallucinations: ${hasHallucinations}, Business flags: ${hasBusinessFlags}`,
      });

      return NextResponse.json({ success: true, ...log });
    }

    // ── STEP 6: Auto-publish ──
    try {
      const publishResult = await publishPost(postId);

      if (publishResult.blocked) {
        log.result = 'cadence_blocked';
        log.steps.push({ step: 'publish', status: 'blocked', reason: publishResult.errors?.[0]?.error });
        // Don't fail — post is ready, just needs to wait
        await supabase.from('blog_generated_posts').update({ status: 'approved' }).eq('id', postId);
        return NextResponse.json({ success: true, ...log });
      }

      log.result = 'published';
      log.steps.push({ step: 'publish', status: 'success', ...publishResult });

      // Update queue if this came from there
      if (queued) {
        await supabase.from('blog_content_queue').update({ status: 'published' }).eq('id', queued.id);
      }

    } catch (err) {
      log.result = 'publish_error';
      log.steps.push({ step: 'publish', error: err.message });
      // Post is generated and QC-passed — mark as approved for manual publish
      await supabase.from('blog_generated_posts').update({ status: 'approved' }).eq('id', postId);
      return NextResponse.json({ success: false, ...log });
    }

    // Log the full autopilot run
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