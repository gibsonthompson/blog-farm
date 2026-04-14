-- ============================================================
-- SEED: Existing CallBird Blog Posts
-- Run AFTER supabase-schema.sql
-- NOTE: This is a partial list compiled from known posts.
-- The app includes a /api/seed-existing route that scrapes
-- the live sitemap.xml and auto-populates this table.
-- ============================================================

-- Helper variable
DO $$
DECLARE biz_id UUID;
BEGIN
  SELECT id INTO biz_id FROM blog_businesses WHERE slug = 'callbird';

  INSERT INTO blog_existing_posts (business_id, url, title, slug, primary_keyword, category, publish_date) VALUES
  (biz_id, 'https://callbirdai.com/blog-ai-receptionist-guide.html', 'Complete Guide to AI Receptionists for Small Business', 'ai-receptionist-guide', 'AI receptionist guide', 'guide', '2025-12-20'),
  (biz_id, 'https://callbirdai.com/blog-ai-receptionist-cost-pricing-guide.html', 'AI Receptionist Cost & Pricing Guide', 'ai-receptionist-cost-pricing-guide', 'AI receptionist cost', 'cost-analysis', '2025-12-25'),
  (biz_id, 'https://callbirdai.com/blog-ai-receptionist-comparison-2025.html', 'AI Receptionist Comparison 2025', 'ai-receptionist-comparison-2025', 'AI receptionist comparison', 'comparison', '2025-12-26'),
  (biz_id, 'https://callbirdai.com/blog-best-ai-receptionist-dentists.html', 'Best AI Receptionist for Dentists', 'best-ai-receptionist-dentists', 'AI receptionist dentist', 'industry', '2025-12-25'),
  (biz_id, 'https://callbirdai.com/blog-best-ai-receptionist-lawyers.html', 'Best AI Receptionist for Lawyers', 'best-ai-receptionist-lawyers', 'AI receptionist lawyers', 'industry', '2025-12-25'),
  (biz_id, 'https://callbirdai.com/blog-contractors-ai-receptionist.html', 'AI Receptionist for Contractors', 'contractors-ai-receptionist', 'AI receptionist contractors', 'industry', '2025-12-25'),
  (biz_id, 'https://callbirdai.com/blog-callbird-vs-smith-ai.html', 'CallBird vs Smith.ai', 'callbird-vs-smith-ai', 'CallBird vs Smith.ai', 'comparison', '2025-12-25'),
  (biz_id, 'https://callbirdai.com/blog-callbird-vs-ruby-receptionists.html', 'CallBird vs Ruby Receptionists', 'callbird-vs-ruby-receptionists', 'CallBird vs Ruby', 'comparison', '2025-12-25'),
  (biz_id, 'https://callbirdai.com/blog-best-ai-receptionist-property-management.html', 'Best AI Receptionist for Property Management', 'best-ai-receptionist-property-management', 'AI receptionist property management', 'industry', '2026-01-30'),
  (biz_id, 'https://callbirdai.com/blog-best-ai-receptionist-chiropractors.html', 'Best AI Receptionist for Chiropractors', 'best-ai-receptionist-chiropractors', 'AI receptionist chiropractors', 'industry', '2026-01-30'),
  (biz_id, 'https://callbirdai.com/blog-callbird-vs-dialzara.html', 'CallBird vs Dialzara', 'callbird-vs-dialzara', 'CallBird vs Dialzara', 'comparison', '2026-01-30'),
  (biz_id, 'https://callbirdai.com/blog-best-ai-answering-service.html', '7 Best AI Answering Services for Small Business', 'best-ai-answering-service', 'best AI answering service', 'guide', '2026-03-14'),
  (biz_id, 'https://callbirdai.com/blog-about-callbird-ai.html', 'About CallBird AI', 'about-callbird-ai', 'CallBird AI', 'about', '2026-03-14'),
  (biz_id, 'https://callbirdai.com/blog-best-ai-receptionist-hvac.html', 'Best AI Receptionist for HVAC Companies', 'best-ai-receptionist-hvac', 'AI receptionist HVAC', 'industry', '2026-03-14'),
  (biz_id, 'https://callbirdai.com/blog-best-ai-receptionist-plumbers.html', 'Best AI Receptionist for Plumbers', 'best-ai-receptionist-plumbers', 'AI receptionist plumbers', 'industry', '2026-03-14'),
  (biz_id, 'https://callbirdai.com/blog-best-ai-receptionist-electricians.html', 'Best AI Receptionist for Electricians', 'best-ai-receptionist-electricians', 'AI receptionist electricians', 'industry', '2026-03-14'),
  (biz_id, 'https://callbirdai.com/blog-callbird-vs-goodcall.html', 'CallBird vs Goodcall', 'callbird-vs-goodcall', 'CallBird vs Goodcall', 'comparison', '2026-03-14'),
  (biz_id, 'https://callbirdai.com/blog-callbird-vs-aira.html', 'CallBird vs AIRA', 'callbird-vs-aira', 'CallBird vs AIRA', 'comparison', '2026-03-14'),
  (biz_id, 'https://callbirdai.com/blog-hipaa-compliant-ai-receptionist.html', 'HIPAA Compliant AI Receptionist', 'hipaa-compliant-ai-receptionist', 'HIPAA AI receptionist', 'guide', '2026-03-14'),
  (biz_id, 'https://callbirdai.com/blog-best-ai-receptionist-restaurants.html', 'Best AI Receptionist for Restaurants', 'best-ai-receptionist-restaurants', 'AI receptionist restaurants', 'industry', '2026-03-14'),
  (biz_id, 'https://callbirdai.com/blog-ai-receptionist-statistics.html', 'AI Receptionist Statistics 2026', 'ai-receptionist-statistics', 'AI receptionist statistics', 'statistics', '2026-03-14'),
  (biz_id, 'https://callbirdai.com/blog-callbird-vs-my-ai-front-desk.html', 'CallBird vs My AI Front Desk', 'callbird-vs-my-ai-front-desk', 'CallBird vs My AI Front Desk', 'comparison', '2026-03-28'),
  (biz_id, 'https://callbirdai.com/blog-callbird-vs-upfirst.html', 'CallBird vs Upfirst', 'callbird-vs-upfirst', 'CallBird vs Upfirst', 'comparison', '2026-03-28'),
  (biz_id, 'https://callbirdai.com/blog-stop-missing-business-calls.html', 'How to Stop Missing Business Calls Forever', 'stop-missing-business-calls', 'stop missing business calls', 'how-to', '2026-03-28'),
  (biz_id, 'https://callbirdai.com/blog-receptionist-cost-vs-ai.html', 'Cost of Hiring a Receptionist vs AI Receptionist', 'receptionist-cost-vs-ai', 'receptionist cost vs AI', 'cost-analysis', '2026-03-28'),
  (biz_id, 'https://callbirdai.com/blog-callbird-vs-rosie.html', 'CallBird vs Rosie AI', 'callbird-vs-rosie', 'CallBird vs Rosie', 'comparison', '2026-01-09'),
  (biz_id, 'https://callbirdai.com/blog-ai-receptionist-vs-chatbot.html', 'AI Receptionist vs Chatbot: What is the Difference?', 'ai-receptionist-vs-chatbot', 'AI receptionist vs chatbot', 'guide', '2026-04-08'),
  (biz_id, 'https://callbirdai.com/blog-how-to-set-up-ai-receptionist.html', 'How to Set Up an AI Receptionist in 10 Minutes', 'how-to-set-up-ai-receptionist', 'how to set up AI receptionist', 'how-to', '2026-04-08')
  ON CONFLICT (business_id, slug) DO NOTHING;

END $$;
