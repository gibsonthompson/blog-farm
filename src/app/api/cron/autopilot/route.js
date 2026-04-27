import { NextResponse } from 'next/server';
import { recommendNextPosts } from '@/lib/content-strategist.js';
import { runResearch, writeContent, wrapInTemplate, sanitizeGeneratedHtml, injectFaqSchema, loadBusinessContext } from '@/lib/claude.js';
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
 * Persistent cron log helper — writes to blog_cron_logs in Supabase
 * so we can diagnose cron issues without Vercel's 30-min log window.
 */
async function logCronInvocation(entry) {
  try { await supabase.from('blog_cron_logs').insert(entry); } catch { /* table may not exist yet */ }
}

/**
 * GET /api/cron/autopilot?business=callbird
 */
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  const userAgent = request.headers.get('user-agent') || 'unknown';
  const { searchParams } = new URL(request.url);
  const businessSlug = searchParams.get('business') || 'callbird';

  const cronLog = {
    business_slug: businessSlug,
    invoked_at: new Date().toISOString(),
    user_agent: userAgent.substring(0, 200),
    auth_present: !!authHeader,
    auth_match: authHeader === `Bearer ${process.env.CRON_SECRET}`,
    is_vercel_cron: userAgent.includes('vercel-cron'),
    result: null,
    error: null,
  };

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    cronLog.result = 'auth_failed';
    cronLog.error = `Header present: ${!!authHeader}. CRON_SECRET env set: ${!!process.env.CRON_SECRET}`;
    await logCronInvocation(cronLog);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const log = { timestamp: new Date().toISOString(), business: businessSlug, steps: [], result: null };

  try {
    const { data: biz } = await supabase
      .from('blog_businesses').select('*').eq('slug', businessSlug).single();
    if (!biz) {
      cronLog.result = 'business_not_found';
      await logCronInvocation(cronLog);
      return NextResponse.json({ error: `Business "${businessSlug}" not found` }, { status: 404 });
    }

    // PRIORITY 1: Retry approved posts (were cadence-blocked)
    // FIX: If still cadence-blocked, DON'T return — fall through to Phase 2/Phase 1.
    // The approved post stays in the queue for the next cron cycle.
    // This prevents cadence-blocked posts from starving the entire pipeline.
    const { data: approved } = await supabase
      .from('blog_generated_posts')
      .select('id, title')
      .eq('business_id', biz.id)
      .eq('status', 'approved')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (approved) {
      log.steps.push({ step: 'retry_approved', postId: approved.id, title: approved.title });
      try {
        const pubResult = await publishPost(approved.id);
        if (pubResult.blocked) {
          // Cadence still blocking — log it but CONTINUE to process other work
          log.steps.push({ step: 'publish', status: 'still_blocked', note: 'falling through to process drafts' });
          // Don't return here — fall through to Phase 2 and Phase 1
        } else {
          // Published successfully — we're done for this cycle
          log.result = 'retry_published';
          log.steps.push({ step: 'publish', status: 'success' });
          cronLog.result = log.result;
          await logCronInvocation(cronLog);
          return NextResponse.json({ success: true, ...log });
        }
      } catch (err) {
        log.steps.push({ step: 'publish', error: err.message, note: 'falling through to process drafts' });
        // Don't return on publish error either — still try to process drafts
      }
    }

    // PRIORITY 2: Phase 2 — process existing draft (pipeline_step = 1)
    const { data: draft } = await supabase
      .from('blog_generated_posts')
      .select('*')
      .eq('business_id', biz.id)
      .eq('pipeline_step', 1)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (draft) {
      log.steps.push({ step: 'phase', value: 2, postId: draft.id });
      const response = await runPhase2(draft, biz, businessSlug, log, startTime);
      cronLog.result = log.result || 'phase2_complete';
      await logCronInvocation(cronLog);
      return response;
    }

    // PRIORITY 3: Phase 1 — start a new post
    // Skip if we had a cadence-blocked approved post — don't pile up more content
    // when we can't even publish what we have.
    if (approved) {
      log.result = 'still_cadence_blocked';
      log.steps.push({ step: 'skip_phase1', reason: 'Approved post waiting to publish — not generating new content until backlog clears' });
      cronLog.result = log.result;
      await logCronInvocation(cronLog);
      return NextResponse.json({ success: true, ...log });
    }

    log.steps.push({ step: 'phase', value: 1 });
    const response = await runPhase1(biz, businessSlug, log, startTime);
    cronLog.result = log.result || 'phase1_complete';
    await logCronInvocation(cronLog);
    return response;

  } catch (err) {
    log.result = 'fatal_error';
    log.steps.push({ step: 'fatal', error: err.message });
    cronLog.result = 'fatal_error';
    cronLog.error = err.message.substring(0, 500);
    await logCronInvocation(cronLog);
    await sendSms(`🚨 Blog autopilot FATAL ERROR (${businessSlug}):\n${err.message.substring(0, 150)}`);
    return NextResponse.json({ error: err.message, ...log }, { status: 500 });
  }
}

/**
 * PHASE 1: Pick topic → Research → Write → save as "draft"
 */
async function runPhase1(biz, businessSlug, log, startTime) {
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
      targetKeyword = rec.target_keyword || rec.keyword || rec.title;
      postType = rec.post_type || 'guide';
      log.steps.push({ step: 'topic', source: 'ai', keyword: targetKeyword });
    } catch (err) {
      log.result = 'topic_error';
      log.steps.push({ step: 'topic', error: err.message });
      return NextResponse.json({ success: false, ...log });
    }
  }

  let research;
  try {
    const { data: brandKit } = await supabase.from('blog_brand_kits').select('*').eq('business_id', biz.id).single();
    research = await runResearch(targetKeyword, postType, biz, brandKit);
    log.steps.push({ step: 'research', status: 'success', elapsed: `${Date.now() - startTime}ms` });
  } catch (err) {
    log.result = 'research_error';
    log.steps.push({ step: 'research', error: err.message });
    return NextResponse.json({ success: false, ...log });
  }

  const baseSlug = targetKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80);

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

  try {
    const { business: bizCtx, brandKit, existingPosts, referencePosts } = await loadBusinessContext(businessSlug);
    const contentOutput = await writeContent(brandKit, existingPosts, research, postType, targetKeyword, '', referencePosts, bizCtx);

    if (!contentOutput || contentOutput.length < 500) throw new Error('Content too short');

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
    await supabase.from('blog_generated_posts').update({ status: 'rejected' }).eq('id', postId);
    return NextResponse.json({ success: false, ...log });
  }
}

/**
 * PHASE 2: Template → QC → Quality Gate → Publish
 */
async function runPhase2(draft, biz, businessSlug, log, startTime) {
  const postId = draft.id;
  const contentOutput = draft.html_content;
  const promptData = JSON.parse(draft.generation_prompt || '{}');
  const publishMode = biz.publish_mode || 'static';

  let metadata;
  try {
    if (publishMode === 'nextjs') {
      const metaMatch = contentOutput.match(/<metadata>\s*([\s\S]*?)\s*<\/metadata>/);
      if (metaMatch) {
        try { metadata = JSON.parse(metaMatch[1].replace(/```json\n?|```/g, '').trim()); }
        catch { metadata = { title: draft.title, slug: draft.slug, meta_description: '', primary_keyword: draft.primary_keyword }; }
      } else {
        metadata = { title: draft.title, slug: draft.slug, meta_description: '', primary_keyword: draft.primary_keyword };
      }

      const contentMatch = contentOutput.match(/<content>\s*([\s\S]*?)\s*<\/content>/);
      let html = contentMatch ? contentMatch[1].trim() : contentOutput.replace(/<metadata>[\s\S]*?<\/metadata>/, '').trim();

      html = html.replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<\/?html[^>]*>/gi, '')
        .replace(/<head>[\s\S]*?<\/head>/gi, '').replace(/<\/?body[^>]*>/gi, '').trim();
      html = html.replace(/href="blog-([^"]+)\.html"/gi, 'href="/blog/$1"');
      html = html.replace(/\*\*STATISTICS CHECK[\s\S]*$/, '').trim();
      html = html.replace(/<self_review>[\s\S]*?<\/self_review>/gi, '').trim();

      const wordCount = html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;

      await supabase.from('blog_generated_posts').update({
        title: metadata.title, slug: metadata.slug,
        meta_description: metadata.meta_description,
        primary_keyword: metadata.primary_keyword,
        secondary_keywords: metadata.secondary_keywords || [],
        category: metadata.category || draft.category,
        read_time: metadata.read_time, emoji: metadata.emoji,
        excerpt: metadata.excerpt, html_content: html,
        word_count: wordCount,
      }).eq('id', postId);

      log.steps.push({ step: 'template', status: 'success', mode: 'nextjs', title: metadata.title, elapsed: `${Date.now() - startTime}ms` });

    } else {
      const templateResult = await wrapInTemplate(contentOutput, biz.domain, biz.phone, biz.gtm_id, biz.blog_file_prefix);
      metadata = templateResult.metadata;

      const { data: allExisting } = await supabase.from('blog_existing_posts').select('slug').eq('business_id', biz.id);
      const existingSlugs = (allExisting || []).map(p => p.slug);

      let html = sanitizeGeneratedHtml(templateResult.html, existingSlugs);
      html = injectFaqSchema(html, metadata, biz.domain, biz.blog_file_prefix);
      const validation = validatePost(html, metadata, existingSlugs, biz);

      if (!validation.valid) {
        await supabase.from('blog_generated_posts').update({
          title: metadata.title, slug: metadata.slug, html_content: html,
          category: metadata.category || draft.category,
          status: 'revision_needed',
          qc_notes: JSON.stringify({ validation_errors: validation.errors }),
        }).eq('id', postId);

        log.result = 'validation_failed';
        log.steps.push({ step: 'template', errors: validation.errors });
        await sendSms(`❌ Blog post validation failed (${businessSlug}):\n"${metadata.title}"\nErrors: ${validation.errors.slice(0, 3).map(e => e.message || e).join(', ')}`);
        return NextResponse.json({ success: true, ...log });
      }

      await supabase.from('blog_generated_posts').update({
        title: metadata.title, slug: metadata.slug,
        meta_description: metadata.meta_description,
        primary_keyword: metadata.primary_keyword,
        secondary_keywords: metadata.secondary_keywords || [],
        category: metadata.category || draft.category,
        read_time: metadata.read_time, emoji: metadata.emoji,
        excerpt: metadata.excerpt, html_content: html,
        word_count: html.replace(/<[^>]*>/g, ' ').split(/\s+/).length,
      }).eq('id', postId);

      log.steps.push({ step: 'template', status: 'success', mode: 'static', title: metadata.title, elapsed: `${Date.now() - startTime}ms` });
    }

    try {
      const { data: postData } = await supabase.from('blog_generated_posts').select('html_content').eq('id', postId).single();
      const attrs = extractContentAttributes(postData.html_content, metadata, null);
      attrs.post_id = postId;
      await supabase.from('blog_post_attributes').upsert(attrs, { onConflict: 'post_id' });
    } catch { /* skip */ }

  } catch (err) {
    log.result = 'template_error';
    log.steps.push({ step: 'template', error: err.message });
    await supabase.from('blog_generated_posts').update({ status: 'rejected' }).eq('id', postId);
    await sendSms(`❌ Blog autopilot template error (${businessSlug}):\n${err.message.substring(0, 100)}`);
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
    await sendSms(`❌ Blog autopilot QC error (${businessSlug}):\n${err.message.substring(0, 100)}`);
    return NextResponse.json({ success: false, ...log });
  }

  // ── Quality Gate ──
  const overall = qcResult.scores?.overall || 0;
  const infoGain = qcResult.scores?.information_gain || 0;
  const hasHallucinations = (qcResult.hallucination_flags?.length || 0) > 0;

  const shouldPublish =
    overall >= MIN_QC_OVERALL &&
    infoGain >= MIN_QC_INFO_GAIN &&
    !hasHallucinations &&
    (qcResult.business_protection_flags?.length || 0) <= 1 &&
    qcResult.verdict !== 'reject';

  if (!shouldPublish) {
    const bizFlagCount = qcResult.business_protection_flags?.length || 0;
    const reason = overall < MIN_QC_OVERALL ? `QC ${overall} < ${MIN_QC_OVERALL}`
      : infoGain < MIN_QC_INFO_GAIN ? `Info gain ${infoGain} < ${MIN_QC_INFO_GAIN}`
      : hasHallucinations ? 'Hallucination flags'
      : bizFlagCount > 1 ? `${bizFlagCount} business protection flags`
      : 'QC verdict: reject';

    await supabase.from('blog_generated_posts').update({
      status: 'revision_needed', pipeline_step: 2,
      qc_score: qcResult,
      qc_notes: JSON.stringify({ scores: qcResult.scores, held_reason: reason }),
    }).eq('id', postId);

    log.result = 'held_for_review';
    log.steps.push({ step: 'quality_gate', decision: 'HOLD', reason });
    await sendSms(`⚠️ Blog post needs review (${businessSlug}):\n"${metadata.title}"\nReason: ${reason}\nScores: ${overall}/10`);
    return NextResponse.json({ success: true, ...log });
  }

  log.steps.push({ step: 'quality_gate', decision: 'AUTO_PUBLISH', scores: qcResult.scores });

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

    if (promptData.queueId) {
      await supabase.from('blog_content_queue').update({ status: 'published' }).eq('id', promptData.queueId);
    }
  } catch (err) {
    log.result = 'publish_error';
    log.steps.push({ step: 'publish', error: err.message });
    await supabase.from('blog_generated_posts').update({ status: 'approved' }).eq('id', postId);
    await sendSms(`❌ Blog publish failed (${businessSlug}):\n"${metadata.title}"\n${err.message.substring(0, 100)}`);
  }

  await supabase.from('blog_generation_logs').insert({
    post_id: postId, step: 'autopilot_phase2', status: log.result,
    details: log, duration_ms: Date.now() - startTime,
  });

  return NextResponse.json({ success: true, ...log });
}