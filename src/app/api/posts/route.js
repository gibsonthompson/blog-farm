import { NextResponse } from 'next/server';
import supabase from '@/lib/supabase.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const businessSlug = searchParams.get('business') || 'callbird';
  const status = searchParams.get('status'); // optional filter

  const { data: biz } = await supabase
    .from('blog_businesses')
    .select('id')
    .eq('slug', businessSlug)
    .single();

  if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  let query = supabase
    .from('blog_generated_posts')
    .select('id, title, slug, primary_keyword, category, status, qc_score, qc_notes, qc_passed, created_at, publish_date, word_count, emoji, read_time')
    .eq('business_id', biz.id)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data: posts, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ posts });
}