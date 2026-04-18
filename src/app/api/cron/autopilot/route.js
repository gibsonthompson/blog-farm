import { NextResponse } from 'next/server';
import { recommendNextPosts } from '@/lib/content-strategist.js';
import { runResearch, writeContent, wrapInTemplate, sanitizeGeneratedHtml, loadBusinessContext } from '@/lib/claude.js';
import { runQualityControl } from '@/lib/quality-control.js';
import { validatePost } from '@/lib/post-validation.js';
import { publishPost } from '@/lib/publish.js';
import { extractContentAttributes } from '@/lib/performance.js';
import { sendSms } from '@/lib/sms.js';
import supabase from '@/lib/supabase.js';

export const maxDuration = 300;

const MIN_QC_OVERALL = 7;
const MIN_QC_INFO_GAIN = 6;

/**
 * GET /api/cron/autopilot
 * 
 * Priority order each run:
 *   1. Retry approved posts (cadence-blocked last time)
 *   2. Phase 2: template + QC + publish a draft (pipeline_step = 1)
 *   3. Phase 1: pick topic + research + write a new draft
 * 
 * SMS notifications sent when posts need manual review.
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

    // PRIORITY 1: Retry approved posts (were cadence-blocked)
    const { data: approved } = await supabase
      .from('blog_generated_posts')
      .select('id, title')
      .eq('business_id', biz.id)
      .eq('status', 'approved')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (approved) {
      log.steps.push({ step: 'retry_publish', postId: approved.id, title: approved.title });
      try {
        const pubResult = await publishPost(approved.id);
        if (pubResult.blocked) {
          log.result = 'still_cadence_blocked';
          log.steps.push({ step: 'publish', status: 'blocked' });
        } else {
          log.result = 'published';
          log.steps.push({ step: 'publish', status: 'success' });
        }
      } catch (err) {
        log.result = 'retry_publish_error';
        log.steps.push({ step: 'publish', error: err.message });
      }
      return NextResponse.json({ success: true, ...log });
    }

    // PRIORITY 2: Phase 2 — finish a draft
    const { data: draft } = await supabase
      .from('blog_generated_posts')
      .select('*')
      .eq('business_id', biz.id)
      .eq('status', 'pending')
      .eq('pipeline_step', 1)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (draft) {
      log.steps.push({ step: 'phase', value: 2, postId: draft.id, title: draft.title });
      return await runPhase2(draft, biz, log, startTime);
    }

    // PRIORITY 3: Phase 1 — start a new post
    log.steps.push({ step: 'phase', value: 1 });
    return await runPhase1(biz, businessSlug, log, startTime);

  } catch (err) {
    log.result = 'fatal_error';
    log.steps.push({ step: 'fatal', error: err.message });

    await sendSms(`🚨 Blog autopilot FATAL ERROR:\n${err.message.substring(0, 150)}`);

    return NextResponse.json({ error: err.message, ...log }, { status: 500 });
  }
}

/**
 * PHASE 1: Pick topic → Research → Write → save as "draft"
 * ~3 Claude calls, ~90-150s
 */
async function runPhase1(biz, businessSlug, log, startTime) {
  // ── Pick topic ──
  let targetKeyword, postType, queueId;

  const { data: queued } = await supabase
    .from('blog_content_queue')
    .select('*').eq('business_id', biz.id).eq('status', 'pending')
    .lte('scheduled_date', new Date().toISOString().split('T')[0])
    .order('scheduled_date', { ascending: true }).limit(1).single();

  if (queued) {
    targetKeyword = queued.keyword;
    postType = queued.post_type;
    queueId = queued.id;
    log.steps.push({ step: 'topic', source: 'queue', keyword: targetKeyword });
    await supabase.from('blog_content_queue').update({ status: 'generating' }).eq('id', queued.id);
  } else {
    try {
      const strategy = await recommendNextPosts(businessSlug, 1);
      const rec = strategy.recommendations?.[0];
      if (!rec) {
        log.result = 'no_topics';
        return NextResponse.json({ success: true, ...log });
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

  // ── Research (skip Claude dedup — use word matching only to save time) ──
  let research;
  try {
    research = await runResearch(targetKeyword, postType);
    log.steps.push({ step: 'research', status: 'success', elapsed: `${Date.now() - startTime}ms` });
  } catch (err) {
    log.result = 'research_error';
    log.steps.push({ step: 'research', error: err.message });
    return NextResponse.json({ success: false, ...log });
  }

  // ── Create post record ──
  const baseSlug = targetKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80);

  // Clean up old failed attempts with same slug
  const { data: existing } = await supabase
    .from('blog_generated_posts').select('id, status')
    .eq('business_id', biz.id).eq('slug', baseSlug);
  if (existing?.length) {
    const live = existing.filter(r => ['published', 'approved', 'draft'].includes(r.status));
    if (live.length) {
      log.result = 'slug_exists';
      log.steps.push({ step: 'create', error: `Slug "${baseSlug}" already in use` });
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
    generation_prompt: JSON.stringify({ research, targetKeyword, postType, queueId }),
    word_count: 0,
  }).select().single();

  const postId = post.id;

  // ── Write ──
  try {
    const { brandKit, existingPosts, referencePosts } = await loadBusinessContext(businessSlug);
    const contentOutput = await writeContent(brandKit, existingPosts, research, postType, targetKeyword, '', referencePosts);

    if (!contentOutput || contentOutput.length < 500) throw new Error('Content too short');

    // Save content and mark as ready for Phase 2
    await supabase.from('blog_generated_posts').update({
      html_content: contentOutput,
      word_count: contentOutput.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length,
      pipeline_step: 1,
      updated_at: new Date().toISOString(),
    }).eq('id', postId);

    log.result = 'draft_created';
    log.steps.push({ step: 'write', status: 'success', length: contentOutput.length, elapsed: `${Date.now() - startTime}ms` });

    await supabase.from('blog_generation_logs').insert({
      post_id: postId, step: 'autopilot_phase1', status: 'success',
      details: log, duration_ms: Date.now() - startTime,
    });

    return NextResponse.json({ success: true, ...log });
  } catch (err) {
    log.result = 'write_error';
    log.steps.push({ step: 'write', error: err.message });
    await supabase.from('blog_generated_posts').update({ status: 'failed' }).eq('id', postId);
    return NextResponse.json({ success: false, ...log });
  }
}

/**
 * PHASE 2: Template → QC → Quality Gate → Publish
 * ~2 Claude calls + GitHub, ~60-90s
 */
async function runPhase2(draft, biz, log, startTime) {
  const postId = draft.id;
  const contentOutput = draft.html_content;
  const promptData = JSON.parse(draft.generation_prompt || '{}');

  // ── Template + Validate ──
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
      log.steps.push({ step: 'template', errors: validation.errors });

      await sendSms(`❌ Blog post validation failed:\n"${metadata.title}"\nErrors: ${validation.errors.slice(0, 3).map(e => e.message || e).join(', ')}\nhttps://blog-farm.vercel.app`);

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

    await sendSms(`❌ Blog autopilot template error:\n${err.message.substring(0, 100)}\nhttps://blog-farm.vercel.app`);

    return NextResponse.json({ success: false, ...log });
  }

  // ── QC ──
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

    await sendSms(`❌ Blog autopilot QC error:\n${err.message.substring(0, 100)}\nhttps://blog-farm.vercel.app`);

    return NextResponse.json({ success: false, ...log });
  }

  // ── Quality Gate ──
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
      pipeline_step: 2,
      qc_notes: JSON.stringify({ scores: qcResult.scores, held_reason: reason }),
    }).eq('id', postId);

    log.result = 'held_for_review';
    log.steps.push({ step: 'quality_gate', decision: 'HOLD', reason });

    await sendSms(`⚠️ Blog post needs review:\n"${draft.title.replace('[Generating] ', '')}"\nReason: ${reason}\nScores: ${overall}/10 overall\nhttps://blog-farm.vercel.app`);

    return NextResponse.json({ success: true, ...log });
  }

  log.steps.push({ step: 'quality_gate', decision: 'AUTO_PUBLISH', scores: qcResult.scores });

  // ── Publish ──
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

    // Update queue if this came from there
    if (promptData.queueId) {
      await supabase.from('blog_content_queue').update({ status: 'published' }).eq('id', promptData.queueId);
    }
  } catch (err) {
    log.result = 'publish_error';
    log.steps.push({ step: 'publish', error: err.message });
    await supabase.from('blog_generated_posts').update({ status: 'approved' }).eq('id', postId);

    await sendSms(`❌ Blog publish failed:\n"${draft.title.replace('[Generating] ', '')}"\n${err.message.substring(0, 100)}\nhttps://blog-farm.vercel.app`);
  }

  await supabase.from('blog_generation_logs').insert({
    post_id: postId, step: 'autopilot_phase2', status: log.result,
    details: log, duration_ms: Date.now() - startTime,
  });

  return NextResponse.json({ success: true, ...log });
}