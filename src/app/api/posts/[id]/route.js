import { NextResponse } from 'next/server';
import supabase from '@/lib/supabase.js';

export async function GET(request, { params }) {
  const { id } = params;

  const { data: post, error } = await supabase
    .from('blog_generated_posts')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  return NextResponse.json(post);
}
