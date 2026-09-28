#!/usr/bin/env node
/**
 * PRICING CORRECTION  --  surgical, per-post, LLM-assisted.
 *
 * Corrects ONLY VoiceAI Connect's own platform pricing (and the profit/margin/
 * breakeven math that depends on it) to the real model. Leaves the agency's
 * resale pricing, competitor pricing, and all non-pricing content untouched.
 * This is NOT regeneration: the post's research, angle, structure, headings, and
 * links are preserved. Every correction is validated by the deterministic gate
 * and structural-preservation checks, and written for review before apply.
 *
 * REAL PRICING (never changes):
 *   Free:  $0/mo   + $29.99/client/mo + $0.12/min  (no white-label, no marketing site)
 *   Pro:   $99/mo  + $9.99/client/mo  + $0.10/min  (white-label, custom domain, up to 3 team)
 *   Scale: $499/mo + $0/client        + $0.05/min  (unlimited team, intl, AI Lab)
 *   Plans are Free / Pro / Scale. Pro & Scale: 14-day trial (card). Clients: 7-day trial.
 *
 * Usage:
 *   node pricing-correct.mjs --http <slug>       dry-run one post from live HTML -> ./review/<slug>.html + .diff
 *   node pricing-correct.mjs --db <slug>         dry-run one post from DB
 *   node pricing-correct.mjs --db --worklist f   dry-run every slug in a worklist file
 *   node pricing-correct.mjs --db <slug> --apply write corrected content back to DB + revalidate
 *
 * Env: ANTHROPIC_API_KEY (always), plus SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + REVALIDATION_SECRET for --db/--apply.
 */
import Anthropic from '@anthropic-ai/sdk';
import { validateNextjsPost } from '../src/lib/post-validation-nextjs.js'; // expects placement at blog-farm/scripts/
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const MODEL = 'claude-sonnet-4-6'; // same family the writer uses
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PRICING_SPEC = `VoiceAI Connect's REAL pricing (agency platform fees). These are the ONLY correct numbers:
- Free:  $0/month  + $29.99 per client per month + $0.12/min. No white-label branding, no marketing site.
- Pro:   $99/month + $9.99 per client per month  + $0.10/min. Full white-label, custom domain, marketing site + AI demo line, lead CRM, up to 3 team members.
- Scale: $499/month + $0 per client              + $0.05/min. Everything in Pro, AI Lab + industry templates, unlimited team, international numbers, priority support.
Plan names are exactly Free, Pro, Scale (NEVER Starter, Professional, or Enterprise). Pro and Scale include a 14-day free trial (card required). Clients get a 7-day free trial.
Key economics: platform cost is a monthly fee PLUS a per-client fee (except Scale, which is $0 per client). At 25 clients, Pro = $99 + 25*$9.99 = $348.75/month. Scale ($499 flat) becomes cheaper than Pro above ~40 clients.`;

function buildPrompt(html){
  return `You are correcting fabricated pricing in a published blog post. The post invented a FAKE VoiceAI Connect pricing structure ("Starter $199 / Professional $299 / Enterprise $499", flat-fee, unlimited/25 clients included). That structure DOES NOT EXIST.

${PRICING_SPEC}

YOUR TASK: return the post's HTML with ONLY the following changed:
1. Every statement of VoiceAI Connect's OWN platform price/plan/tier corrected to the real Free/Pro/Scale model and numbers above.
2. Every calculation that DEPENDS on VoiceAI Connect's platform cost (profit, margin, breakeven, cost-per-client) RECOMPUTED with the real model (remember the per-client fee; Scale has none).
3. Fabricated plan names (Starter/Professional/Enterprise) used for VoiceAI Connect replaced with the real names (Free/Pro/Scale).

DO NOT CHANGE ANYTHING ELSE. Specifically, PRESERVE VERBATIM:
- The agency's own RESALE pricing advice (what the agency charges ITS clients, e.g. "charge clients $149/month", or an agency's suggested Basic/Pro/Enterprise client tiers). This is correct content even though it may contain "$199" or "Enterprise". Only VoiceAI Connect's OWN pricing is wrong.
- Competitor pricing, market-range statements, all statistics not tied to VAC platform cost.
- All headings, internal links, external links, HTML tags, structure, and every non-pricing sentence, exactly as-is.

If a passage mixes VAC platform cost with resale numbers, correct only the VAC platform portion and its dependent math.

Output ONLY the corrected HTML. No preamble, no explanation, no code fences.

POST HTML:
${html}`;
}

async function correct(html){
  const res = await anthropic.messages.create({ model: MODEL, max_tokens: 8000,
    messages: [{ role: 'user', content: buildPrompt(html) }] });
  return res.content.filter(b=>b.type==='text').map(b=>b.text).join('').trim().replace(/^```html\n?|```$/g,'').trim();
}

// preservation guardrails: reject a correction that changed too much structurally
function structuralOk(before, after){
  const h = s => (s.match(/<h[1-4][\s>]/gi)||[]).length;
  const a = s => (s.match(/<a\s/gi)||[]).length;
  const w = s => s.replace(/<[^>]*>/g,' ').split(/\s+/).filter(Boolean).length;
  const hb=h(before),ha=h(after),ab=a(before),aa=a(after),wb=w(before),wa=w(after);
  const issues=[];
  if(ha<hb) issues.push(`headings ${hb}->${ha}`);
  if(aa<ab) issues.push(`links ${ab}->${aa}`);
  if(wa < wb*0.75 || wa > wb*1.25) issues.push(`word count ${wb}->${wa} (>25% change)`);
  return { ok: issues.length===0, issues, metrics:{hb,ha,ab,aa,wb,wa} };
}

async function getHtmlHttp(slug){
  const r = await fetch(`https://www.myvoiceaiconnect.com/blog/${slug}`); if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
async function getSupabase(){ const { createClient } = await import('@supabase/supabase-js'); return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
async function getHtmlDb(sb, slug){
  const { data } = await sb.from('blog_generated_posts').select('id, html_content, primary_keyword, meta_description').eq('slug', slug).eq('status','published').maybeSingle();
  if(!data) throw new Error('not found in blog_generated_posts (published)'); return data;
}

async function processOne({slug, html, meta, apply, sb, postId}){
  const before = html;
  const after = await correct(before);
  const gate = validateNextjsPost(after, meta||{});
  const pricingErrs = gate.errors.filter(e=>e.includes('platform price')||e.includes('tier name'));
  const struct = structuralOk(before, after);

  mkdirSync('./review',{recursive:true});
  writeFileSync(`./review/${slug}.corrected.html`, after);
  const status = (pricingErrs.length===0 && struct.ok) ? 'PASS' : 'REVIEW';
  console.log(`\n[${status}] ${slug}`);
  if(pricingErrs.length) console.log('  pricing still flagged:', pricingErrs.join(' | '));
  if(!struct.ok) console.log('  structural drift:', struct.issues.join(', '));
  console.log('  metrics:', JSON.stringify(struct.metrics));
  console.log(`  corrected html -> ./review/${slug}.corrected.html`);

  if(apply){
    if(status!=='PASS'){ console.log('  --apply SKIPPED (did not pass checks)'); return; }
    await sb.from('blog_generated_posts').update({ html_content: after, updated_at: new Date().toISOString() }).eq('id', postId);
    // revalidate
    const { data: biz } = await sb.from('blog_businesses').select('revalidate_url').eq('slug','voiceai-connect').single();
    if(biz?.revalidate_url){ await fetch(biz.revalidate_url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:process.env.REVALIDATION_SECRET, slug})}); }
    console.log('  APPLIED + revalidated.');
  }
}

async function main(){
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const http = args.includes('--http');
  const useDb = args.includes('--db');
  const wlIdx = args.indexOf('--worklist');
  let slugs=[];
  if(wlIdx>-1){ const f=args[wlIdx+1]; slugs=readFileSync(f,'utf8').split('\n').map(l=>l.match(/^- ([a-z0-9-]+)/)?.[1]).filter(Boolean); }
  else slugs=[args.find(a=>!a.startsWith('--'))].filter(Boolean);
  if(!slugs.length){ console.error('Provide a slug or --worklist <file>.'); process.exit(1); }
  if(!process.env.ANTHROPIC_API_KEY){ console.error('ANTHROPIC_API_KEY required.'); process.exit(1); }

  let sb=null; if(useDb||apply) sb=await getSupabase();
  for(const slug of slugs){
    try{
      let html, meta={}, postId=null;
      if(http){ html=await getHtmlHttp(slug); }
      else { const d=await getHtmlDb(sb,slug); html=d.html_content; postId=d.id; meta={primary_keyword:d.primary_keyword, meta_description:d.meta_description}; }
      await processOne({slug, html, meta, apply, sb, postId});
    }catch(e){ console.log(`\n[ERROR] ${slug}: ${e.message}`); }
  }
  console.log('\nDone. Review ./review/*.corrected.html diffs before running --apply.');
}
main().catch(e=>{console.error('Fatal:',e.message);process.exit(1);});
