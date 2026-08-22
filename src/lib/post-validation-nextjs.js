/**
 * NEXT.JS-MODE POST VALIDATION  (VoiceAI Connect)
 *
 * The existing validatePost() in post-validation.js is written for CallBird's
 * full static HTML pages (DOCTYPE, <head>, GTM, canonical, footer, CallBird
 * pricing/phone). VoiceAI Connect posts are Next.js content FRAGMENTS with none
 * of that, which is why the pipeline currently skips validatePost in nextjs
 * mode, leaving VAC posts with no enforced quality, GEO, or pricing gate.
 *
 * This validator fills that gap. It runs on the content fragment + metadata and
 * enforces:
 *   - the GEO citation levers (statistics, external citations, quotation,
 *     self-contained answer, depth, real structure, no keyword stuffing)
 *   - VoiceAI Connect ground truth (correct pricing, no CallBird artifacts
 *     leaking into the white-label brand, correct author)
 *
 * Same return shape as validatePost:  { valid, errors[], warnings[], stats }
 *   errors   = block publishing (route sets status 'revision_needed')
 *   warnings = should fix, do not block
 */

// ─────────────────────────────────────────────────────────────
//  VoiceAI Connect ground truth  --  CONFIRM the pricing block.
//  Wrong pricing that publishes is worse than thin content, so
//  this list is the allowlist of prices that may appear. Any
//  $NN..$NNN not in validPrices (and inside the monthly range)
//  is flagged. Leave validPrices empty to disable the check.
// ─────────────────────────────────────────────────────────────
const VAC = {
  author: 'Gibson Thompson',
  domain: 'myvoiceaiconnect.com',
  validPrices: [],            // e.g. ['$99', '$299', '$499']  <-- CONFIRM then fill (enables off-list flag)
  bannedPrices: [],           // VAC-specific prices that must never appear. NOT $49: it is legit
                              // in blog context (competitor pricing, agency-pricing advice).
  priceRange: [20, 600],      // only monthly-looking $ amounts in this range are checked
  // True white-label leaks only. A2P 10DLC / SOC 2 are generic compliance standards
  // VAC can also claim, so they are NOT treated as leaks.
  callbirdArtifacts: [
    'callbirdai.com', 'callbird', '(505) 594-5806', '505-594-5806', '+15055945806',
  ],
  competitorDomains: [
    'smith.ai', 'ruby.com', 'dialzara.com', 'myaifrontdesk.com', 'goodcall.com',
    'rosie.ai', 'userosie.com', 'aira.io', 'upfirst.com', 'abbyconnect.com',
    'nexa.com', 'synthflow.ai', 'bland.ai',
  ],
};

// GEO thresholds
const MIN_WORDS_ERROR = 1000;
const MIN_WORDS_WARN = 1500;
const MIN_CITATIONS = 2;      // external sources (GEO lever)
const MIN_H2 = 3;
const KW_DENSITY_MAX = 0.035; // 3.5% -> stuffing
const LEAD_MIN = 25;
const LEAD_MAX = 80;

const BANNED_PHRASES = [
  "in today's fast-paced", "in today's competitive", "in today's digital",
  'in the ever-evolving', 'in an increasingly', "let's dive in", "let's explore",
  "let's take a closer look", "it's no secret", 'it goes without saying',
  'cutting-edge', 'game-changing', 'revolutionizing', 'leverage ai', 'leveraging ai',
  'comprehensive guide to', 'the ultimate guide',
];

export function validateNextjsPost(html, metadata = {}) {
  const errors = [];
  const warnings = [];
  const text = stripHtml(html);
  const textLower = text.toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // ═══ GEO LEVERS (the reason VAC content gets cited) ═══

  // Depth
  if (wordCount < MIN_WORDS_ERROR) errors.push(`Content too thin: ${wordCount} words (minimum ${MIN_WORDS_ERROR})`);
  else if (wordCount < MIN_WORDS_WARN) warnings.push(`Content is light: ${wordCount} words (target 1800+)`);

  // Statistics (Princeton: strongest citation lever)
  const stats = countStats(text);
  if (stats < 1) errors.push('No statistics found -- add 2 to 3 concrete, sourced numbers');
  else if (stats < 2) warnings.push(`Only ${stats} statistic -- target 2 to 3 sourced numbers`);

  // External citations (GEO lever). The writer degrades to zero external links when
  // research finds no URLs (rather than fabricate), so only a citation-less post
  // blocks; a single citation warns. Normal posts carry 2 to 3.
  const citations = countExternalCitations(html);
  if (citations === 0) errors.push('No external citations -- cite credible sources inline (2 to 3 target)');
  else if (citations < MIN_CITATIONS) warnings.push(`Only ${citations} external citation -- target ${MIN_CITATIONS} to 3`);

  // Quotation (GEO lever)
  if (countQuotes(html) < 1) warnings.push('No direct quotation found -- add one attributed quote');

  // Structure: H2 count + self-contained lead answer
  const h2s = (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || []).map(h => stripHtml(h));
  if (h2s.length < MIN_H2) errors.push(`Only ${h2s.length} H2 section(s) -- need at least ${MIN_H2}, each answering a question`);
  const lead = leadAnswerWords(html);
  if (lead < LEAD_MIN || lead > LEAD_MAX) warnings.push(`Opening answer block is ${lead} words (target 40 to 60, front-loaded)`);

  // Keyword stuffing (Princeton: negative lever)
  const kw = metadata.primary_keyword || metadata.primaryKeyword;
  const density = keywordDensity(text, kw);
  if (density > KW_DENSITY_MAX) errors.push(`Keyword stuffing: "${kw}" at ${(density * 100).toFixed(1)}% density (max ${(KW_DENSITY_MAX * 100)}%)`);

  // ═══ VOICEAI CONNECT GROUND TRUTH ═══

  // Author (from metadata -- the fragment does not carry the byline; the layout does)
  const metaAuthor = typeof metadata.author === 'string' ? metadata.author : metadata.author?.name;
  if (metaAuthor && metaAuthor !== VAC.author) warnings.push(`Author is "${metaAuthor}" -- expected "${VAC.author}"`);

  // CallBird artifacts must not leak into the white-label brand
  for (const artifact of VAC.callbirdArtifacts) {
    if (textLower.includes(artifact.toLowerCase()) || html.toLowerCase().includes(artifact.toLowerCase())) {
      errors.push(`CallBird artifact leaked into VoiceAI Connect post: "${artifact}"`);
    }
  }

  // Pricing ground truth
  for (const banned of VAC.bannedPrices) {
    if (html.includes(`${banned}/mo`) || html.includes(`${banned} per month`) || html.includes(`${banned}/month`)) {
      errors.push(`Old/banned price detected: ${banned}`);
    }
  }
  if (VAC.validPrices.length > 0) {
    const mentioned = html.match(/\$\d+/g) || [];
    const bad = [...new Set(mentioned)].filter(p => {
      const n = parseInt(p.replace('$', ''), 10);
      return n >= VAC.priceRange[0] && n <= VAC.priceRange[1] && !VAC.validPrices.includes(p);
    });
    if (bad.length) errors.push(`Unrecognized pricing: ${bad.join(', ')} -- valid prices are ${VAC.validPrices.join(', ')}. Verify against current pricing.`);
  }

  // Competitor domain links
  const hrefs = (html.match(/href="([^"]*)"/gi) || []).map(h => h.replace(/href="/i, '').replace(/"$/, ''));
  for (const url of hrefs) {
    for (const comp of VAC.competitorDomains) {
      if (url.includes(comp)) errors.push(`Link to competitor domain: ${url}`);
    }
  }

  // AI slop (warning)
  for (const phrase of BANNED_PHRASES) {
    if (textLower.includes(phrase)) warnings.push(`AI slop phrase: "${phrase}"`);
  }

  // Meta description sanity
  const desc = metadata.meta_description || '';
  if (desc && desc.length > 160) warnings.push(`Meta description is ${desc.length} chars (recommended <155)`);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: { wordCount, h2Count: h2s.length, statistics: stats, citations, leadWords: lead, keywordDensity: Number(density.toFixed(3)) },
  };
}

// ── helpers ──

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function countStats(text) {
  const pats = [
    /\b\d{1,3}(?:\.\d+)?\s?%/g,
    /\$\s?\d[\d,]*(?:\.\d+)?/g,
    /\b\d[\d,]{2,}(?:\.\d+)?\b/g,
    /\b\d+(?:\.\d+)?\s?(?:x|times|percent|million|billion|thousand|hours?|minutes?|seconds?|days?)\b/gi,
  ];
  const hits = new Set();
  for (const re of pats) { const m = text.match(re); if (m) m.forEach(h => hits.add(h.trim().toLowerCase())); }
  return hits.size;
}

function countQuotes(html) {
  const text = stripHtml(html);
  let n = (html.match(/<blockquote/gi) || []).length;
  const q = text.match(/["\u201C][^"\u201C\u201D]{15,}["\u201D]/g);
  if (q) n += q.length;
  return n;
}

function countExternalCitations(html) {
  const links = [...String(html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  const ext = links.filter(h => {
    if (!/^https?:\/\//i.test(h)) return false;
    try { return !new URL(h).host.includes(VAC.domain); } catch { return false; }
  });
  return new Set(ext).size;
}

function leadAnswerWords(html) {
  const m = String(html || '').match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const first = m ? stripHtml(m[1]) : stripHtml(html).split(/(?<=[.!?])\s/)[0] || '';
  return first.split(/\s+/).filter(Boolean).length;
}

function keywordDensity(text, keyword) {
  if (!keyword) return 0;
  const total = text.split(/\s+/).filter(Boolean).length;
  if (!total) return 0;
  const kw = keyword.toLowerCase().trim();
  const body = text.toLowerCase();
  let count = 0, i = 0;
  while ((i = body.indexOf(kw, i)) !== -1) { count++; i += kw.length; }
  return (count * kw.split(/\s+/).length) / total;
}