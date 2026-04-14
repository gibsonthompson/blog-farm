# Blog Automation System

Automated blog post generation, quality control, and publishing pipeline for CallBird AI. Press a button → AI generates a blog post → review it → approve → auto-deploys to live website, updates blog index, updates sitemap, submits to Google & Bing.

## Architecture

```
[Dashboard UI] → [Generate API] → [Claude API: content generation]
                                 → [Claude API: quality control]
                                 → [Save to Supabase as "pending"]
                                 
[Dashboard UI] → [Approve API]  → [GitHub API: commit 3 files in 1 commit]
                                   ├── blog-{slug}.html (new post)
                                   ├── blog.html (updated index with new card)
                                   └── sitemap.xml (updated with new URL)
                                 → [Vercel auto-deploys ~30 seconds]
                                 → [Google Search Console: submit sitemap]
                                 → [IndexNow: notify Bing/Yandex/DuckDuckGo]
```

## Quick Start

### 1. Clone & Install

```bash
git clone <this-repo>
cd blog-automation
npm install
```

### 2. Environment Variables

```bash
cp .env.template .env.local
# Fill in all values — see .env.template for instructions
```

### 3. Database Setup

Run these SQL files in your Supabase SQL Editor (in order):

```
1. supabase-schema.sql     — Creates all tables
2. seed-existing-posts.sql — Seeds known existing CallBird posts
```

### 4. One-Time Setup Tasks

**GitHub Token:**
- Go to https://github.com/settings/tokens
- Create fine-grained token with Contents:write on `callbird-site` repo

**Google Cloud / Search Console:**
- Create project at https://console.cloud.google.com
- Enable "Google Search Console API" in API Library
- Create Service Account → download JSON key
- Add service account email as Owner in Google Search Console
- Encode key: `cat key.json | base64 | tr -d '\n'`

**IndexNow:**
```bash
# Generate key
openssl rand -hex 16
# Output example: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6

# Create key file and commit to callbird-site repo root
echo "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" > a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.txt
# Upload this file to the GitHub repo root
```

**Blog.html Insertion Marker:**
Add this HTML comment to `blog.html` in the callbird-site repo, right after the posts-grid opening div:
```html
<div class="posts-grid">
    <!-- NEW_POSTS_INSERTION_POINT -->
    <!-- existing post cards below -->
```

### 5. Seed Existing Posts from Live Sitemap

After the app is running, hit this endpoint once to auto-populate existing posts:
```
GET http://localhost:3100/api/seed-existing?business=callbird
```

### 6. Run

```bash
npm run dev
# Opens at http://localhost:3100
```

## Usage

1. Enter a target keyword (e.g., "AI receptionist for auto repair shops")
2. Select post type (Industry, Comparison, How-To, etc.)
3. Click "Generate Blog Post" — takes ~30-60 seconds
4. Review the QC scores and preview the HTML
5. Click "Approve & Publish" — deploys to live site in ~30 seconds
6. Post is live, sitemap updated, Google/Bing notified

## File Structure

```
src/
├── app/
│   ├── page.js                        # Dashboard UI
│   ├── layout.js                      # Root layout
│   └── api/
│       ├── generate/route.js          # Generate + QC pipeline
│       ├── approve/route.js           # Publish pipeline
│       ├── reject/route.js            # Reject a post
│       ├── posts/route.js             # List/delete posts
│       ├── posts/[id]/route.js        # Get single post (preview)
│       └── seed-existing/route.js     # Scrape sitemap → populate DB
└── lib/
    ├── supabase.js                    # Supabase client
    ├── claude.js                      # Generation engine (prompt construction + API)
    ├── quality-control.js             # QC review (separate Claude call)
    ├── publish.js                     # Full publish pipeline orchestrator
    ├── github.js                      # GitHub API (multi-file single commit)
    ├── google-search-console.js       # GSC sitemap + URL inspection
    └── indexnow.js                    # IndexNow for Bing/Yandex
```

## Multi-Business (Future)

Add a new business by inserting into `blog_businesses` and `blog_brand_kits`.
All queries filter by `business_id` — data is fully isolated.
No code changes needed, just data.

## Deployment

Deploy to Vercel (same account as CallBird):
```bash
vercel --prod
```

Add custom domain in Vercel settings (e.g., blog.gorocketsolutions.com).
