import supabase from './supabase.js';

/**
 * Publishing cadence rules:
 * - Max 3 posts per week per business
 * - Min 1 day between publishes
 * - No more than 2 posts of the same type in a row
 * - Auto-suggest next available publish date
 */

const MIN_DAYS_BETWEEN = 1;
const MAX_SAME_TYPE_CONSECUTIVE = 2;

/**
 * Check if it's safe to publish right now based on cadence rules.
 * Returns { allowed, reason, suggestedDate }
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

  // Rule 1: Min days between publishes
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
      };
    }
  }

  // Rule 2: Consecutive same-type check
  if (posts.length >= MAX_SAME_TYPE_CONSECUTIVE) {
    const lastTypes = posts.slice(0, MAX_SAME_TYPE_CONSECUTIVE).map(p => p.category);
    const allSameType = lastTypes.every(t => t === postCategory);
    if (allSameType) {
      return {
        allowed: false,
        reason: `Last ${MAX_SAME_TYPE_CONSECUTIVE} posts were all "${postCategory}" type. Publish a different post type first to maintain variety.`,
        suggestedDate: formatDate(now),
      };
    }
  }

  return { allowed: true, reason: null, suggestedDate: formatDate(now) };
}

/**
 * Calculate staggered publish dates for a batch of posts.
 * Distributes across Mon/Wed/Fri pattern, respecting cadence rules.
 * 
 * @param {number} count - Number of posts to schedule
 * @param {string[]} categories - Post types in order
 * @returns {Date[]} Array of suggested publish dates
 */
export function calculateBatchDates(count, categories = [], startDate = null) {
  const publishDays = [1, 3, 5]; // Monday, Wednesday, Friday
  const dates = [];
  let current = startDate ? new Date(startDate) : new Date();
  
  // Start from tomorrow at minimum
  current.setDate(current.getDate() + 1);

  let scheduled = 0;
  let weekCount = 0;
  const maxWeeks = Math.ceil(count / 3) + 2; // Safety limit

  while (scheduled < count && weekCount < maxWeeks) {
    for (const dayOfWeek of publishDays) {
      if (scheduled >= count) break;

      // Find next occurrence of this day of week
      const target = new Date(current);
      const diff = (dayOfWeek - target.getDay() + 7) % 7;
      target.setDate(target.getDate() + (diff === 0 && scheduled > 0 ? 7 : diff));

      // Don't schedule in the past
      if (target <= new Date()) {
        target.setDate(target.getDate() + 7);
      }

      // Vary types — skip if same type as last 2
      if (categories.length > 0 && scheduled >= MAX_SAME_TYPE_CONSECUTIVE) {
        const lastTypes = categories.slice(scheduled - MAX_SAME_TYPE_CONSECUTIVE, scheduled);
        if (lastTypes.every(t => t === categories[scheduled])) {
          // Swap with next post of different type if possible
          for (let j = scheduled + 1; j < categories.length; j++) {
            if (categories[j] !== categories[scheduled]) {
              [categories[scheduled], categories[j]] = [categories[j], categories[scheduled]];
              break;
            }
          }
        }
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