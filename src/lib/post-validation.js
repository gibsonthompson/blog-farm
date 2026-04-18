/**
 * PROGRAMMATIC POST VALIDATION
 * 
 * Hard code checks that don't rely on Claude's judgment.
 * These catch template errors, broken links, wrong data,
 * and structural problems that the QC prompt might miss.
 * 
 * Returns { valid, errors[], warnings[] }
 * - errors = must fix before publishing (blocks approve)
 * - warnings = should fix but won't block
 */

// ── CallBird ground truth — update if these change ──
const VALID_PHONE = '(505) 594-5806';
const VALID_PHONE_ALT = '505-594-5806';
const VALID_PHONE_TEL = '+15055945806';
const VALID_GTM = 'GTM-M9WVK3WD';
const VALID_PRICING = ['$99', '$249', '$499'];
const CURRENT_YEAR = new Date().getFullYear();
const OLD_PHONES = ['678-316-1454', '770-809-2820', '(678) 316-1454', '(770) 809-2820'];
const COMPETITOR_DOMAINS = [
  'smith.ai', 'ruby.com', 'dialzara.com', 'myaifrontdesk.com', 'goodcall.com',
  'rosie.ai', 'userosie.com', 'aira.io', 'upfirst.com', 'abbyconnect.com',
  'nexa.com', 'synthflow.ai', 'bland.ai',
];
const BANNED_PHRASES = [
  'in today\'s fast-paced',
  'in today\'s competitive',
  'in today\'s digital',
  'in the ever-evolving',
  'in an increasingly',
  'let\'s dive in',
  'let\'s explore',
  'let\'s take a closer look',
  'it\'s no secret',
  'it goes without saying',
  'cutting-edge',
  'game-changing',
  'revolutionizing',
  'leverage ai',
  'leveraging ai',
  'comprehensive guide to',
  'the ultimate guide',
];

export function validatePost(html, metadata, existingSlugs = []) {
  const errors = [];
  const warnings = [];
  const text = stripHtml(html);
  const textLower = text.toLowerCase();
  const htmlLower = html.toLowerCase();

  // ════════════════════════════════════════════
  //  ERRORS — block publishing
  // ════════════════════════════════════════════

  // 1. Valid HTML structure
  if (!html.includes('<!DOCTYPE html>') && !html.includes('<!doctype html>')) {
    errors.push('Missing <!DOCTYPE html> declaration');
  }
  if (!html.includes('</html>')) {
    errors.push('HTML is truncated — missing </html> closing tag');
  }
  if (!html.includes('<head>') || !html.includes('</head>')) {
    errors.push('Missing or broken <head> section');
  }

  // 2. GTM present
  if (!html.includes(VALID_GTM)) {
    errors.push(`Missing Google Tag Manager (${VALID_GTM})`);
  }

  // 3. Phone number correct
  if (!html.includes(VALID_PHONE) && !html.includes(VALID_PHONE_ALT) && !html.includes(VALID_PHONE_TEL)) {
    errors.push(`Missing correct phone number (${VALID_PHONE})`);
  }

  // 4. Old phone numbers must NOT appear
  for (const old of OLD_PHONES) {
    if (html.includes(old)) {
      errors.push(`Old phone number found: ${old} — must use ${VALID_PHONE}`);
    }
  }

  // 5. Pricing must be accurate
  const pricingMentions = html.match(/\$\d+/g) || [];
  const monthlyPrices = pricingMentions.filter(p => {
    const num = parseInt(p.replace('$', ''));
    return num >= 20 && num <= 600 && !VALID_PRICING.includes(p);
  });
  // Check for old $49 pricing specifically
  if (html.includes('$49/mo') || html.includes('$49 per month') || html.includes('$49/month')) {
    errors.push('Old $49 pricing detected — current Starter is $99/mo');
  }

  // 6. JSON-LD schema must be parseable
  const schemaMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || [];
  if (schemaMatches.length === 0) {
    errors.push('No JSON-LD schema found');
  }
  for (const match of schemaMatches) {
    const jsonStr = match.replace(/<script type="application\/ld\+json">/i, '').replace(/<\/script>/i, '');
    try {
      JSON.parse(jsonStr);
    } catch {
      errors.push('JSON-LD schema is malformed — Google cannot parse it');
    }
  }

  // 7. Single H1
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1Count === 0) errors.push('Missing H1 tag');
  if (h1Count > 1) errors.push(`Multiple H1 tags found (${h1Count}) — must have exactly 1`);

  // 8. Title tag present and reasonable
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!titleMatch) {
    errors.push('Missing <title> tag');
  } else {
    const title = titleMatch[1].trim();
    if (title.length > 65) warnings.push(`Title tag is ${title.length} chars (recommended <60, truncates at 65)`);
    if (title.length < 20) errors.push('Title tag is too short');
  }

  // 9. Meta description present and reasonable
  const metaDescMatch = html.match(/meta name="description" content="([^"]*)"/i);
  if (!metaDescMatch) {
    errors.push('Missing meta description');
  } else {
    const desc = metaDescMatch[1];
    if (desc.length > 160) warnings.push(`Meta description is ${desc.length} chars (recommended <155)`);
    if (desc.length < 50) errors.push('Meta description is too short');
  }

  // 10. Canonical URL present and uses clean URL (no .html)
  const canonicalMatch = html.match(/rel="canonical" href="([^"]*)"/i);
  if (!canonicalMatch) {
    errors.push('Missing canonical URL');
  } else {
    const canonical = canonicalMatch[1];
    if (!canonical.includes('callbirdai.com')) {
      errors.push(`Canonical URL points to wrong domain: ${canonical}`);
    }
    if (canonical.includes('www.')) {
      warnings.push(`Canonical uses www — should be https://callbirdai.com/... (no www)`);
    }
    if (canonical.endsWith('.html')) {
      warnings.push(`Canonical ends with .html — Vercel cleanUrls strips this. Use without .html`);
    }
  }

  // 11. Year check — current year in title
  if (metadata?.title && !metadata.title.includes(String(CURRENT_YEAR))) {
    warnings.push(`Title doesn't include ${CURRENT_YEAR} — freshness signal missing`);
  }
  // Check for old years used as if current
  const oldYearPattern = /\b(2023|2024|2025)\b/g;
  const oldYears = text.match(oldYearPattern) || [];
  const suspiciousOldYears = oldYears.filter(y => {
    // Allow historical references but flag "[year] guide" or "in [year]" as current
    const idx = text.indexOf(y);
    const context = text.substring(Math.max(0, idx - 30), idx + y.length + 30).toLowerCase();
    return context.includes('guide') || context.includes('updated') || context.includes('best') || context.includes('top');
  });
  if (suspiciousOldYears.length > 0) {
    errors.push(`Old year used as current: ${[...new Set(suspiciousOldYears)].join(', ')} — should be ${CURRENT_YEAR}`);
  }

  // 12. No external links to competitor domains
  const hrefMatches = html.match(/href="([^"]*)"/gi) || [];
  for (const href of hrefMatches) {
    const url = href.replace(/href="/i, '').replace(/"$/, '');
    for (const comp of COMPETITOR_DOMAINS) {
      if (url.includes(comp)) {
        errors.push(`External link to competitor domain: ${url} — remove or replace with internal link`);
      }
    }
  }

  // 13. Internal links point to real slugs
  const internalLinks = hrefMatches
    .map(h => h.replace(/href="/i, '').replace(/"$/, ''))
    .filter(url => url.startsWith('blog-') && url.endsWith('.html'));
  for (const link of internalLinks) {
    const slug = link.replace('blog-', '').replace('.html', '');
    if (existingSlugs.length > 0 && !existingSlugs.includes(slug)) {
      errors.push(`Broken internal link: ${link} — this slug does not exist in the database`);
    }
  }

  // 14. Author check
  if (!html.includes('Gibson Thompson')) {
    errors.push('Author "Gibson Thompson" not found — must appear in byline and schema');
  }
  if (html.includes('By CallBird Team') || html.includes('CallBird Team')) {
    errors.push('"CallBird Team" found as author — must be "Gibson Thompson"');
  }

  // 15. Footer compliance text
  if (!html.includes('A2P 10DLC Compliant') || !html.includes('SOC 2 Type II Certified')) {
    errors.push('Missing footer compliance text (A2P 10DLC + SOC 2 Type II)');
  }

  // ════════════════════════════════════════════
  //  WARNINGS — should fix but don't block
  // ════════════════════════════════════════════

  // 16. AI slop phrases
  for (const phrase of BANNED_PHRASES) {
    if (textLower.includes(phrase)) {
      warnings.push(`AI slop phrase detected: "${phrase}"`);
    }
  }

  // 17. Word count
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 1000) errors.push(`Content too thin: ${wordCount} words (minimum 1000)`);
  if (wordCount < 1500) warnings.push(`Content is light: ${wordCount} words (target 1800+)`);
  if (wordCount > 5000) warnings.push(`Content may be bloated: ${wordCount} words — check for filler`);

  // 18. FAQ section present
  if (!html.includes('faq-section') && !html.includes('FAQPage')) {
    warnings.push('No FAQ section detected — missing AEO opportunity');
  }

  // 19. OG tags present
  if (!html.includes('og:title')) warnings.push('Missing og:title meta tag');
  if (!html.includes('og:description')) warnings.push('Missing og:description meta tag');

  // 20. CTA present
  if (!html.includes('cta-box') && !html.includes('Start Free Trial') && !html.includes('start.html')) {
    errors.push('No CTA detected — every post must drive trial signups');
  }

  // 21. Internal link count — critical for SEO and site architecture
  const internalLinkCount = internalLinks.length;
  if (internalLinkCount === 0) errors.push('Zero internal links — must have at least 3 links to other blog posts');
  else if (internalLinkCount < 2) errors.push(`Only ${internalLinkCount} internal link — must have at least 2`);
  else if (internalLinkCount < 3) warnings.push(`Only ${internalLinkCount} internal links — target 3+`);

  // 22. Nav and footer present
  if (!html.includes('class="navbar"') && !html.includes('class="nav')) {
    warnings.push('Navigation HTML may be missing');
  }
  if (!html.includes('class="footer"') && !html.includes('<footer')) {
    warnings.push('Footer HTML may be missing');
  }

  // 23. Structural similarity — check if post uses exact same H2 pattern as the generic template
  const h2s = (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || []).map(h => stripHtml(h).toLowerCase());
  const genericH2Patterns = ['frequently asked questions', 'the bottom line', 'getting started', 'conclusion'];
  const genericH2Count = h2s.filter(h => genericH2Patterns.some(p => h.includes(p))).length;
  if (genericH2Count >= 2) warnings.push('Multiple generic H2 headings detected — content may lack uniqueness');

  // 24. Competitor recommendation check (deterministic)
  // These patterns catch ACTIVE recommendations, not comparison framework headers
  // "Choose Abby Connect if:" in a comparison section is OK
  // "You should choose Abby Connect" or "We recommend Abby" is NOT OK
  const competitorRecs = [
    'recommend smith', 'recommend ruby', 'recommend dialzara', 'recommend abby', 'recommend nexa', 'recommend goodcall',
    'go with smith', 'go with ruby', 'go with dialzara', 'go with abby', 'go with goodcall',
    'use smith.ai instead', 'use ruby instead', 'use dialzara instead', 'use abby instead',
    'better off with smith', 'better off with ruby', 'better off with abby',
    'only smith.ai offers', 'only ruby offers', 'only abby offers', 'only goodcall offers',
    'smith.ai is better', 'ruby is better', 'abby is better', 'goodcall is better',
    'switch to smith', 'switch to ruby', 'switch to abby',
  ];
  for (const rec of competitorRecs) {
    if (textLower.includes(rec)) {
      errors.push(`Competitor recommendation detected: "${rec}" — must not recommend competitors over CallBird`);
    }
  }

  // 25. Category fear check (deterministic)
  const fearPhrases = [
    'hidden cost of ai receptionist',
    'risks of ai receptionist',
    'dangers of ai',
    'ai receptionist fail',
    'not ready for ai',
    'avoid ai receptionist',
    'don\'t get an ai',
  ];
  for (const phrase of fearPhrases) {
    if (textLower.includes(phrase)) {
      warnings.push(`Category fear phrase detected: "${phrase}" — may discourage readers from AI receptionists`);
    }
  }

  // 26. Fabricated first-person experience claims
  const fabricatedClaims = [
    'i\'ve seen businesses',
    'i\'ve helped companies',
    'i\'ve watched hundreds',
    'i\'ve watched dozens',
    'after helping hundreds',
    'after working with hundreds',
    'after testing seven',
    'after testing dozens',
    'i\'ve tested every',
    'i\'ve personally tested',
    'in my experience working with',
    'i\'ve implemented ai for',
    'i\'ve spent years implementing',
    'i\'ve spent three years',
  ];
  for (const claim of fabricatedClaims) {
    if (textLower.includes(claim)) {
      warnings.push(`Likely fabricated experience claim: "${claim}" — use hypothetical framing instead ("Consider a business that...")`);
    }
  }

  // 27. Numbered list overuse (more than 5 items in sequence = template pattern)
  const numberedPatterns = [
    /hidden cost #\d/gi,
    /step #?\d.*step #?\d.*step #?\d.*step #?\d.*step #?\d/gs,
    /reason #?\d.*reason #?\d.*reason #?\d.*reason #?\d.*reason #?\d/gs,
  ];
  for (const pattern of numberedPatterns) {
    if (pattern.test(text)) {
      warnings.push('Long numbered sequence detected (5+) — break into natural prose sections instead');
    }
  }

  // 28. Inconsistent statistics (same claim with different numbers)
  const missedCallStats = text.match(/(\d{2,3})%\s*(?:of\s+)?(?:calls?|phone\s+calls?)\s*(?:go|are|get)\s*(?:un)?(?:answered|missed)/gi) || [];
  const uniquePercents = [...new Set(missedCallStats.map(m => m.match(/(\d{2,3})%/)?.[1]).filter(Boolean))];
  if (uniquePercents.length > 1) {
    warnings.push(`Inconsistent missed call statistics: ${uniquePercents.join('% vs ')}% — pick one number and use it consistently`);
  }

  // 29. Viral unverified stat reuse — BLOCKS PUBLISHING
  if (text.includes('$126,000') || text.includes('126,000 annually') || text.includes('$126K') || text.includes('$126k')) {
    errors.push('Uses the viral "$126,000 annually" stat — this is unverified and overused. Calculate a real number using your own formula instead.');
  }

  // 30. Quick Answer box pattern
  if (htmlLower.includes('quick answer') || htmlLower.includes('quick-answer')) {
    warnings.push('"Quick Answer" box detected — this is a generic AI pattern. Start with natural prose instead.');
  }

  // 31. Fabricated data sample sizes (AI loves inventing "2,074 businesses" etc.)
  const sampleSizePatterns = [
    /(?:analyzing|analyzed|surveyed|studied|reviewed|data from)\s+[\d,]+\s+(?:businesses|companies|firms|practices|implementations|integrations)/gi,
    /(?:based on|according to)\s+(?:our|my|internal)\s+(?:data|research|analysis|survey)/gi,
  ];
  for (const pattern of sampleSizePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        warnings.push(`Likely fabricated data claim: "${m}" — remove specific sample sizes unless from a real, named study`);
      }
    }
  }

  // 32. Excessive precise percentages (>5 unique percentages often means fabrication)
  const allPercents = text.match(/\d{1,3}(?:\.\d+)?%/g) || [];
  const uniquePercents2 = [...new Set(allPercents)];
  if (uniquePercents2.length > 8) {
    warnings.push(`${uniquePercents2.length} different percentage values found — likely includes fabricated statistics. Verify each one has a real source.`);
  }

  // 33. Unsourced authoritative claims — stats presented as fact without attribution
  const unsourcedPatterns = [
    /(\d{2,3})%\s+of\s+(?:businesses|companies|small businesses|callers|customers)\s+(?:fail|abandon|miss|lose|report)/gi,
    /(?:studies show|research shows|data shows|industry data shows)\s+(?:that\s+)?(\d{2,3})%/gi,
  ];
  for (const pattern of unsourcedPatterns) {
    const matches = text.match(pattern) || [];
    // Check if any attribution word is nearby (within 100 chars after the match)
    for (const m of matches) {
      const idx = text.indexOf(m);
      const context = text.substring(idx, Math.min(text.length, idx + m.length + 100)).toLowerCase();
      const hasAttribution = /(?:according to|per|from|by|source:|hubspot|salesforce|gartner|forrester|bureau|bls|census|google|yelp|harvard|mckinsey)/.test(context);
      if (!hasAttribution) {
        warnings.push(`Possibly unsourced stat: "${m.substring(0, 60)}..." — add a real source or soften to qualitative language`);
        break; // Only flag once per pattern
      }
    }
  }

  // 34. Math verification — catches wrong calculations
  const mathErrors = verifyMath(text);
  for (const me of mathErrors) {
    errors.push(`MATH: ${me}`);
  }

  // 35. Fabricated anecdote detection
  const anecdoteWarnings = detectFabricatedAnecdotes(text);
  for (const aw of anecdoteWarnings) {
    warnings.push(aw);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      wordCount,
      h1Count,
      h2Count: h2s.length,
      internalLinkCount,
      schemaCount: schemaMatches.length,
      hasGTM: html.includes(VALID_GTM),
      hasPhone: html.includes(VALID_PHONE) || html.includes(VALID_PHONE_ALT),
      hasFAQ: html.includes('faq-section') || html.includes('FAQPage'),
      hasCTA: html.includes('cta-box') || html.includes('Start Free Trial'),
    },
  };
}

// ── Math Verification ──

function parseNum(s) {
  if (!s) return NaN;
  return parseFloat(s.replace(/[$,]/g, '').replace(/%/, '')) ;
}

function verifyMath(text) {
  const errors = [];
  const verifiedResults = new Set(); // Track results already validated by multi-factor

  // Pattern 1: "A × B × C = $RESULT" — three-factor chains (check first, highest priority)
  const multiplyChains = text.matchAll(
    /([\d,.]+)(?:%|\s*(?:calls?|mins?|hours?))?\s*×\s*([\d,.]+)(?:%)?\s*×\s*\$?([\d,.]+)\s*=\s*\$?([\d,.]+)/gi
  );
  for (const m of multiplyChains) {
    let a = parseNum(m[1]);
    let b = parseNum(m[2]);
    let c = parseNum(m[3]);
    const stated = parseNum(m[4]);
    if (m[0].includes('%')) {
      if (a > 1 && a <= 100 && m[0].indexOf('%') < m[0].indexOf('×')) a = a / 100;
      else if (b > 1 && b <= 100) b = b / 100;
    }
    const calculated = a * b * c;
    if (!isNaN(calculated) && !isNaN(stated) && stated > 0) {
      verifiedResults.add(stated); // Mark this result as handled
      const diff = Math.abs(calculated - stated) / stated;
      if (diff > 0.05) {
        errors.push(`Math error: ${m[1]} × ${m[2]} × ${m[3]} should equal ${Math.round(calculated).toLocaleString()}, not ${m[4]} (${(diff * 100).toFixed(0)}% off)`);
      }
    }
  }

  // Also check for 4-factor patterns like "(12 × 4) × $10,140 × 0.25 = $121,680"
  const fourFactor = text.matchAll(
    /\(?([\d,.]+)\s*×\s*([\d,.]+)\)?\s*×\s*\$?([\d,.]+)\s*×\s*\$?([\d,.]+)(?:%)?\s*=\s*\$?([\d,.]+)/gi
  );
  for (const m of fourFactor) {
    let a = parseNum(m[1]);
    let b = parseNum(m[2]);
    let c = parseNum(m[3]);
    let d = parseNum(m[4]);
    const stated = parseNum(m[5]);
    if (m[0].includes('%') && d > 0 && d <= 1) { /* already decimal */ }
    else if (m[0].includes('%') && d > 1 && d <= 100) d = d / 100;
    const calculated = a * b * c * d;
    if (!isNaN(calculated) && !isNaN(stated) && stated > 0) {
      verifiedResults.add(stated);
      const diff = Math.abs(calculated - stated) / stated;
      if (diff > 0.05) {
        errors.push(`Math error: ${m[1]} × ${m[2]} × ${m[3]} × ${m[4]} should equal ${Math.round(calculated).toLocaleString()}, not ${m[5]} (${(diff * 100).toFixed(0)}% off)`);
      }
    }
  }

  // Pattern 2: "$X/month × 12 = $Y" — ONLY match explicit "× 12" near monthly price
  const monthlyAnnual = text.matchAll(
    /\$?([\d,.]+)\/month\s*[×x*]\s*12\s*=\s*\$?([\d,.]+)/gi
  );
  for (const m of monthlyAnnual) {
    const monthly = parseNum(m[1]);
    const stated = parseNum(m[2]);
    if (verifiedResults.has(stated)) continue; // Already checked
    const calculated = monthly * 12;
    if (!isNaN(calculated) && !isNaN(stated) && stated > 0) {
      verifiedResults.add(stated);
      const diff = Math.abs(calculated - stated) / stated;
      if (diff > 0.05) {
        errors.push(`Monthly-to-annual math error: $${m[1]}/month × 12 = $${Math.round(calculated).toLocaleString()}, not $${m[2]} (${(diff * 100).toFixed(0)}% off)`);
      }
    }
  }

  // Pattern 3: "$X/week × 52 = $Y" — ONLY match explicit "× 52"
  const weeklyAnnual = text.matchAll(
    /\$?([\d,.]+)(?:\/week|[\s]+per[\s]+week)\s*[×x*]\s*52\s*=\s*\$?([\d,.]+)/gi
  );
  for (const m of weeklyAnnual) {
    const weekly = parseNum(m[1]);
    const stated = parseNum(m[2]);
    if (verifiedResults.has(stated)) continue;
    const calculated = weekly * 52;
    if (!isNaN(calculated) && !isNaN(stated) && stated > 0) {
      verifiedResults.add(stated);
      const diff = Math.abs(calculated - stated) / stated;
      if (diff > 0.05) {
        errors.push(`Weekly-to-annual math error: $${m[1]}/week × 52 = $${Math.round(calculated).toLocaleString()}, not $${m[2]} (${(diff * 100).toFixed(0)}% off)`);
      }
    }
  }

  // Pattern 4: Simple "A × B = $RESULT" — ONLY if result wasn't already verified
  // AND not part of a larger multi-factor expression
  const twoFactor = text.matchAll(
    /([\d,.]+)(?:%|\s*(?:calls?|jobs?|appointments?))?[\s]*×[\s]*\$?([\d,.]+)[\s]*=[\s]*\$?([\d,.]+)/gi
  );
  for (const m of twoFactor) {
    const stated = parseNum(m[3]);
    if (verifiedResults.has(stated)) continue; // Already validated by a multi-factor pattern

    // Skip if there's a × or ) before this match (it's part of a larger formula)
    const charBefore = m.index > 0 ? text.substring(Math.max(0, m.index - 5), m.index) : '';
    if (/[×x\*\)]/.test(charBefore)) continue;

    let a = parseNum(m[1]);
    let b = parseNum(m[2]);
    if (m[0].includes('%') && a > 1 && a <= 100) a = a / 100;
    const calculated = a * b;
    if (!isNaN(calculated) && !isNaN(stated) && stated > 0) {
      verifiedResults.add(stated);
      const diff = Math.abs(calculated - stated) / stated;
      if (diff > 0.05) {
        errors.push(`Math error: ${m[1]} × ${m[2]} should equal ${Math.round(calculated).toLocaleString()}, not ${m[3]} (${(diff * 100).toFixed(0)}% off)`);
      }
    }
  }

  return errors;
}

// ── Fabricated Anecdote Detection ──

function detectFabricatedAnecdotes(text) {
  const warnings = [];

  // "a [profession] in [City]" with specific dollar amounts nearby
  const anecdotePattern = /(?:a|one|this)\s+(?:plumber|electrician|contractor|dentist|lawyer|doctor|salon owner|business owner|HVAC tech|roofer)\s+in\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+/gi;
  const matches = text.match(anecdotePattern) || [];
  for (const m of matches) {
    const idx = text.indexOf(m);
    const context = text.substring(idx, Math.min(text.length, idx + 200));
    if (/\$[\d,]+/.test(context)) {
      warnings.push(`Possibly fabricated anecdote: "${m.trim()}..." with specific dollar amounts — use "Consider a plumber who..." instead`);
    }
  }

  return warnings;
}

// ── Helpers ──

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}