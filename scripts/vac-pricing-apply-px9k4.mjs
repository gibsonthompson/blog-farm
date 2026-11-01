// vac-pricing-apply-px9k4.mjs
//
// Writes the corrections the DRY-RUN already generated (in ./pricing-fix-review/)
// straight to the database. NO model calls, so it is instant and costs nothing
// on your API bill. Run this AFTER the dry-run finishes and you have eyeballed a
// few diffs.
//
//   node scripts/vac-pricing-apply-px9k4.mjs                   # apply the clean "ready" posts
//   node scripts/vac-pricing-apply-px9k4.mjs --include-flagged # also apply the flagged ones
//
// It reads pricing-fix-review/_summary.json (written by the dry-run) and, for
// each post marked ready, writes pricing-fix-review/<slug>.after.html to the DB.
// It re-checks each one for leftover fabrication before writing, and skips the
// posts we 301-redirected (correcting those is pointless, they do not render).

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- .env.local loader (same as the corrector) -----------------------------
function loadEnvLocal() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const bases = [process.cwd(), scriptDir, path.join(scriptDir, '..'), path.join(process.cwd(), '..')];
  const candidates = [...new Set(bases.map(b => path.resolve(b, '.env.local')))];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) {
    console.error('Could not find .env.local. Looked in:');
    candidates.forEach(p => console.error('  ' + p));
    return;
  }
  console.log('Loaded env from: ' + found);
  for (const line of fs.readFileSync(found, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env. Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const INCLUDE_FLAGGED = process.argv.includes('--include-flagged');
const BUSINESS_SLUG = 'voiceai-connect';

// Posts we 301-redirected in next.config.ts. They do not render, so there is no
// point writing corrected content to them. Kept in sync with the redirect block.
const REDIRECTED = new Set([
  'white-label-ai-receptionist-platform',
  'white-label-ai-voice-agent-platform-agencies',
  'best-white-label-ai-receptionist-platforms-ranked',
  'how-to-choose-white-label-ai-receptionist-platform',
  'white-label-vs-build-ai-receptionist',
  'what-is-ai-receptionist-how-it-works',
  'how-to-start-ai-receptionist-agency',
  'start-ai-receptionist-agency-from-india',
  'voiceai-connect-vs-synthflow',
  'ai-receptionist-agency-pricing-tiers',
  'ai-agency-profit-margins-2026',
]);

function findReviewDir() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const bases = [process.cwd(), scriptDir, path.join(scriptDir, '..'), path.join(process.cwd(), '..')];
  for (const b of bases) {
    const d = path.resolve(b, 'pricing-fix-review');
    if (fs.existsSync(path.join(d, '_summary.json'))) return d;
  }
  return null;
}

// same guard the corrector used
function fabricationRemains(html) {
  const low = html.toLowerCase();
  if (/\bstarter (plan|tier)\b/.test(low) && low.includes('voiceai')) return 'starter tier';
  if (/\bprofessional (plan|tier)\b/.test(low) && low.includes('voiceai')) return 'professional tier';
  if (/up to 25 clients/.test(low)) return '"up to 25 clients" cap';
  if (/(voiceai connect|platform (fee|cost|costs|runs|starts))[^.<]{0,40}\$199/.test(low)) return '$199 platform claim';
  if (/\$199[^.<]{0,40}(platform|voiceai|per month for up to 25|\/mo flat)/.test(low)) return '$199 platform claim';
  return null;
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  const dir = findReviewDir();
  if (!dir) {
    console.error('No pricing-fix-review/_summary.json found. Run the dry-run first.');
    process.exit(1);
  }
  console.log('Using review dir: ' + dir);

  const { data: biz, error: bizErr } = await supabase
    .from('blog_businesses').select('id').eq('slug', BUSINESS_SLUG).single();
  if (bizErr || !biz) { console.error('Could not find business', BUSINESS_SLUG, bizErr); process.exit(1); }

  const summary = JSON.parse(fs.readFileSync(path.join(dir, '_summary.json'), 'utf8'));
  let applied = 0, skipped = 0, failed = 0;

  for (const row of summary) {
    const ready = row.status === 'ready (dry-run)' || row.status === 'applied';
    const flagged = row.status.startsWith('flagged');
    if (!ready && !(INCLUDE_FLAGGED && flagged)) { skipped++; continue; }

    if (REDIRECTED.has(row.slug)) { console.log('skip (redirected): ' + row.slug); skipped++; continue; }

    const afterPath = path.join(dir, row.slug + '.after.html');
    if (!fs.existsSync(afterPath)) { console.log('skip (no after file): ' + row.slug); skipped++; continue; }

    const html = fs.readFileSync(afterPath, 'utf8');
    const leftover = fabricationRemains(html);
    if (leftover && !INCLUDE_FLAGGED) { console.log(`skip (still has ${leftover}): ` + row.slug); skipped++; continue; }

    const { error } = await supabase
      .from('blog_generated_posts')
      .update({ html_content: html, updated_at: new Date().toISOString() })
      .eq('business_id', biz.id)
      .eq('slug', row.slug);

    if (error) { console.log('DB ERROR ' + row.slug + ': ' + error.message); failed++; }
    else { console.log('applied: ' + row.slug); applied++; }
  }

  console.log(`\nDone. applied=${applied} skipped=${skipped} failed=${failed}`);
  if (skipped) console.log('Flagged/redirected posts were skipped. Review their .after.html, then re-run with --include-flagged to write the flagged ones too.');
}

main().catch(e => { console.error(e); process.exit(1); });
