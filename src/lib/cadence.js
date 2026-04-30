import supabase from './supabase.js';

/**
 * Publishing cadence rules:
 * - Min 1 day between publishes (HARD BLOCK — prevents spam)
 * - Max 3 posts per week per business (HARD BLOCK — prevents over-publishing)
 * - Same-type consecutive posts logged as warning (SOFT — content strategist handles variety)
 * 
 * DESIGN DECISION: The consecutive-type rule was previously a hard block.
 * This created deadlocks: if the only post ready to publish was the same type
 * as the last 2, publishing stopped indefinitely. No amount of waiting fixes it.
 * The fix: content variety is the content strategist's job (topic selection),
 * not the publish gate's job. The publish gate only enforces timing.
 */

const MIN_DAYS_BETWEEN = 1;
const MAX_PER_WEEK = 3;

/**
 * Check if it's safe to publish right now based on cadence rules.
 * Returns { allowed, reason, suggestedDate, warnings }
 */
export async function checkPublishCadence(businessId, postCategory) {
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Get posts published in the last 7 days
  const { data: recentPosts } = await supabase
    .from('blog_generated_posts')
    .select('publish_date, category, created_at')
    .eq('business_id', businessId)
    .eq('status', 'published')
    .gte('publish_date', weekAgo.toISOString().split('T')[0])
    .order('publish_date', { ascending: false });

  const posts = recentPosts || [];
  const warnings = [];

  // Rule 1: Min days between publishes (HARD BLOCK)
  if (posts.length > 0) {
    const lastPublish = new Date(posts[0].publish_date);
    const daysSince = Math.floor((now - lastPublish) / (1000 * 60 * 60 * 24));
    if (daysSince < MIN_DAYS_BETWEEN) {
      const nextAvailable = new Date(lastPublish);
      nextAvailable.setDate(nextAvailable.getDate() + MIN_DAYS_BETWEEN + 1);
      return {
        allowed: false,
        reason: `Last post published ${daysSince} day(s) ago. Wait at least ${MIN_DAYS_BETWEEN} day(s). Next available: ${formatDate(nextAvailable)}`,
        suggestedDate: formatDate(nextAvailable),
        warnings,
      };
    }
  }

  // Rule 2: Max per week (HARD BLOCK)
  if (posts.length >= MAX_PER_WEEK) {
    const oldestThisWeek = new Date(posts[posts.length - 1].publish_date);
    const nextAvailable = new Date(oldestThisWeek);
    nextAvailable.setDate(nextAvailable.getDate() + 8);
    return {
      allowed: false,
      reason: `Already published ${posts.length} posts this week (max ${MAX_PER_WEEK}). Next available: ${formatDate(nextAvailable)}`,
      suggestedDate: formatDate(nextAvailable),
      warnings,
    };
  }

  // Rule 3: Consecutive same-type check (SOFT WARNING — does NOT block)
  if (posts.length >= 2) {
    const lastTypes = posts.slice(0, 2).map(p => p.category);
    const allSameType = lastTypes.every(t => t === postCategory);
    if (allSameType) {
      warnings.push(`Last 2 posts were "${postCategory}" type. Consider varying content types.`);
    }
  }

  return { allowed: true, reason: null, suggestedDate: formatDate(now), warnings };
}

/**
 * Calculate staggered publish dates for a batch of posts.
 * Distributes across Mon/Wed/Fri pattern, respecting cadence rules.
 */
export function calculateBatchDates(count, categories = [], startDate = null) {
  const publishDays = [1, 3, 5]; // Monday, Wednesday, Friday
  const dates = [];
  let current = startDate ? new Date(startDate) : new Date();
  
  current.setDate(current.getDate() + 1);

  let scheduled = 0;
  let weekCount = 0;
  const maxWeeks = Math.ceil(count / 3) + 2;

  while (scheduled < count && weekCount < maxWeeks) {
    for (const dayOfWeek of publishDays) {
      if (scheduled >= count) break;

      const target = new Date(current);
      const diff = (dayOfWeek - target.getDay() + 7) % 7;
      target.setDate(target.getDate() + (diff === 0 && scheduled > 0 ? 7 : diff));

      if (target <= new Date()) {
        target.setDate(target.getDate() + 7);
      }

      dates.push(formatDate(target));
      scheduled++;
    }
    weekCount++;
    current.setDate(current.getDate() + 7);
  }

  return dates;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}