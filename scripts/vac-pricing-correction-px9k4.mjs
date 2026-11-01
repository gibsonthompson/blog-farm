// vac-pricing-correction-px9k4.mjs
//
// Corrects fabricated VoiceAI Connect pricing in published blog-farm posts.
//
// The farm's old pricing_info was vague, so ~61 published VAC posts invented a
// fake pricing MODEL: a "Starter" tier at "$199/month flat, up to 25 clients"
// (plus "Professional $299"). None of that exists. This script rewrites ONLY
// VoiceAI Connect's own platform-pricing claims to the real Free/Pro/Scale
// model, recomputes any profit/margin examples that were built on the fake
// numbers, and leaves every other figure (client resale prices, SMMA costs,
// salaries, competitor prices) untouched. It uses Claude per post because the
// fix is contextual, not a find-replace.
//
// SAFE BY DEFAULT: dry-run. It writes before/after HTML + a summary to
// ./pricing-fix-review/ and changes NOTHING in the database. Review the diffs,
// then re-run with --apply to write the corrections back.
//
// Place in the blog-farm repo (scripts/) and run from the repo root so it can
// read .env.local:
//   node scripts/vac-pricing-correction-px9k4.mjs            # dry-run (review)
//   node scripts/vac-pricing-correction-px9k4.mjs --apply    # write to DB
//   node scripts/vac-pricing-correction-px9k4.mjs --slug some-post-slug
//   node scripts/vac-pricing-correction-px9k4.mjs --limit 5
//
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// ANTHROPIC_API_KEY. (Node older than 20.6 ignores --env-file, so this parses
// .env.local itself.)

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- .env.local loader (finds the file next to the script OR in the folder
// you run from, so the terminal's current directory does not matter) ---------
function loadEnvLocal() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const bases = [process.cwd(), scriptDir, path.join(scriptDir, '..'), path.join(process.cwd(), '..')];
  const candidates = [...new Set(bases.map(b => path.resolve(b, '.env.local')))];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) {
    console.error('Could not find .env.local. Looked in:');
    candidates.forEach(p => console.error('  ' + p));
    console.error('Put .env.local in your blog-farm repo root (next to package.json).');
    return;
  }
  console.log('Loaded env from: ' + found);
  for (const line of fs.readFileSync(found, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY } = process.env;
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
  console.error('Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY in .env.local');
  process.exit(1);
}

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY_SLUG = (args.find(a => a.startsWith('--slug')) || '').split('=')[1]
  || (args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null);
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) : Infinity;
})();

const MODEL = 'claude-sonnet-4-6'; // the farm's working model string
const BUSINESS_SLUG = 'voiceai-connect';
const REVIEW_DIR = path.resolve(process.cwd(), 'pricing-fix-review');

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---- ground truth ----------------------------------------------------------
const GROUND_TRUTH = `
VoiceAI Connect is a white-label AI receptionist platform that agencies resell to local businesses.
Its plans are named EXACTLY: Free, Pro, Scale. There is NO Starter, Professional, or Enterprise plan.
There is NO flat "$199/month" plan and NO "up to 25 clients" cap (no plan caps the number of clients).

Real pricing (platform fees the agency pays VoiceAI Connect):
- Free: $0/month platform fee, plus $29.99 per client per month, plus $0.12 per minute. No white-label branding, no marketing site.
- Pro: $99/month platform fee (14-day free trial, card required), plus $9.99 per client per month, plus $0.10 per minute. Adds full white-label branding, custom domain, and a marketing site.
- Scale: $499/month platform fee, $0 per client, plus $0.05 per minute. Lowest per-minute rate, no per-client fee.

The agency sets its OWN resale price to its clients and keeps the margin. Those resale prices are the agency's choice and are NOT VoiceAI Connect's pricing.
`.trim();

const SYSTEM_PROMPT = `You correct fabricated VoiceAI Connect pricing inside a published HTML blog post.

${GROUND_TRUTH}

TASK: Return the FULL post HTML with ONLY the VoiceAI Connect platform-pricing claims corrected to the real model above.

RULES:
- Replace the fabricated VoiceAI Connect pricing (e.g. "Starter $199/month flat", "up to 25 clients", "Professional $299", "$199/month platform fee") with the real Free/Pro/Scale model. Prefer naming the actual plan that fits the sentence; if the post needs a single representative number, use the Pro plan ($99/month) and make clear there is also a Free tier and a $499 Scale tier.
- If a profit or margin EXAMPLE was built on the fake platform cost (e.g. "25 clients, platform costs $199, profit $3,526"), RECOMPUTE it correctly with the real model (platform fee + per-client fee + per-minute where relevant). Keep the arithmetic correct and the example realistic. On Pro at 25 clients the platform cost is $99 + 25 x $9.99 = $348.75/month before per-minute usage; on Scale it is $499/month flat with no per-client fee.
- DO NOT change any number that is not VoiceAI Connect's own platform pricing. Leave client resale prices (what the agency charges its clients), SMMA costs, salaries, ad spend, competitor prices, and every unrelated figure EXACTLY as they are.
- Preserve ALL HTML: tags, attributes, links (including href="/platform" and other internal links), headings, tables, and ordering. Change only the text of the wrong pricing claims and any example math that depended on them.
- Do not add, remove, or reorder sections. Do not add commentary or code fences.

Output: the corrected post HTML only, nothing else.`;

// ---- guards ----------------------------------------------------------------
// Flags (does not auto-apply) if the model left a VAC-tier fabrication or changed length too much.
function fabricationRemains(html) {
  const low = html.toLowerCase();
  if (/\bstarter (plan|tier)\b/.test(low) && low.includes('voiceai')) return 'starter tier';
  if (/\bprofessional (plan|tier)\b/.test(low) && low.includes('voiceai')) return 'professional tier';
  if (/up to 25 clients/.test(low)) return '"up to 25 clients" cap';
  // "$199" within ~40 chars of a VoiceAI/platform-fee mention
  if (/(voiceai connect|platform (fee|cost|costs|runs|starts))[^.<]{0,40}\$199/.test(low)) return '$199 platform claim';
  if (/\$199[^.<]{0,40}(platform|voiceai|per month for up to 25|\/mo flat)/.test(low)) return '$199 platform claim';
  return null;
}

async function correctOne(html) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `Here is the post HTML to correct:\n\n${html}` }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      let out = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      // strip accidental code fences
      out = out.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();
      return out;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

// ---- main ------------------------------------------------------------------
async function main() {
  fs.mkdirSync(REVIEW_DIR, { recursive: true });

  const { data: biz, error: bizErr } = await supabase
    .from('blog_businesses').select('id').eq('slug', BUSINESS_SLUG).single();
  if (bizErr || !biz) { console.error('Could not find business', BUSINESS_SLUG, bizErr); process.exit(1); }

  let q = supabase
    .from('blog_generated_posts')
    .select('id, slug, html_content')
    .eq('business_id', biz.id)
    .eq('status', 'published');
  if (ONLY_SLUG) q = q.eq('slug', ONLY_SLUG);

  const { data: posts, error } = await q;
  if (error) { console.error('Query failed', error); process.exit(1); }

  // only posts that actually carry a fabrication marker
  const markerRe = /\$199|\bstarter plan\b|\bprofessional plan\b|\benterprise plan\b|up to 25 clients/i;
  const targets = (posts || []).filter(p => p.html_content && markerRe.test(p.html_content)).slice(0, LIMIT);

  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} | business=${BUSINESS_SLUG} | candidate posts: ${targets.length}`);
  const summary = [];

  for (const [i, post] of targets.entries()) {
    process.stdout.write(`[${i + 1}/${targets.length}] ${post.slug} ... `);
    let corrected;
    try {
      corrected = await correctOne(post.html_content);
    } catch (e) {
      console.log('API FAILED:', e.message);
      summary.push({ slug: post.slug, status: 'api_failed', error: e.message });
      continue;
    }

    const before = post.html_content;
    const changed = corrected && corrected !== before;
    const lenRatio = corrected ? corrected.length / before.length : 0;
    const leftover = corrected ? fabricationRemains(corrected) : 'empty output';
    const lengthOff = lenRatio < 0.8 || lenRatio > 1.3;
    const needsReview = !!leftover || lengthOff || !changed;

    // always write the before/after for human review
    fs.writeFileSync(path.join(REVIEW_DIR, `${post.slug}.before.html`), before);
    if (corrected) fs.writeFileSync(path.join(REVIEW_DIR, `${post.slug}.after.html`), corrected);

    let status;
    if (!changed) {
      status = 'no_change';
    } else if (needsReview) {
      status = `flagged(${leftover || (lengthOff ? 'length ' + lenRatio.toFixed(2) : 'review')})`;
    } else if (APPLY) {
      const { error: upErr } = await supabase
        .from('blog_generated_posts')
        .update({ html_content: corrected, updated_at: new Date().toISOString() })
        .eq('id', post.id);
      status = upErr ? `db_error(${upErr.message})` : 'applied';
    } else {
      status = 'ready (dry-run)';
    }

    console.log(status);
    summary.push({ slug: post.slug, status, lenRatio: Number(lenRatio.toFixed(3)) });
  }

  fs.writeFileSync(path.join(REVIEW_DIR, '_summary.json'), JSON.stringify(summary, null, 2));
  const counts = summary.reduce((a, s) => { const k = s.status.split('(')[0]; a[k] = (a[k] || 0) + 1; return a; }, {});
  console.log('\nDone. Review files in ./pricing-fix-review/  (_summary.json for the list)');
  console.log('Status counts:', counts);
  if (!APPLY) console.log('\nThis was a DRY-RUN. Nothing was written to the database. Re-run with --apply once the diffs look right.');
  console.log('Note: "flagged" posts were NOT written even with --apply; open their .after.html and fix by hand or re-run --slug <slug>.');
}

main().catch(e => { console.error(e); process.exit(1); });
