import { NextResponse } from 'next/server';
import { generateBlogPost } from '@/lib/claude.js';
import { runQualityControl } from '@/lib/quality-control.js';
import { validateKeywordUniqueness, validatePostUniqueness } from '@/lib/dedup-validator.js';
import supabase from '@/lib/supabase.js';

// 3-phase generation + dedup + QC can take ~4 minutes
export const maxDuration = 300;

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function POST(request) {
  try {
    const body = await request.json();
    const { businessSlug = 'callbird', targetKeyword, postType, notes } = body;

    if (!targetKeyword) {
      return NextResponse.json({ error: 'targetKeyword is required' }, { status: 400 });
    }
    if (!postType) {
      return NextResponse.json({ error: 'postType is required' }, { status: 400 });
    }

    // Load business
    const { data: biz } = await supabase
      .from('blog_businesses')
      .select('*')
      .eq('slug', businessSlug)
      .single();

    if (!biz) {
      return NextResponse.json({ error: `Business "${businessSlug}" not found` }, { status: 404 });
    }

    // ── GATE 1: Pre-generation keyword uniqueness ──
    // Catches duplicates BEFORE spending Claude tokens
    const preCheck = await validateKeywordUniqueness(biz.id, targetKeyword, postType);

    if (!preCheck.safe) {
      return NextResponse.json({
        success: false,
        blocked: true,
        stage: 'pre_generation',
        error: preCheck.reason,
        reason: preCheck.reason,
        conflicts: preCheck.conflicts,
      }, { status: 409 });
    }

    // ── Step 1: Generate the post ──
    const post = await generateBlogPost(businessSlug, targetKeyword, postType, notes);

    // ── GATE 2: Post-generation similarity check ──
    // Catches drift into existing territory despite prompt instructions
    const postCheck = await validatePostUniqueness(biz.id, post.title, post.primary_keyword, post.slug);

    if (!postCheck.unique) {
      await supabase.from('blog_generated_posts').update({
        status: 'revision_needed',
        qc_notes: JSON.stringify({ dedup_conflicts: postCheck.conflicts, recommendation: postCheck.recommendation }),
      }).eq('id', post.id);

      return NextResponse.json({
        success: true,
        post: { id: post.id, title: post.title, slug: post.slug, status: 'revision_needed', word_count: post.word_count },
        dedup: { unique: false, recommendation: postCheck.recommendation, conflicts: postCheck.conflicts },
        qc: null,
      });
    }

    // ── Step 2: Run quality control ──
    // Wait for rate limit window after generation's 3 API calls
    await delay(65000);

    const { data: brandKit } = await supabase
      .from('blog_brand_kits')
      .select('*')
      .eq('business_id', biz.id)
      .single();

    const qcResult = await runQualityControl(post.id, biz, brandKit);

    return NextResponse.json({
      success: true,
      post: { id: post.id, title: post.title, slug: post.slug, status: post.status, word_count: post.word_count },
      dedup: { unique: true, conflicts: [] },
      qc: { verdict: qcResult.verdict, scores: qcResult.scores, issues: qcResult.issues, suggestions: qcResult.suggestions },
    });
  } catch (err) {
    console.error('Generation error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}