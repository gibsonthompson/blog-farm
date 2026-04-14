-- ============================================================
-- BLOG AUTOMATION SYSTEM — SUPABASE SCHEMA
-- Run in Supabase SQL Editor (existing VoiceAI Connect project)
-- ============================================================

-- 1. Businesses (multi-tenant, isolated knowledge bases)
CREATE TABLE blog_businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  github_owner TEXT NOT NULL,
  github_repo TEXT NOT NULL,
  github_branch TEXT DEFAULT 'main',
  sitemap_path TEXT DEFAULT 'sitemap.xml',
  blog_index_path TEXT DEFAULT 'blog.html',
  blog_file_prefix TEXT DEFAULT 'blog-',
  phone TEXT,
  gtm_id TEXT,
  indexnow_key TEXT,
  gsc_property_url TEXT,
  active BOOLEAN DEFAULT true
);

-- 2. Brand kits (the knowledge base per business)
CREATE TABLE blog_brand_kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES blog_businesses(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ DEFAULT now(),
  company_description TEXT NOT NULL,
  target_audience TEXT NOT NULL,
  brand_voice TEXT NOT NULL,
  value_propositions TEXT[] DEFAULT '{}',
  primary_keywords TEXT[] DEFAULT '{}',
  competitor_names TEXT[] DEFAULT '{}',
  pricing_info TEXT,
  dos TEXT[] DEFAULT '{}',
  donts TEXT[] DEFAULT '{}',
  writing_style_examples TEXT,
  cta_templates TEXT[] DEFAULT '{}',
  internal_link_targets JSONB DEFAULT '[]',
  header_html TEXT,
  footer_html TEXT,
  css_styles TEXT,
  UNIQUE(business_id)
);

-- 3. Existing blog posts registry (anti-cannibalization)
CREATE TABLE blog_existing_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES blog_businesses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  primary_keyword TEXT,
  secondary_keywords TEXT[] DEFAULT '{}',
  meta_description TEXT,
  category TEXT,
  publish_date DATE,
  word_count INTEGER,
  is_indexed BOOLEAN DEFAULT false,
  UNIQUE(business_id, slug)
);

-- 4. Generated blog posts (main working table)
CREATE TABLE blog_generated_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES blog_businesses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  meta_description TEXT,
  primary_keyword TEXT,
  secondary_keywords TEXT[] DEFAULT '{}',
  category TEXT,
  read_time TEXT,
  emoji TEXT,
  excerpt TEXT,
  html_content TEXT NOT NULL,
  qc_score JSONB,
  qc_notes TEXT,
  qc_passed BOOLEAN,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','published','rejected','revision_needed')),
  publish_date DATE,
  github_commit_sha TEXT,
  google_indexed BOOLEAN DEFAULT false,
  indexnow_submitted BOOLEAN DEFAULT false,
  gsc_submitted BOOLEAN DEFAULT false,
  generation_prompt TEXT,
  generation_model TEXT DEFAULT 'claude-sonnet-4-20250514',
  word_count INTEGER,
  UNIQUE(business_id, slug)
);

-- 5. Content queue / keyword pipeline
CREATE TABLE blog_content_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES blog_businesses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  target_keyword TEXT NOT NULL,
  secondary_keywords TEXT[] DEFAULT '{}',
  post_type TEXT NOT NULL CHECK (post_type IN ('industry','comparison','how-to','statistics','guide','about','cost-analysis')),
  title_suggestion TEXT,
  notes TEXT,
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued','in_progress','generated','published','skipped')),
  priority INTEGER DEFAULT 0,
  scheduled_date DATE,
  generated_post_id UUID REFERENCES blog_generated_posts(id)
);

-- 6. Generation logs (debugging + improvement)
CREATE TABLE blog_generation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES blog_generated_posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB,
  duration_ms INTEGER
);

-- Indexes for performance
CREATE INDEX idx_blog_posts_business ON blog_generated_posts(business_id);
CREATE INDEX idx_blog_posts_status ON blog_generated_posts(status);
CREATE INDEX idx_blog_queue_business ON blog_content_queue(business_id);
CREATE INDEX idx_blog_queue_status ON blog_content_queue(status);
CREATE INDEX idx_blog_existing_business ON blog_existing_posts(business_id);
CREATE INDEX idx_blog_logs_post ON blog_generation_logs(post_id);

-- ============================================================
-- SEED DATA: CallBird AI
-- ============================================================

INSERT INTO blog_businesses (slug, name, domain, github_owner, github_repo, sitemap_path, blog_index_path, blog_file_prefix, phone, gtm_id, gsc_property_url)
VALUES (
  'callbird',
  'CallBird AI',
  'callbirdai.com',
  'gibsonthompson',
  'callbird-site',
  'sitemap.xml',
  'blog.html',
  'blog-',
  '(505) 594-5806',
  'GTM-M9WVK3WD',
  'https://callbirdai.com/'
);

-- Brand kit (comprehensive)
INSERT INTO blog_brand_kits (
  business_id,
  company_description,
  target_audience,
  brand_voice,
  value_propositions,
  primary_keywords,
  competitor_names,
  pricing_info,
  dos,
  donts,
  writing_style_examples,
  cta_templates,
  internal_link_targets
)
VALUES (
  (SELECT id FROM blog_businesses WHERE slug = 'callbird'),
  
  -- company_description
  'CallBird AI is an AI-powered receptionist service for small businesses. It answers phone calls 24/7 using conversational AI, books appointments directly into business calendars, provides instant call summaries via SMS, and handles customer inquiries with natural-sounding voice AI. Built for businesses that can''t afford to miss calls — dental offices, law firms, HVAC companies, restaurants, salons, medical practices, and other service-based businesses. Based in Atlanta, GA. CallBird runs on VAPI voice AI infrastructure with Deepgram transcription.',

  -- target_audience  
  'Small to mid-size business owners (1-50 employees) who are missing phone calls, losing leads to voicemail, can''t afford a full-time receptionist ($33K-$60K/year), or need after-hours call coverage. Industries: dental practices, law firms, home services (HVAC, plumbing, electrical, contractors), restaurants, medical offices, veterinary clinics, salons/spas, property management, professional services, retail. These owners are frustrated by missed revenue, overwhelmed by call volume, and looking for an affordable solution that actually works.',

  -- brand_voice
  'Confident but not salesy. Data-driven — always use specific numbers and statistics rather than vague claims. Empathetic to the small business owner''s pain (missed calls = lost revenue). Professional but approachable — write like a trusted advisor, not a corporation. The customer is always the hero of the story; CallBird is the guide that helps them succeed (StoryBrand framework). Lead with the problem and its cost, then present the solution. Never pressure or use urgency tactics. Be direct, clear, and substantive.',

  -- value_propositions
  ARRAY[
    '24/7 AI receptionist that answers every call — nights, weekends, holidays',
    'Instant appointment booking directly into your calendar',
    'Real-time call summaries sent via SMS after every call',
    'Costs 95% less than a human receptionist ($99/mo vs $33K+/year)',
    'Natural-sounding AI voice that customers can''t tell from a human',
    'No missed calls means no missed revenue',
    'Industry-specific training for dental, legal, home services, and more',
    'A2P 10DLC compliant and SOC 2 Type II certified'
  ],

  -- primary_keywords
  ARRAY[
    'AI receptionist',
    'AI answering service',
    'virtual receptionist AI',
    'AI phone answering',
    'automated receptionist',
    'AI receptionist for small business',
    'best AI receptionist',
    'AI receptionist cost',
    'AI receptionist vs human receptionist'
  ],

  -- competitor_names
  ARRAY[
    'Smith.ai',
    'Ruby Receptionists',
    'Dialzara',
    'My AI Front Desk',
    'Goodcall',
    'AIRA',
    'Upfirst',
    'Rosie AI',
    'Abby Connect',
    'Nexa'
  ],

  -- pricing_info
  'Starter: $99/month — Includes AI receptionist, call answering, basic appointment booking, call summaries via SMS. Professional: $249/month — Everything in Starter plus advanced scheduling, custom AI training, priority support, multiple phone lines. Enterprise: $499/month — Everything in Professional plus dedicated account manager, API access, white-label options, unlimited customization. All plans include unlimited calls. No per-minute charges. No contracts — cancel anytime.',

  -- dos
  ARRAY[
    'Include FAQPage JSON-LD schema markup on every blog post',
    'Include Google Tag Manager script (GTM-M9WVK3WD) in <head>',
    'Use canonical URLs: https://callbirdai.com/blog-{slug}.html',
    'Include complete OG tags (title, description, type=article, url, image)',
    'Link internally to homepage, pricing section (#pricing), and related blog posts (minimum 2 internal links)',
    'Use accurate pricing: $99 / $249 / $499 per month',
    'Include phone number (505) 594-5806 in at least one CTA',
    'Footer must include: A2P 10DLC Compliant • SOC 2 Type II Certified',
    'Footer must include White Label link: <a href="https://myvoiceaiconnect.com">White Label AI Receptionist</a>',
    'Stagger publish dates across different days when creating batches',
    'Include meta viewport with 80% zoom: <meta name="viewport" content="width=device-width, initial-scale=0.8">',
    'All pages must be mobile responsive with @media (max-width: 768px) breakpoints',
    'Use emoji in blog card thumbnails (not images)',
    'Include at least 3-5 FAQ items in FAQPage schema per post',
    'Include a clear CTA section with link to /start or #pricing',
    'Target a minimum word count of 1,500 words per post',
    'Include relevant statistics and data points with context',
    'Use H2s and H3s that contain keyword variations naturally'
  ],

  -- donts
  ARRAY[
    'NEVER fabricate revenue figures or fake dollar amounts in testimonials',
    'NEVER fabricate customer quotes — use SVG star ratings and generic avatar icons instead',
    'NEVER claim features that do not actually exist in the CallBird product',
    'NEVER change indexed H1s, H2s, title tags, or meta keywords on existing pages',
    'NEVER use stock photos — use emoji placeholders for blog post card thumbnails',
    'NEVER duplicate the primary keyword target of an existing blog post (check existing posts list)',
    'NEVER mention competitor pricing unless verified with a current web search',
    'NEVER use urgency/scarcity tactics ("Limited time!", "Only 3 spots left!")',
    'NEVER use overly casual/slangy tone — professional but approachable only',
    'NEVER include broken or placeholder internal links',
    'NEVER claim CallBird has features it does not have (e.g., video calling, chat widget, CRM)',
    'NEVER use generic stock blog intro patterns like "In today''s fast-paced world..."',
    'NEVER generate thin content — every section must add substantive value'
  ],

  -- writing_style_examples
  'GOOD EXAMPLE (lead with problem + cost):
"Every missed call costs your dental practice an average of $200-$500 in lost revenue. For a busy practice missing just 5 calls per week, that adds up to $52,000-$130,000 in lost production annually. And here''s the worst part — 85% of callers who reach voicemail never call back. They call the next dentist on Google instead."

GOOD EXAMPLE (feature presentation):
"CallBird answers your phone in 0.5 seconds — before the first ring finishes. It greets callers by your practice name, asks the right qualifying questions, and books appointments directly into your calendar. After every call, you get an SMS summary: who called, what they needed, and what action was taken. No more checking voicemail. No more returning calls. No more lost patients."

BAD EXAMPLE (too salesy, vague):
"Are you tired of missing important business calls? Our amazing AI receptionist is the best solution on the market! Sign up today and watch your business grow!"

BAD EXAMPLE (generic AI slop):
"In today''s rapidly evolving business landscape, leveraging cutting-edge artificial intelligence solutions has become paramount for organizations seeking to optimize their customer engagement strategies."',

  -- cta_templates
  ARRAY[
    'Start your free trial today — call (505) 594-5806 or visit callbirdai.com/start',
    'See CallBird in action: call (505) 594-5806 right now and talk to our AI receptionist',
    'Stop missing calls. Start at $99/month with no contracts. Get started at callbirdai.com',
    'Try CallBird free for 7 days — no credit card required. Visit callbirdai.com/start'
  ],

  -- internal_link_targets
  '[
    {"url": "https://callbirdai.com/", "anchor_context": "homepage, main site, learn more about CallBird"},
    {"url": "https://callbirdai.com/index.html#pricing", "anchor_context": "pricing, plans, cost, how much"},
    {"url": "https://callbirdai.com/index.html#features", "anchor_context": "features, what it does, capabilities"},
    {"url": "https://callbirdai.com/index.html#industries", "anchor_context": "industries served, who uses CallBird"},
    {"url": "https://callbirdai.com/dental", "anchor_context": "dental practices, dentists"},
    {"url": "https://callbirdai.com/legal", "anchor_context": "law firms, lawyers, attorneys, legal"},
    {"url": "https://callbirdai.com/home-services", "anchor_context": "home services, HVAC, plumbing, electrical, contractors"},
    {"url": "https://callbirdai.com/restaurants", "anchor_context": "restaurants, food service"},
    {"url": "https://callbirdai.com/blog.html", "anchor_context": "blog, more articles, read more"}
  ]'::JSONB
);
