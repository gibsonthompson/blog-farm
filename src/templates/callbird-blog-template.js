/**
 * CallBird Blog Post HTML Template
 * Extracted from actual live blog posts (blog-about-callbird-ai.html, blog-callbird-vs-aira.html)
 * 
 * The generation engine injects this template into the Claude prompt.
 * Claude fills in the {{PLACEHOLDERS}} while keeping structure identical.
 * 
 * NOTE: The full inline CSS is included because each blog post is a standalone
 * HTML file — it does NOT reference styles.css.
 */

export const CALLBIRD_BLOG_CSS = `
        :root {
            --primary-color: #122092; --primary-hover: #0d1666; --accent-color: #f6b828;
            --text-dark: #1f2937; --text-medium: #4b5563; --text-light: #6b7280;
            --bg-light: #f9f9f7; --bg-white: #ffffff; --border-color: #e5e7eb;
            --success-color: #10b981; --error-color: #ef4444;
            --font-primary: 'Sora', sans-serif; --font-secondary: 'Inter', sans-serif;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: var(--font-secondary); color: var(--text-dark); line-height: 1.7; background: var(--bg-white); }

        .navbar { position: fixed; top: 0; left: 0; right: 0; z-index: 1000; background: rgba(255,255,255,0.95); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border-color); padding: 1rem 0; }
        .nav-content { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; display: flex; align-items: center; justify-content: space-between; }
        .logo-image { height: 50px; width: auto; }
        .nav-links { display: flex; gap: 2rem; list-style: none; }
        .nav-links a { color: var(--text-dark); text-decoration: none; font-weight: 500; font-size: 0.95rem; }
        .nav-links a:hover { color: var(--primary-color); }
        .nav-actions { display: flex; gap: 1rem; align-items: center; }
        .btn-primary { background: var(--primary-color); color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: 600; font-size: 0.95rem; display: inline-block; transition: background 0.3s; }
        .btn-primary:hover { background: var(--primary-hover); color: white; }
        .mobile-menu-toggle { display: none; flex-direction: column; gap: 0.25rem; background: none; border: none; cursor: pointer; padding: 0.5rem; }
        .mobile-menu-toggle span { width: 24px; height: 2px; background: var(--text-dark); }

        .blog-hero { background: linear-gradient(135deg, var(--primary-color) 0%, #1a2fb8 100%); color: white; padding: 7rem 1.5rem 3rem; text-align: center; }
        .hero-category { display: inline-block; background: rgba(255,255,255,0.2); padding: 0.4rem 1rem; border-radius: 2rem; font-size: 0.85rem; font-weight: 600; margin-bottom: 1.25rem; letter-spacing: 0.05em; }
        .blog-hero h1 { font-family: var(--font-primary); font-size: clamp(1.75rem, 4vw, 2.75rem); font-weight: 800; margin-bottom: 1rem; line-height: 1.2; max-width: 800px; margin-left: auto; margin-right: auto; }
        .hero-meta { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; font-size: 0.95rem; opacity: 0.9; }

        .article-container { max-width: 820px; margin: 0 auto; padding: 3rem 1.5rem; }
        .article-container h2 { font-family: var(--font-primary); font-size: clamp(1.4rem, 3vw, 1.85rem); font-weight: 700; margin: 2.5rem 0 1rem; color: var(--text-dark); line-height: 1.3; padding-top: 1rem; }
        .article-container h3 { font-family: var(--font-primary); font-size: clamp(1.1rem, 2.5vw, 1.35rem); font-weight: 700; margin: 2rem 0 0.75rem; color: var(--text-dark); }
        .article-container h4 { font-family: var(--font-primary); font-size: 1.1rem; font-weight: 700; margin: 1.5rem 0 0.5rem; }
        .article-container p { color: var(--text-medium); margin-bottom: 1.25rem; font-size: 1.05rem; }
        .article-container ul, .article-container ol { color: var(--text-medium); margin: 0 0 1.25rem 1.5rem; font-size: 1.05rem; }
        .article-container li { margin-bottom: 0.5rem; }
        .article-container strong { color: var(--text-dark); }
        .article-container a { color: var(--primary-color); text-decoration: underline; }
        .article-container a:hover { color: var(--primary-hover); }

        .quick-answer { background: linear-gradient(135deg, rgba(18,32,146,0.06) 0%, rgba(18,32,146,0.02) 100%); border-left: 4px solid var(--primary-color); border-radius: 0 0.75rem 0.75rem 0; padding: 1.5rem 1.75rem; margin: 0 0 2rem; }
        .quick-answer-label { font-family: var(--font-primary); font-weight: 700; font-size: 0.85rem; color: var(--primary-color); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
        .quick-answer p { color: var(--text-dark); margin-bottom: 0.5rem; font-size: 1rem; }
        .quick-answer p:last-child { margin-bottom: 0; }

        .aeo-answer { background: var(--bg-light); border-radius: 0.5rem; padding: 1rem 1.25rem; margin-bottom: 1.25rem; border: 1px solid var(--border-color); }
        .aeo-answer p { color: var(--text-dark); font-weight: 500; margin-bottom: 0; font-size: 1rem; }

        .table-wrap { overflow-x: auto; margin: 1.5rem 0 2rem; border-radius: 0.75rem; border: 1px solid var(--border-color); }
        .table-wrap table { width: 100%; border-collapse: collapse; min-width: 600px; font-size: 0.95rem; }
        .table-wrap thead { background: var(--text-dark); color: white; }
        .table-wrap th { padding: 1rem 0.75rem; text-align: left; font-weight: 700; font-size: 0.9rem; }
        .table-wrap td { padding: 0.85rem 0.75rem; border-bottom: 1px solid var(--border-color); color: var(--text-medium); }
        .table-wrap tbody tr:hover { background: rgba(18,32,146,0.03); }
        .table-wrap .hl { background: rgba(18,32,146,0.08); font-weight: 600; color: var(--text-dark); }
        .table-wrap thead .hl { background: var(--primary-color); }

        .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1.5rem; margin: 2rem 0; }
        .stat-box { text-align: center; padding: 1.25rem; background: var(--bg-light); border-radius: 0.75rem; }
        .stat-number { font-family: var(--font-primary); font-size: 2rem; font-weight: 800; color: var(--primary-color); display: block; }
        .stat-label { font-size: 0.85rem; color: var(--text-light); font-weight: 600; margin-top: 0.25rem; }

        .cta-box { background: linear-gradient(135deg, var(--primary-color) 0%, #1a2fb8 100%); color: white; padding: 2.5rem; border-radius: 1rem; text-align: center; margin: 2.5rem 0; }
        .cta-box h3 { font-family: var(--font-primary); font-size: 1.5rem; color: white; margin-bottom: 0.75rem; }
        .cta-box p { color: rgba(255,255,255,0.9); margin-bottom: 1.5rem; font-size: 1.05rem; }
        .cta-box .btn-accent { background: var(--accent-color); color: var(--text-dark); padding: 0.875rem 2rem; border-radius: 0.5rem; text-decoration: none; font-weight: 700; font-size: 1.05rem; display: inline-block; }
        .cta-box .btn-accent:hover { background: #e5a615; color: var(--text-dark); }
        .cta-sub { font-size: 0.9rem; color: rgba(255,255,255,0.7); margin-top: 0.75rem; }

        .callout { background: rgba(246,184,40,0.1); border-left: 4px solid var(--accent-color); padding: 1.25rem 1.5rem; border-radius: 0 0.5rem 0.5rem 0; margin: 1.5rem 0; }
        .callout p { color: var(--text-dark); margin-bottom: 0.25rem; font-size: 0.95rem; }

        .faq-section { margin: 2.5rem 0; }
        .faq-item { background: var(--bg-light); border-radius: 0.75rem; margin-bottom: 0.75rem; overflow: hidden; }
        .faq-question { width: 100%; padding: 1.25rem 1.5rem; background: none; border: none; text-align: left; font-family: var(--font-primary); font-size: 1.05rem; font-weight: 600; color: var(--text-dark); cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
        .faq-question:hover { color: var(--primary-color); }
        .faq-icon { font-size: 1.5rem; color: var(--primary-color); transition: transform 0.3s; }
        .faq-item.active .faq-icon { transform: rotate(45deg); }
        .faq-answer { max-height: 0; overflow: hidden; transition: max-height 0.35s ease; }
        .faq-item.active .faq-answer { max-height: 600px; }
        .faq-answer-inner { padding: 0 1.5rem 1.25rem; }
        .faq-answer-inner p { font-size: 1rem; color: var(--text-medium); margin-bottom: 0.5rem; }

        .related-posts { margin: 3rem 0 1rem; }
        .related-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; }
        .related-card { background: var(--bg-light); border-radius: 0.75rem; padding: 1.25rem; text-decoration: none; transition: all 0.3s; }
        .related-card:hover { background: rgba(18,32,146,0.06); transform: translateY(-2px); }
        .related-card h4 { font-size: 0.95rem; color: var(--text-dark); margin-bottom: 0.5rem; line-height: 1.4; }
        .related-card p { font-size: 0.85rem; color: var(--text-light); margin-bottom: 0; }

        .footer { background: #122092 !important; color: #fff !important; padding: 2.5rem 1.5rem 2rem; margin-top: 3rem; }
        .footer a { color: rgba(255,255,255,0.85) !important; }
        .footer a:hover { color: #fff !important; }
        .footer h4 { color: #f6b828 !important; }
        .footer-tagline { color: rgba(255,255,255,0.7) !important; }
        .footer-bottom { border-top-color: rgba(255,255,255,0.15) !important; color: rgba(255,255,255,0.6) !important; }
        .footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 3rem; margin-bottom: 3rem; text-align: left; }
        .footer-col h4 { margin-bottom: 1rem; }
        .footer-links { list-style: none; }
        .footer-links li { margin-bottom: 0.75rem; }
        .footer-links a { font-size: 0.95rem; }
        .footer-bottom { padding-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.1); text-align: center; font-size: 0.9rem; }
        .footer-bottom p { margin-bottom: 0.25rem; }
        .footer-logo .logo-image { height: 50px; }

        @media (max-width: 968px) { .nav-links { display: none; } .mobile-menu-toggle { display: flex; } .footer-grid { grid-template-columns: 1fr 1fr; gap: 2rem; } }
        @media (max-width: 768px) {
            .blog-hero { padding: 6rem 1rem 2.5rem; }
            .article-container { padding: 2rem 1rem; }
            .cta-box { padding: 2rem 1.5rem; }
            .stats-row { grid-template-columns: repeat(2, 1fr); }
            .related-grid { grid-template-columns: 1fr; }
            .footer-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 480px) { .logo-image { height: 35px; } .btn-primary { padding: 0.6rem 1rem; font-size: 0.85rem; } }`;

export const CALLBIRD_NAV_HTML = `    <nav class="navbar">
        <div class="nav-content">
            <a href="index.html"><img src="https://i.imgur.com/qwyQQW5.png" alt="CallBird AI" class="logo-image"></a>
            <ul class="nav-links">
                <li><a href="index.html#features">Features</a></li>
                <li><a href="index.html#pricing">Pricing</a></li>
                <li><a href="index.html#industries">Industries</a></li>
                <li><a href="blog.html">Blog</a></li>
            </ul>
            <div class="nav-actions">
                <a href="/start" class="btn-primary">Start Free Trial</a>
                <button class="mobile-menu-toggle" aria-label="Toggle menu"><span></span><span></span><span></span></button>
            </div>
        </div>
    </nav>`;

export const CALLBIRD_FOOTER_HTML = `    <footer class="footer">
        <div class="container">
            <div class="footer-grid">
                <div class="footer-col">
                    <div class="footer-logo"><img src="https://i.imgur.com/qwyQQW5.png" alt="CallBird" class="logo-image"></div>
                    <p class="footer-tagline">AI-powered call answering, appointment booking & instant summaries for small businesses.</p>
                    <div class="footer-contact"><p>Atlanta, GA</p><p><a href="tel:+15055945806">(505) 594-5806</a></p><p><a href="mailto:support@callbirdai.com">support@callbirdai.com</a></p></div>
                </div>
                <div class="footer-col"><h4>Product</h4><ul class="footer-links"><li><a href="index.html#features">Features</a></li><li><a href="index.html#pricing">Pricing</a></li><li><a href="index.html#industries">Industries</a></li><li><a href="blog.html">Blog</a></li></ul></div>
                <div class="footer-col"><h4>Industries</h4><ul class="footer-links"><li><a href="home-services-ai-receptionist.html">Home Services</a></li><li><a href="dental-ai-receptionist.html">Medical & Dental</a></li><li><a href="restaurants-ai-receptionist.html">Restaurants</a></li><li><a href="legal-ai-receptionist.html">Legal</a></li><li><a href="professional-services-ai-receptionist.html">Professional Services</a></li><li><a href="retail-ai-receptionist.html">Retail</a></li><li><a href="veterinary-ai-receptionist.html">Veterinary</a></li></ul></div>
                <div class="footer-col"><h4>Company</h4><ul class="footer-links"><li><a href="mailto:support@callbirdai.com">Contact</a></li><li><a href="blog.html">Blog</a></li><li><a href="https://myvoiceaiconnect.com" target="_blank" rel="noopener">White Label</a></li><li><a href="privacy-policy.html">Privacy Policy</a></li><li><a href="terms-and-conditions.html">Terms & Conditions</a></li></ul></div>
            </div>
            <div class="footer-bottom"><p>&copy; 2026 CallBird AI. All Rights Reserved.</p><p>A2P 10DLC Compliant &bull; SOC 2 Type II Certified</p></div>
        </div>
    </footer>`;

export const CALLBIRD_FAQ_SCRIPT = `    <script>
        document.querySelectorAll('.faq-question').forEach(b => {
            b.addEventListener('click', () => {
                const item = b.parentElement;
                const was = item.classList.contains('active');
                document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
                if (!was) item.classList.add('active');
            });
        });
    </script>`;

/**
 * Available CSS component classes the AI can use in article content:
 * 
 * .quick-answer          — Blue-left-border box at top with "Quick Answer" label
 * .aeo-answer            — Light gray box for AEO-optimized summary answers under H2s
 * .table-wrap > table    — Responsive comparison tables (use .hl for CallBird column highlight)
 * .stats-row > .stat-box — Grid of stat cards with .stat-number and .stat-label
 * .cta-box               — Blue gradient CTA box with .btn-accent button
 * .callout               — Yellow-left-border callout/tip box
 * .faq-section           — FAQ accordion (use .faq-item > .faq-question + .faq-answer)
 * .related-posts         — Related articles grid with .related-card links
 * .provider-card         — Provider/competitor card with .pros-cons grid
 */

export const TEMPLATE_INSTRUCTIONS = `
You MUST use this exact HTML structure for the blog post. Do NOT deviate from it.

STRUCTURE (in order):
1. <!DOCTYPE html> + <html lang="en">
2. <head> with:
   - GTM script (GTM-M9WVK3WD)
   - Meta charset + viewport
   - <title> tag (under 60 chars)
   - Meta description (under 160 chars)
   - Meta keywords
   - Canonical URL: https://callbirdai.com/blog-{slug}.html
   - OG tags (title, description, type=article, url)
   - Article JSON-LD schema
   - FAQPage JSON-LD schema (3-5 questions minimum)
   - Google Fonts preconnect + Sora + Inter import
   - <style> block with the EXACT CSS provided (copy it verbatim)
3. <body> with:
   - GTM noscript iframe
   - Nav (copy exactly from template)
   - .blog-hero section with .hero-category, h1, .hero-meta
   - <article class="article-container"> with content
   - Footer (copy exactly from template)
   - FAQ toggle script

INSIDE THE ARTICLE, use these components:
- Start with .quick-answer box (every post)
- Use .aeo-answer boxes under major H2s (for AEO optimization)
- Use .table-wrap for comparison tables (highlight CallBird column with .hl class)
- Use .stats-row for statistics displays
- Use .cta-box for mid-article and end-article CTAs
- Use .callout for tips and key insights
- End with .faq-section (accordion FAQ, 3-5 items)
- End with .related-posts grid (3-4 related articles)

CRITICAL RULES:
- The nav HTML, footer HTML, CSS, and FAQ script must be EXACT copies — do not modify them
- Every post must have the blue gradient hero, not a plain header
- The hero-category span should have an emoji + category name
- The hero-meta should show date, read time, and "By CallBird Team"
- All internal links use relative paths (e.g., "blog-callbird-vs-smith-ai.html")
- Phone number in CTAs: (505) 594-5806
- CTA buttons link to /start
`;