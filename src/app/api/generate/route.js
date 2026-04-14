import { NextResponse } from 'next/server';
import { generateBlogPost } from '@/lib/claude.js';
import { runQualityControl } from '@/lib/quality-control.js';
import supabase from '@/lib/supabase.js';

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

    // Step 1: Generate the post
    const post = await generateBlogPost(businessSlug, targetKeyword, postType, notes);

    // Step 2: Run quality control
    const { data: biz } = await supabase
      .from('blog_businesses')
      .select('*')
      .eq('slug', businessSlug)
      .single();
    const { data: brandKit } = await supabase
      .from('blog_brand_kits')
      .select('*')
      .eq('business_id', biz.id)
      .single();

    const qcResult = await runQualityControl(post.id, biz, brandKit);

    return NextResponse.json({
      success: true,
      post: {
        id: post.id,
        title: post.title,
        slug: post.slug,
        status: post.status,
        word_count: post.word_count,
      },
      qc: {
        verdict: qcResult.verdict,
        scores: qcResult.scores,
        issues: qcResult.issues,
        suggestions: qcResult.suggestions,
      },
    });
  } catch (err) {
    console.error('Generation error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
