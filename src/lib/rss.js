import supabase from './supabase.js';

/**
 * Generate an RSS 2.0 feed from blog_existing_posts.
 * 
 * Lightweight — reads from DB only, no GitHub API calls.
 * Fast enough to run inside the publish pipeline commit.
 * 
 * AI crawlers (Perplexity, ChatGPT, ClaudeBot) poll this every 1-6 hours.
 * The feed provides discovery — crawlers follow the link for full content.
 */
export async function generateRssFeed(businessId) {
  const { data: biz } = await supabase
    .from('blog_businesses').select('*').eq('id', businessId).single();
  if (!biz) throw new Error('Business not found');

  const { data: posts } = await supabase
    .from('blog_existing_posts')
    .select('title, slug, meta_description, publish_date, category')
    .eq('business_id', businessId)
    .order('publish_date', { ascending: false });

  if (!posts || posts.length === 0) return null;

  const domain = biz.domain;
  const siteUrl = `https://${domain}`;
  const prefix = biz.blog_file_prefix || 'blog-';
  const now = new Date().toUTCString();

  const items = posts.map(post => {
    const postUrl = `${siteUrl}/${prefix}${post.slug}`;
    const pubDate = post.publish_date
      ? new Date(post.publish_date).toUTCString()
      : now;
    const desc = escapeXml(post.meta_description || post.title);

    return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${postUrl}</link>
      <guid isPermaLink="true">${postUrl}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${desc}</description>
      <author>gibson@callbirdai.com (Gibson Thompson)</author>${post.category ? `
      <category>${escapeXml(post.category)}</category>` : ''}
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>CallBird AI Blog</title>
    <link>${siteUrl}/blog</link>
    <description>Expert guides, industry insights, and everything about AI receptionists for small businesses.</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml"/>
    <image>
      <url>https://i.imgur.com/qwyQQW5.png</url>
      <title>CallBird AI Blog</title>
      <link>${siteUrl}</link>
    </image>
${items}
  </channel>
</rss>`;
}

function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}