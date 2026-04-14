import { NextResponse } from 'next/server';
import supabase from '@/lib/supabase.js';

export async function POST(request) {
  const { postId } = await request.json();
  if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 });

  const { error } = await supabase
    .from('blog_generated_posts')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', postId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
