import { NextResponse } from 'next/server';
import supabase from '@/lib/supabase.js';

/**
 * Scrapes the live sitemap.xml and populates blog_existing_posts
 * for any blog URLs not already in the database.
 * 
 * GET /api/seed-existing?business=callbird
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const businessSlug = searchParams.get('business') || 'callbird';

  const { data: biz } = await supabase
    .from('blog_businesses')
    .select('*')
    .eq('slug', businessSlug)
    .single();

  if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  // Fetch sitemap
  const sitemapUrl = `https://${biz.domain}/${biz.sitemap_path}`;
  const res = await fetch(sitemapUrl);
  if (!res.ok) return NextResponse.json({ error: `Failed to fetch sitemap: ${res.status}` }, { status: 500 });

  const xml = await res.text();

  // Extract blog URLs using regex (simple, no XML parser needed for this)
  const urlPattern = /<loc>(https?:\/\/[^<]*)<\/loc>/g;
  const blogPrefix = `https://${biz.domain}/${biz.blog_file_prefix}`;
  const blogUrls = [];
  let match;

  while ((match = urlPattern.exec(xml)) !== null) {
    const url = match[1];
    if (url.startsWith(blogPrefix) && url.endsWith('.html')) {
      // Extract slug from URL: blog-{slug}.html → slug
      const filename = url.split('/').pop(); // blog-some-slug.html
      const slug = filename
        .replace(biz.blog_file_prefix, '')
        .replace('.html', '');

      // Extract lastmod if available
      const locIndex = xml.indexOf(url);
      const lastmodMatch = xml.substring(locIndex, locIndex + 300).match(/<lastmod>([^<]+)<\/lastmod>/);
      const publishDate = lastmodMatch ? lastmodMatch[1] : null;

      // Generate title from slug
      const title = slug
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      blogUrls.push({ url, slug, title, publishDate });
    }
  }

  // Insert any that don't already exist
  let inserted = 0;
  let skipped = 0;

  for (const blog of blogUrls) {
    const { error } = await supabase
      .from('blog_existing_posts')
      .insert({
        business_id: biz.id,
        url: blog.url,
        title: blog.title,
        slug: blog.slug,
        publish_date: blog.publishDate,
        category: inferCategory(blog.slug),
      })
      .onConflict('business_id,slug')
      .ignore();

    if (error) {
      skipped++;
    } else {
      inserted++;
    }
  }

  return NextResponse.json({
    success: true,
    total_found: blogUrls.length,
    inserted,
    skipped,
    urls: blogUrls.map(b => b.url),
  });
}

function inferCategory(slug) {
  if (slug.includes('-vs-')) return 'comparison';
  if (slug.startsWith('best-ai-receptionist-')) return 'industry';
  if (slug.startsWith('how-to-') || slug.includes('guide')) return 'how-to';
  if (slug.includes('cost') || slug.includes('pricing')) return 'cost-analysis';
  if (slug.includes('statistics') || slug.includes('stats')) return 'statistics';
  if (slug.includes('about-')) return 'about';
  return 'guide';
}
