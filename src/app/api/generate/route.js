import { NextResponse } from 'next/server';
import { runResearch, writeContent, wrapInTemplate, loadBusinessContext } from '@/lib/claude.js';
import { runQualityControl } from '@/lib/quality-control.js';
import { validateKeywordUniqueness, validatePostUniqueness } from '@/lib/dedup-validator.js';
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
  try {
    const body = await request.json();
    const { action = 'research', businessSlug = 'callbird' } = body;

    switch (action) {
      case 'research': return handleResearch(body, businessSlug);
      case 'write': return handleWrite(body, businessSlug);
      case 'template': return handleTemplate(body, businessSlug);
      case 'qc': return handleQC(body, businessSlug);
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

  // Dedup gate
  console.log(`[blog-farm] Running dedup check... (${Date.now() - stepStart}ms)`);
  const preCheck = await validateKeywordUniqueness(biz.id, targetKeyword, postType);
  console.log(`[blog-farm] Dedup done (${Date.now() - stepStart}ms)`);
  if (!preCheck.safe) {
    return NextResponse.json({
      success: false, blocked: true, stage: 'pre_generation',
      error: preCheck.reason, reason: preCheck.reason, conflicts: preCheck.conflicts,
    }, { status: 409 });
  }

  // Research
  console.log(`[blog-farm] Starting web research... (${Date.now() - stepStart}ms)`);
  const startTime = Date.now();
  let research;
  try {
    research = await runResearch(targetKeyword, postType);
  } catch (err) {
    console.error(`[blog-farm] Research failed after ${Date.now() - startTime}ms:`, err.message);
    return NextResponse.json({ error: `Research failed: ${err.message}` }, { status: 500 });
  }
  console.log(`[blog-farm] Research complete (${Date.now() - stepStart}ms total)`);
  const duration = Date.now() - startTime;

  // Create post record with research saved
  let baseSlug = targetKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // Check for existing records with this slug
  const { data: existingRecords } = await supabase.from('blog_generated_posts')
    .select('id, title, status').eq('business_id', biz.id).eq('slug', baseSlug);

  if (existingRecords?.length) {
    // Clean up failed [Generating] records
    const stale = existingRecords.filter(r => r.title.includes('[Generating]'));
    if (stale.length) {
      const staleIds = stale.map(r => r.id);
      await supabase.from('blog_generation_logs').delete().in('post_id', staleIds);
      await supabase.from('blog_generated_posts').delete().in('id', staleIds);
    }
    // Block if a real (non-stale) post exists with this slug
    const real = existingRecords.filter(r => !r.title.includes('[Generating]'));
    if (real.length) {
      return NextResponse.json({
        error: `A post with slug "${baseSlug}" already exists: "${real[0].title}" (${real[0].status}). Use a different keyword angle.`,
      }, { status: 409 });
    }
  }

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
      unique_angle: research.unique_angle, gaps_found: (research.content_gaps || []).length },
    duration_ms: duration,
  });

  return NextResponse.json({
    success: true, step: 1, postId: post.id,
    research: { framework: research.recommended_framework, angle: research.unique_angle,
      gaps: (research.content_gaps || []).length, dataPoints: (research.fresh_data_points || []).length },
  });
}

// ── STEP 2: Write Content ──

async function handleWrite(body, businessSlug) {
  const { postId } = body;
  if (!postId) return NextResponse.json({ error: 'postId is required' }, { status: 400 });

  // Load post and context
  const { data: post } = await supabase
    .from('blog_generated_posts').select('*').eq('id', postId).single();
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });

  const { brandKit, existingPosts } = await loadBusinessContext(businessSlug);
  const promptData = JSON.parse(post.generation_prompt);
  const { research, notes, targetKeyword, postType } = promptData;

  // Write content
  const startTime = Date.now();
  const contentOutput = await writeContent(brandKit, existingPosts, research, postType, targetKeyword, notes);
  const duration = Date.now() - startTime;

  // Save raw content to post (will be replaced with HTML in step 3)
  await supabase.from('blog_generated_posts').update({
    html_content: contentOutput,
    updated_at: new Date().toISOString(),
  }).eq('id', postId);

  // Log
  await supabase.from('blog_generation_logs').insert({
    post_id: postId, step: 'write_content', status: 'success',
    details: { model: 'claude-sonnet-4-20250514' },
    duration_ms: duration,
  });

  return NextResponse.json({ success: true, step: 2, postId });
}

// ── STEP 3: HTML Template + Post-Dedup ──

async function handleTemplate(body, businessSlug) {
  const { postId } = body;
  if (!postId) return NextResponse.json({ error: 'postId is required' }, { status: 400 });

  const { data: post } = await supabase
    .from('blog_generated_posts').select('*').eq('id', postId).single();
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });

  const { data: biz } = await supabase
    .from('blog_businesses').select('*').eq('slug', businessSlug).single();

  // Wrap content in HTML template
  const startTime = Date.now();
  const { metadata, html } = await wrapInTemplate(
    post.html_content, biz.domain, biz.phone, biz.gtm_id, biz.blog_file_prefix
  );
  const duration = Date.now() - startTime;

  const wordCount = html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => w.length > 0).length;

  // Update post with final data
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

  // Post-generation dedup check
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
    details: { word_count: wordCount, framework_used: metadata.framework_used,
      information_gain: metadata.information_gain },
    duration_ms: duration,
  });

  return NextResponse.json({
    success: true, step: 3, postId, dedup: { unique: true },
    post: { title: metadata.title, slug: metadata.slug, word_count: wordCount, status: 'pending' },
  });
}

// ── STEP 4: Quality Control ──

async function handleQC(body, businessSlug) {
  const { postId } = body;
  if (!postId) return NextResponse.json({ error: 'postId is required' }, { status: 400 });

  const { data: biz } = await supabase
    .from('blog_businesses').select('*').eq('slug', businessSlug).single();
  const { data: brandKit } = await supabase
    .from('blog_brand_kits').select('*').eq('business_id', biz.id).single();

  const qcResult = await runQualityControl(postId, biz, brandKit);

  // Reload post for final state
  const { data: post } = await supabase
    .from('blog_generated_posts').select('title, slug, status, word_count').eq('id', postId).single();

  return NextResponse.json({
    success: true, step: 4, postId,
    post: { title: post.title, slug: post.slug, status: post.status, word_count: post.word_count },
    qc: { verdict: qcResult.verdict, scores: qcResult.scores, issues: qcResult.issues, suggestions: qcResult.suggestions },
  });
}