import { NextResponse } from 'next/server';
import { publishPost } from '@/lib/publish.js';

export async function POST(request) {
  try {
    const body = await request.json();
    const { postId } = body;

    if (!postId) {
      return NextResponse.json({ error: 'postId is required' }, { status: 400 });
    }

    const result = await publishPost(postId);

    return NextResponse.json({
      success: true,
      message: 'Post published successfully',
      ...result,
    });
  } catch (err) {
    console.error('Publish error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
