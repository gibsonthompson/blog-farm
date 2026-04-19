import { NextResponse } from 'next/server';
import { runResearch, writeContent, wrapInTemplate, sanitizeGeneratedHtml, loadBusinessContext } from '@/lib/claude.js';
import { runQualityControl } from '@/lib/quality-control.js';
import { validateKeywordUniqueness, validatePostUniqueness } from '@/lib/dedup-validator.js';
import { validatePost } from '@/lib/post-validation.js';
import supabase from '@/lib/supabase.js';

// Fluid Compute on Hobby allows up to 300s — AI API I/O doesn't count as CPU time
export const maxDuration = 300;

/**
 * 4-step generation pipeline. Each step is a separate API call < 60s.
 * 
 * Step 1 (research):  dedup check → web search research → create post record
 * Step 2 (write):     load research → write content → save to post
 * Step 3 (template):  load content → wrap in HTML → post-dedup check
 * Step 4 (qc):        run quality control → save scores
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (parseErr) {
    return NextResponse.json({ error: `Invalid request body: ${parseErr.message}` }, { status: 400 });
  }

  try {
    const { action = 'research', businessSlug = 'callbird' } = body;

    switch (action) {
      case 'research': return await handleResearch(body, businessSlug);
      case 'write': return await handleWrite(body, businessSlug);
      case 'template': return await handleTemplate(body, businessSlug);
      case 'qc': return await handleQC(body, businessSlug);
      case 'full': return await handleFull(body, businessSlug);
      default: return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('Generation error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── STEP 1: Dedup + Research ──

async function handleResearch(body, businessSlug) {
  const { targetKeyword, postType, notes } = body;

  if (!targetKeyword) return NextResponse.json({ error: 'targetKeyword is required' }, { status: 400 });
  if (!postType) return NextResponse.json({ error: 'postType is required' }, { status: 400 });

  console.log(`[blog-farm] Step 1: Research "${targetKeyword}" (${postType})`);
  const stepStart = Date.now();

  const { data: biz } = await supabase
    .from('blog_businesses').select('*').eq('slug', businessSlug).single();
  if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  // ── CLEANUP stale records for this slug BEFORE dedup ──
  const baseSlug = targetKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const { data: existingRecords } = await supabase.from('blog_generated_posts')
    .select('id, title, status').eq('business_id', biz.id).eq('slug', baseSlug);
  if (existingRecords?.length) {
    const live = existingRecords.filter(r => ['published', 'approved'].includes(r.status));
    if (live.length) {
      return NextResponse.json({
        success: false, blocked: true,
        error: `Slug "${baseSlug}" already published as "${live[0].title}".`,
      }, { status: 409 });
    }
    const deadIds = existingRecords.map(r => r.id);
    if (deadIds.length) {
      await supabase.from('blog_generation_logs').delete().in('post_id', deadIds);
      await supabase.from('blog_generated_posts').delete().in('id', deadIds);
      console.log(`[blog-farm] Cleaned ${deadIds.length} stale records for slug "${baseSlug}"`);
    }
  }

  // Dedup gate (now only catches real conflicts — published posts + blog_existing_posts)
  console.log(`[blog-farm] Running dedup check... (${Date.now() - stepStart}ms)`);
  const preCheck = await validateKeywordUniqueness(biz.id, targetKeyword, postType);
  console.log(`[blog-farm] Dedup done (${Date.now() - stepStart}ms)`);
  if (!preCheck.safe) {
    return NextResponse.json({
      success: false, blocked: true, stage: 'pre_generation',
      error: preCheck.reason, reason: preCheck.reason, conflicts: preCheck.conflicts,
    }, { status: 409 });
  }

  // Research — pass business context for multi-tenant prompts
  console.log(`[blog-farm] Starting web research... (${Date.now() - stepStart}ms)`);
  const startTime = Date.now();

  // Load brand kit for research context
  const { data: brandKit } = await supabase
    .from('blog_brand_kits').select('*').eq('business_id', biz.id).single();

  let research;
  try {
    research = await runResearch(targetKeyword, postType, biz, brandKit);
  } catch (err) {
    console.error(`[blog-farm] Research failed after ${Date.now() - startTime}ms:`, err.message);
    return NextResponse.json({ error: `Research failed: ${err.message}` }, { status: 500 });
  }
  console.log(`[blog-farm] Research complete (${Date.now() - stepStart}ms total)`);
  const duration = Date.now() - startTime;

  // Create post record (slug already cleaned up before dedup check)
  const { data: post, error } = await supabase
    .from('blog_generated_posts')
    .insert({
      business_id: biz.id,
      title: `[Generating] ${targetKeyword}`,
      slug: baseSlug,
      primary_keyword: targetKeyword,
      category: postType,
      html_content: '<p>Generating...</p>',
      status: 'pending',
      generation_prompt: JSON.stringify({ research, notes: notes || '', targetKeyword, postType }),
      word_count: 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: `DB insert failed: ${error.message}` }, { status: 500 });

  // Log research step
  await supabase.from('blog_generation_logs').insert({
    post_id: post.id, step: 'research', status: 'success',
    details: { target_keyword: targetKeyword, framework: research.recommended_framework,
      unique_angle: research.unique_angle, gaps_found: (research.content_gaps || []).length,
      verified_stats_count: (research.verified_statistics || []).length },
    duration_ms: duration,
  });

  return NextResponse.json({
    success: true, step: 1, postId: post.id,
    research: { framework: research.recommended_framework, angle: research.unique_angle,
      gaps: (research.content_gaps || []).length,
      verifiedStats: (research.verified_statistics || []).length },
  });
}

// ── STEP 2: Write Content ──

async function handleWrite(body, businessSlug) {
  const { postId } = body;
  if (!postId) return NextResponse.json({ error: 'postId is required' }, { status: 400 });

  try {
    // Load post and context
    const { data: post, error: postErr } = await supabase
      .from('blog_generated_posts').select('*').eq('id', postId).single();
    if (postErr || !post) return NextResponse.json({ error: `Post not found: ${postErr?.message}` }, { status: 404 });

    const { business: biz, brandKit, existingPosts, referencePosts } = await loadBusinessContext(businessSlug);

    let promptData;
    try {
      promptData = JSON.parse(post.generation_prompt);
    } catch (parseErr) {
      return NextResponse.json({
        error: `Failed to parse research data: ${parseErr.message}. Prompt length: ${(post.generation_prompt || '').length}`,
      }, { status: 500 });
    }
    const { research, notes, targetKeyword, postType } = promptData;

    // Write content — pass biz for publish_mode awareness
    const startTime = Date.now();
    const contentOutput = await writeContent(brandKit, existingPosts, research, postType, targetKeyword, notes, referencePosts, biz);
    const duration = Date.now() - startTime;

    if (!contentOutput || contentOutput.length < 100) {
      return NextResponse.json({ error: `Content generation returned empty or too short (${(contentOutput || '').length} chars)` }, { status: 500 });
    }

    // Save raw content to post (will be replaced with HTML in step 3)
    await supabase.from('blog_generated_posts').update({
      html_content: contentOutput,
      updated_at: new Date().toISOString(),
    }).eq('id', postId);

    // Log
    await supabase.from('blog_generation_logs').insert({
      post_id: postId, step: 'write_content', status: 'success',
      details: { model: 'claude-sonnet-4-20250514', content_length: contentOutput.length },
      duration_ms: duration,
    });

    return NextResponse.json({ success: true, step: 2, postId });
  } catch (err) {
    console.error(`[blog-farm] Step 2 error:`, err);
    return NextResponse.json({ error: `Write step failed: ${err.message}` }, { status: 500 });
  }
}

// ── STEP 3: HTML Template + Post-Dedup ──
// For static (CallBird): wraps in full HTML page, sanitizes, validates
// For nextjs (VoiceAI Connect): extracts metadata, stores raw article body, skips template

async function handleTemplate(body, businessSlug) {
  const { postId } = body;
  if (!postId) return NextResponse.json({ error: 'postId is required' }, { status: 400 });

  try {
    const { data: post, error: postErr } = await supabase
      .from('blog_generated_posts').select('*').eq('id', postId).single();
    if (postErr || !post) return NextResponse.json({ error: `Post not found: ${postErr?.message}` }, { status: 404 });

    const { data: biz } = await supabase
      .from('blog_businesses').select('*').eq('slug', businessSlug).single();
    if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const publishMode = biz.publish_mode || 'static';
    const startTime = Date.now();

    // ── LOAD EXISTING SLUGS (shared) ──
    const { data: allExisting } = await supabase.from('blog_existing_posts')
      .select('slug').eq('business_id', biz.id);
    const existingSlugs = (allExisting || []).map(p => p.slug);

    let metadata, html, wordCount;

    if (publishMode === 'nextjs') {
      // ── NEXTJS MODE: Extract metadata + raw article body ──
      // Step 2 output format: <metadata>{JSON}</metadata>\n<content>...article HTML...</content>
      const raw = post.html_content;

      // Extract metadata JSON
      const metaMatch = raw.match(/<metadata>\s*([\s\S]*?)\s*<\/metadata>/);
      if (metaMatch) {
        try {
          metadata = JSON.parse(metaMatch[1].replace(/```json\n?|```/g, '').trim());
        } catch {
          metadata = { title: post.title, slug: post.slug, meta_description: '', primary_keyword: post.primary_keyword };
        }
      } else {
        metadata = { title: post.title, slug: post.slug, meta_description: '', primary_keyword: post.primary_keyword };
      }

      // Extract article HTML (between <content> tags, or everything after </metadata>)
      const contentMatch = raw.match(/<content>\s*([\s\S]*?)\s*<\/content>/);
      if (contentMatch) {
        html = contentMatch[1].trim();
      } else {
        // Fallback: strip metadata block, use the rest
        html = raw.replace(/<metadata>[\s\S]*?<\/metadata>/, '').trim();
      }

      // Strip accidental full-page wrapper (<!DOCTYPE, <html>, <body>) — keep only article content
      html = html.replace(/<!DOCTYPE[^>]*>/gi, '')
        .replace(/<\/?html[^>]*>/gi, '')
        .replace(/<head>[\s\S]*?<\/head>/gi, '')
        .replace(/<\/?body[^>]*>/gi, '')
        .trim();

      // Fix internal link format: convert blog-{slug}.html → /blog/{slug} for nextjs
      html = html.replace(/href="blog-([^"]+)\.html"/gi, 'href="/blog/$1"');

      wordCount = html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => w.length > 0).length;

    } else {
      // ── STATIC MODE: Full HTML template wrapping (CallBird) ──
      const result = await wrapInTemplate(
        post.html_content, biz.domain, biz.phone, biz.gtm_id, biz.blog_file_prefix
      );
      metadata = result.metadata;
      const rawHtml = result.html;

      // Deterministic sanitization
      html = sanitizeGeneratedHtml(rawHtml, existingSlugs);
      wordCount = html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => w.length > 0).length;

      // Programmatic validation (CallBird-specific checks: GTM, phone, pricing)
      const validation = validatePost(html, metadata, existingSlugs);

      if (!validation.valid) {
        await supabase.from('blog_generated_posts').update({
          title: metadata.title,
          slug: metadata.slug,
          html_content: html,
          word_count: wordCount,
          status: 'revision_needed',
          qc_notes: JSON.stringify({ validation_errors: validation.errors, validation_warnings: validation.warnings }),
          updated_at: new Date().toISOString(),
        }).eq('id', postId);

        return NextResponse.json({
          success: true, step: 3, postId,
          validation: { valid: false, errors: validation.errors, warnings: validation.warnings, stats: validation.stats },
          post: { title: metadata.title, slug: metadata.slug, word_count: wordCount, status: 'revision_needed' },
        });
      }
    }

    const duration = Date.now() - startTime;

    // ── SHARED: Update post with metadata + content ──
    await supabase.from('blog_generated_posts').update({
      title: metadata.title,
      slug: metadata.slug,
      meta_description: metadata.meta_description,
      primary_keyword: metadata.primary_keyword,
      secondary_keywords: metadata.secondary_keywords || [],
      read_time: metadata.read_time,
      emoji: metadata.emoji,
      excerpt: metadata.excerpt,
      html_content: html,
      word_count: wordCount,
      updated_at: new Date().toISOString(),
    }).eq('id', postId);

    // ── SHARED: Track content attributes ──
    try {
      const { extractContentAttributes } = await import('@/lib/performance.js');
      const attrs = extractContentAttributes(html, metadata, null);
      attrs.post_id = postId;
      await supabase.from('blog_post_attributes').upsert(attrs, { onConflict: 'post_id' });
    } catch (attrErr) {
      console.warn('[blog-farm] Attribute tracking failed (non-blocking):', attrErr.message);
    }

    // ── SHARED: Post-generation dedup check ──
    const postCheck = await validatePostUniqueness(biz.id, metadata.title, metadata.primary_keyword, metadata.slug);
    if (!postCheck.unique) {
      await supabase.from('blog_generated_posts').update({
        status: 'revision_needed',
        qc_notes: JSON.stringify({ dedup_conflicts: postCheck.conflicts }),
      }).eq('id', postId);

      return NextResponse.json({
        success: true, step: 3, postId, dedup: { unique: false, recommendation: postCheck.recommendation },
        post: { title: metadata.title, slug: metadata.slug, word_count: wordCount },
      });
    }

    // Log
    await supabase.from('blog_generation_logs').insert({
      post_id: postId, step: 'html_template', status: 'success',
      details: { word_count: wordCount, publish_mode: publishMode,
        framework_used: metadata.framework_used, information_gain: metadata.information_gain },
      duration_ms: duration,
    });

    return NextResponse.json({
      success: true, step: 3, postId, dedup: { unique: true },
      post: { title: metadata.title, slug: metadata.slug, word_count: wordCount, status: 'pending' },
    });
  } catch (err) {
    console.error(`[blog-farm] Step 3 error:`, err);
    return NextResponse.json({ error: `Template step failed: ${err.message}` }, { status: 500 });
  }
}

// ── STEP 4: Quality Control ──

async function handleQC(body, businessSlug) {
  const { postId } = body;
  if (!postId) return NextResponse.json({ error: 'postId is required' }, { status: 400 });

  try {
    const { data: biz } = await supabase
      .from('blog_businesses').select('*').eq('slug', businessSlug).single();
    if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    const { data: brandKit } = await supabase
      .from('blog_brand_kits').select('*').eq('business_id', biz.id).single();
    if (!brandKit) return NextResponse.json({ error: 'Brand kit not found' }, { status: 404 });

    const qcResult = await runQualityControl(postId, biz, brandKit);

    // ── UPDATE CONTENT ATTRIBUTES with QC scores ──
    try {
      await supabase.from('blog_post_attributes').upsert({
        post_id: postId,
        qc_overall: qcResult.scores?.overall || null,
        qc_info_gain: qcResult.scores?.information_gain || null,
        qc_aeo: qcResult.scores?.aeo_readiness || null,
      }, { onConflict: 'post_id' });
    } catch { /* non-blocking */ }

    const { data: post } = await supabase
      .from('blog_generated_posts').select('title, slug, status, word_count').eq('id', postId).single();

    return NextResponse.json({
      success: true, step: 4, postId,
      post: { title: post.title, slug: post.slug, status: post.status, word_count: post.word_count },
      qc: {
        verdict: qcResult.verdict,
        scores: qcResult.scores,
        issues: qcResult.issues,
        suggestions: qcResult.suggestions,
        hallucination_flags: qcResult.hallucination_flags || [],
        business_protection_flags: qcResult.business_protection_flags || [],
      },
    });
  } catch (err) {
    console.error(`[blog-farm] Step 4 error:`, err);
    return NextResponse.json({ error: `QC step failed: ${err.message}` }, { status: 500 });
  }
}

// ── FULL PIPELINE: Research → Write → Template → QC in one call ──

async function handleFull(body, businessSlug) {
  const { targetKeyword, postType, notes } = body;
  if (!targetKeyword) return NextResponse.json({ error: 'targetKeyword is required' }, { status: 400 });
  if (!postType) return NextResponse.json({ error: 'postType is required' }, { status: 400 });

  const startTime = Date.now();
  const steps = [];

  try {
    // Load business
    const { data: biz } = await supabase
      .from('blog_businesses').select('*').eq('slug', businessSlug).single();
    if (!biz) return NextResponse.json({ error: `Business "${businessSlug}" not found` }, { status: 404 });

    const publishMode = biz.publish_mode || 'static';

    // ── CLEANUP stale records for this slug BEFORE dedup ──
    const baseSlug = targetKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').substring(0, 80);
    const { data: existingRecords } = await supabase.from('blog_generated_posts')
      .select('id, title, status').eq('business_id', biz.id).eq('slug', baseSlug);
    if (existingRecords?.length) {
      const live = existingRecords.filter(r => ['published', 'approved'].includes(r.status));
      if (live.length) {
        return NextResponse.json({
          success: false, blocked: true,
          error: `Slug "${baseSlug}" already published as "${live[0].title}".`,
        }, { status: 409 });
      }
      // Remove stale attempts (pending, failed, revision_needed, generating)
      const deadIds = existingRecords.map(r => r.id);
      if (deadIds.length) {
        await supabase.from('blog_generation_logs').delete().in('post_id', deadIds);
        await supabase.from('blog_generated_posts').delete().in('id', deadIds);
      }
    }

    // ── STEP 1: Dedup (checks blog_existing_posts + live generated posts) + Research ──
    const preCheck = await validateKeywordUniqueness(biz.id, targetKeyword, postType);
    if (!preCheck.safe) {
      return NextResponse.json({
        success: false, blocked: true, stage: 'pre_generation',
        error: preCheck.reason, conflicts: preCheck.conflicts,
      }, { status: 409 });
    }

    const { data: brandKit } = await supabase
      .from('blog_brand_kits').select('*').eq('business_id', biz.id).single();

    const research = await runResearch(targetKeyword, postType, biz, brandKit);
    steps.push({ step: 'research', status: 'success', verifiedStats: (research.verified_statistics || []).length, gaps: (research.content_gaps || []).length, elapsed: `${Date.now() - startTime}ms` });

    // Create post record
    const { data: post } = await supabase.from('blog_generated_posts').insert({
      business_id: biz.id, title: `[Generating] ${targetKeyword}`, slug: baseSlug,
      primary_keyword: targetKeyword, category: postType,
      html_content: '<p>Generating...</p>', status: 'pending',
      generation_prompt: JSON.stringify({ research, notes: notes || '', targetKeyword, postType }),
      word_count: 0,
    }).select().single();

    const postId = post.id;

    // ── STEP 2: Write ──
    const { business: bizCtx, brandKit: bk, existingPosts, referencePosts } = await loadBusinessContext(businessSlug);
    const contentOutput = await writeContent(bk, existingPosts, research, postType, targetKeyword, notes || '', referencePosts, bizCtx);

    if (!contentOutput || contentOutput.length < 100) {
      return NextResponse.json({ error: `Content too short (${(contentOutput || '').length} chars)` }, { status: 500 });
    }

    await supabase.from('blog_generated_posts').update({
      html_content: contentOutput, updated_at: new Date().toISOString(),
    }).eq('id', postId);

    steps.push({ step: 'write', status: 'success', contentLength: contentOutput.length, elapsed: `${Date.now() - startTime}ms` });

    // ── STEP 3: Template ──
    const { data: allExisting } = await supabase.from('blog_existing_posts').select('slug').eq('business_id', biz.id);
    const existingSlugs = (allExisting || []).map(p => p.slug);
    let metadata, html, wordCount;

    if (publishMode === 'nextjs') {
      const metaMatch = contentOutput.match(/<metadata>\s*([\s\S]*?)\s*<\/metadata>/);
      metadata = metaMatch ? (() => { try { return JSON.parse(metaMatch[1].replace(/```json\n?|```/g, '').trim()); } catch { return { title: targetKeyword, slug: baseSlug, meta_description: '', primary_keyword: targetKeyword }; } })()
        : { title: targetKeyword, slug: baseSlug, meta_description: '', primary_keyword: targetKeyword };

      const contentMatch = contentOutput.match(/<content>\s*([\s\S]*?)\s*<\/content>/);
      html = contentMatch ? contentMatch[1].trim() : contentOutput.replace(/<metadata>[\s\S]*?<\/metadata>/, '').trim();
      html = html.replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<\/?html[^>]*>/gi, '')
        .replace(/<head>[\s\S]*?<\/head>/gi, '').replace(/<\/?body[^>]*>/gi, '').trim();
      html = html.replace(/href="blog-([^"]+)\.html"/gi, 'href="/blog/$1"');
      wordCount = html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => w.length > 0).length;
    } else {
      const result = await wrapInTemplate(contentOutput, biz.domain, biz.phone, biz.gtm_id, biz.blog_file_prefix);
      metadata = result.metadata;
      html = sanitizeGeneratedHtml(result.html, existingSlugs);
      wordCount = html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => w.length > 0).length;

      const validation = validatePost(html, metadata, existingSlugs);
      if (!validation.valid) {
        await supabase.from('blog_generated_posts').update({
          title: metadata.title, slug: metadata.slug, html_content: html,
          word_count: wordCount, status: 'revision_needed',
          qc_notes: JSON.stringify({ validation_errors: validation.errors }),
          updated_at: new Date().toISOString(),
        }).eq('id', postId);
        return NextResponse.json({
          success: true, postId, steps,
          validation: { valid: false, errors: validation.errors },
          post: { title: metadata.title, slug: metadata.slug, word_count: wordCount, status: 'revision_needed' },
        });
      }
    }

    // Save template result
    await supabase.from('blog_generated_posts').update({
      title: metadata.title, slug: metadata.slug,
      meta_description: metadata.meta_description,
      primary_keyword: metadata.primary_keyword,
      secondary_keywords: metadata.secondary_keywords || [],
      read_time: metadata.read_time, emoji: metadata.emoji,
      excerpt: metadata.excerpt, html_content: html, word_count: wordCount,
      updated_at: new Date().toISOString(),
    }).eq('id', postId);

    // Post-dedup check
    const postCheck = await validatePostUniqueness(biz.id, metadata.title, metadata.primary_keyword, metadata.slug);
    if (!postCheck.unique) {
      await supabase.from('blog_generated_posts').update({
        status: 'revision_needed',
        qc_notes: JSON.stringify({ dedup_conflicts: postCheck.conflicts }),
      }).eq('id', postId);
      return NextResponse.json({
        success: true, postId, steps,
        dedup: { unique: false, recommendation: postCheck.recommendation },
        post: { title: metadata.title, slug: metadata.slug, word_count: wordCount },
      });
    }

    steps.push({ step: 'template', status: 'success', mode: publishMode, wordCount, elapsed: `${Date.now() - startTime}ms` });

    // ── STEP 4: QC ──
    const qcResult = await runQualityControl(postId, biz, bk);

    try {
      await supabase.from('blog_post_attributes').upsert({
        post_id: postId,
        qc_overall: qcResult.scores?.overall || null,
        qc_info_gain: qcResult.scores?.information_gain || null,
        qc_aeo: qcResult.scores?.aeo_readiness || null,
      }, { onConflict: 'post_id' });
    } catch { /* non-blocking */ }

    steps.push({ step: 'qc', status: 'success', verdict: qcResult.verdict, overall: qcResult.scores?.overall, elapsed: `${Date.now() - startTime}ms` });

    const { data: finalPost } = await supabase
      .from('blog_generated_posts').select('title, slug, status, word_count').eq('id', postId).single();

    return NextResponse.json({
      success: true, postId, steps,
      totalDuration: `${Date.now() - startTime}ms`,
      post: { title: finalPost.title, slug: finalPost.slug, status: finalPost.status, word_count: finalPost.word_count },
      qc: {
        verdict: qcResult.verdict, scores: qcResult.scores,
        issues: qcResult.issues, suggestions: qcResult.suggestions,
        hallucination_flags: qcResult.hallucination_flags || [],
        business_protection_flags: qcResult.business_protection_flags || [],
      },
    });
  } catch (err) {
    console.error(`[blog-farm] Full pipeline error:`, err);
    return NextResponse.json({ error: err.message, steps, elapsed: `${Date.now() - startTime}ms` }, { status: 500 });
  }
}