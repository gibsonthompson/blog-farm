'use client';
import { useState, useEffect, useCallback } from 'react';

const BUSINESSES = [
  { slug: 'callbird', name: 'CallBird AI', color: '#F6B828', bg: '#122092', domain: 'callbirdai.com', linkFormat: 'static' },
  { slug: 'voiceai-connect', name: 'VoiceAI Connect', color: '#10b981', bg: '#064E3B', domain: 'myvoiceaiconnect.com', linkFormat: 'nextjs' },
  { slug: 'gtc-group', name: 'The GTC Group', color: '#c9a227', bg: '#0f172a', domain: 'globaltransportconsultinggroup.com', linkFormat: 'nextjs' },
  { slug: 'rsa', name: 'RSA', color: '#84d2f2', bg: '#273373', domain: 'waterhelpme.com', linkFormat: 'nextjs' },
  { slug: 'jb-lawn', name: 'JB Lawn Care', color: '#6BBF1A', bg: '#1a3a0a', domain: 'jblawncareandhauling.com', linkFormat: 'nextjs' },
];

const STATUS_COLORS = {
  pending: { bg: '#FEF3C7', text: '#92400E', label: 'Pending Review' },
  approved: { bg: '#D1FAE5', text: '#065F46', label: 'Approved' },
  published: { bg: '#DBEAFE', text: '#1E40AF', label: 'Published' },
  rejected: { bg: '#FEE2E2', text: '#991B1B', label: 'Rejected' },
  revision_needed: { bg: '#FDE68A', text: '#78350F', label: 'Needs Revision' },
  failed: { bg: '#FEE2E2', text: '#991B1B', label: 'Failed' },
};

const POST_TYPES = [
  { value: 'industry', label: 'Industry Guide', desc: 'AI Receptionist for [Industry]' },
  { value: 'comparison', label: 'Competitor Comparison', desc: 'vs [Competitor]' },
  { value: 'how-to', label: 'How-To Guide', desc: 'How to [Solve Problem]' },
  { value: 'statistics', label: 'Statistics & Data', desc: 'Data-driven post with numbers' },
  { value: 'guide', label: 'Comprehensive Guide', desc: 'Definitive resource on a topic' },
  { value: 'cost-analysis', label: 'Cost Analysis', desc: 'ROI and cost comparison' },
  { value: 'about', label: 'Brand / AEO', desc: 'AEO-optimized brand awareness' },
  { value: 'cost-reduction', label: 'Cost Reduction', desc: 'Cost savings analysis' },
  { value: 'revenue-growth', label: 'Revenue Growth', desc: 'Revenue optimization' },
  { value: 'brand-marketing', label: 'Brand & Marketing', desc: 'Online presence & branding' },
  { value: 'industry-analysis', label: 'Industry Analysis', desc: 'Market trends & outlook' },
];

const STEP_COSTS = {
  research: { est: 0.05, label: 'Research + Web Search' },
  write: { est: 0.35, label: 'Write Content + Thinking' },
  template_static: { est: 0.25, label: 'HTML Template Wrap' },
  template_nextjs: { est: 0.00, label: 'Metadata Extract (no API)' },
  qc: { est: 0.15, label: 'Quality Control + Thinking' },
};

export default function Dashboard() {
  const [activeBiz, setActiveBiz] = useState(BUSINESSES[0]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(null);
  const [previewId, setPreviewId] = useState(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [genResult, setGenResult] = useState(null);
  const [error, setError] = useState(null);
  const [recs, setRecs] = useState(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [runCost, setRunCost] = useState(0);
  const [expandedNotes, setExpandedNotes] = useState(null);

  const [keyword, setKeyword] = useState('');
  const [postType, setPostType] = useState('guide');
  const [notes, setNotes] = useState('');

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/posts?business=${activeBiz.slug}`);
      const data = await res.json();
      setPosts(data.posts || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeBiz.slug]);

  useEffect(() => {
    fetchPosts();
    setRecs(null);
    setGenResult(null);
    setRunCost(0);
    setExpandedNotes(null);
  }, [fetchPosts]);

  function switchBusiness(slug) {
    const biz = BUSINESSES.find(b => b.slug === slug);
    if (biz) setActiveBiz(biz);
  }

  async function fetchRecommendations() {
    setRecsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/keywords?recommend=true&count=8&business=${activeBiz.slug}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRecs(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setRecsLoading(false);
    }
  }

  function useRecommendation(rec) {
    setKeyword(rec.target_keyword);
    setPostType(rec.post_type);
    setNotes(rec.notes || '');
    setGenResult(null);
    setRunCost(0);
    document.getElementById('generate-section')?.scrollIntoView({ behavior: 'smooth' });
  }

  const [genStep, setGenStep] = useState('');

  async function callStep(action, body) {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, businessSlug: activeBiz.slug, ...body }),
    });
    let data;
    try {
      const text = await res.text();
      data = JSON.parse(text);
    } catch {
      throw new Error(`Step "${action}" returned invalid response (HTTP ${res.status})`);
    }
    if (!res.ok) throw new Error(data.error || data.reason || `Step "${action}" failed (HTTP ${res.status})`);
    return data;
  }

  async function handleGenerate(e) {
    e.preventDefault();
    if (!keyword.trim()) return;
    setGenerating(true);
    setError(null);
    setGenResult(null);
    setGenStep('');
    setRunCost(0);
    let totalCost = 0;

    try {
      setGenStep('🔍 Researching topic & finding real statistics...');
      const step1 = await callStep('research', {
        targetKeyword: keyword.trim(), postType, notes: notes.trim(),
      });
      totalCost += STEP_COSTS.research.est;
      setRunCost(totalCost);
      const postId = step1.postId;

      setGenStep(`✍️ Writing content (${step1.research?.verifiedStats || 0} verified stats, ${step1.research?.gaps || 0} gaps found)...`);
      await callStep('write', { postId });
      totalCost += STEP_COSTS.write.est;
      setRunCost(totalCost);

      const templateKey = activeBiz.linkFormat === 'nextjs' ? 'template_nextjs' : 'template_static';
      setGenStep(activeBiz.linkFormat === 'nextjs' ? '📦 Extracting metadata...' : '🏗️ Building HTML & running validation...');
      const step3 = await callStep('template', { postId });
      totalCost += STEP_COSTS[templateKey].est;
      setRunCost(totalCost);

      if (step3.validation && !step3.validation.valid) {
        setGenResult({ ...step3, qc: null, validationFailed: true, cost: totalCost });
        setKeyword('');
        setNotes('');
        fetchPosts();
        return;
      }

      if (step3.dedup && !step3.dedup.unique) {
        setGenResult({ ...step3, qc: null, dedupFailed: true, cost: totalCost });
        setKeyword('');
        setNotes('');
        fetchPosts();
        return;
      }

      setGenStep('✅ Running quality control (32 checks)...');
      const step4 = await callStep('qc', { postId });
      totalCost += STEP_COSTS.qc.est;
      setRunCost(totalCost);

      setGenResult({ ...step4, cost: totalCost });
      setKeyword('');
      setNotes('');
      fetchPosts();
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
      setGenStep('');
    }
  }

  async function handleApprove(postId) {
    if (!confirm('Publish this post? This will deploy to the live website.')) return;
    setPublishing(postId);
    setError(null);
    try {
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchPosts();
    } catch (e) {
      setError(e.message);
    } finally {
      setPublishing(null);
    }
  }

  async function handleReject(postId) {
    if (!confirm('Reject this post?')) return;
    try {
      await fetch('/api/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId }),
      });
      fetchPosts();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handlePreview(postId) {
    try {
      const res = await fetch(`/api/posts/${postId}`);
      const data = await res.json();
      setPreviewHtml(data.html_content);
      setPreviewId(postId);
    } catch (e) {
      setError(e.message);
    }
  }

  function getLiveUrl(post) {
    if (activeBiz.linkFormat === 'nextjs') {
      return `https://${activeBiz.domain}/blog/${post.slug}`;
    }
    return `https://${activeBiz.domain}/blog-${post.slug}.html`;
  }

  function parseQcNotes(post) {
    const result = { heldReason: null, hallucinations: [], bizFlags: [], validationErrors: [], scores: null };
    
    // From qc_score (set by autopilot)
    if (post.qc_score) {
      result.hallucinations = post.qc_score.hallucination_flags || [];
      result.bizFlags = post.qc_score.business_protection_flags || [];
      result.scores = post.qc_score.scores || post.qc_score;
    }

    // From qc_notes (JSON string with held_reason, validation_errors, etc.)
    if (post.qc_notes) {
      try {
        const notes = typeof post.qc_notes === 'string' ? JSON.parse(post.qc_notes) : post.qc_notes;
        result.heldReason = notes.held_reason || null;
        result.validationErrors = notes.validation_errors || [];
        if (notes.scores) result.scores = notes.scores;
      } catch { /* ignore parse errors */ }
    }

    return result;
  }

  const publishedCount = posts.filter(p => p.status === 'published').length;
  const pendingCount = posts.filter(p => ['pending', 'revision_needed'].includes(p.status)).length;

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <h1 style={styles.logo}>Blog Automation</h1>
            <div style={styles.bizSelector}>
              {BUSINESSES.map(biz => (
                <button
                  key={biz.slug}
                  onClick={() => switchBusiness(biz.slug)}
                  style={{
                    ...styles.bizTab,
                    background: activeBiz.slug === biz.slug ? biz.bg : 'transparent',
                    color: activeBiz.slug === biz.slug ? biz.color : '#64748B',
                    borderColor: activeBiz.slug === biz.slug ? biz.color : '#334155',
                  }}
                >
                  {biz.name}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 12, color: '#64748B', textAlign: 'right' }}>
              <div>{activeBiz.domain}</div>
              <div>{activeBiz.linkFormat === 'nextjs' ? 'Next.js ISR' : 'Static HTML'}</div>
            </div>
            <span style={{ ...styles.badge, background: activeBiz.bg, color: activeBiz.color }}>{activeBiz.name}</span>
          </div>
        </div>
      </header>

      <main style={styles.main}>
        {/* Quick Stats */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={styles.statBox}>
            <div style={styles.statNum}>{posts.length}</div>
            <div style={styles.statLabel}>Generated</div>
          </div>
          <div style={styles.statBox}>
            <div style={{ ...styles.statNum, color: '#34D399' }}>{publishedCount}</div>
            <div style={styles.statLabel}>Published</div>
          </div>
          <div style={styles.statBox}>
            <div style={{ ...styles.statNum, color: '#FBBF24' }}>{pendingCount}</div>
            <div style={styles.statLabel}>Pending</div>
          </div>
          {runCost > 0 && (
            <div style={styles.statBox}>
              <div style={{ ...styles.statNum, color: '#F87171' }}>${runCost.toFixed(2)}</div>
              <div style={styles.statLabel}>Last Run Cost</div>
            </div>
          )}
        </div>

        {/* AI Strategy Section */}
        <section style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={styles.cardTitle}>Content Strategy — {activeBiz.name}</h2>
            <button onClick={fetchRecommendations} style={{ ...styles.generateBtn, background: activeBiz.bg }} disabled={recsLoading}>
              {recsLoading ? '⏳ Analyzing Gaps...' : '🧠 Get AI Recommendations'}
            </button>
          </div>

          {recs && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={styles.statBox}>
                  <div style={styles.statNum}>{recs.existingCount}</div>
                  <div style={styles.statLabel}>Total Posts</div>
                </div>
                {recs.totalOpportunities !== null && (
                  <div style={styles.statBox}>
                    <div style={styles.statNum}>{recs.totalOpportunities}</div>
                    <div style={styles.statLabel}>Gaps Found</div>
                  </div>
                )}
                {recs.coverage && Object.entries(recs.coverage).map(([cat, data]) => (
                  <div key={cat} style={styles.statBox}>
                    <div style={{ ...styles.statNum, fontSize: 18, color: data.coveragePercent > 60 ? '#34D399' : data.coveragePercent > 30 ? '#FBBF24' : '#F87171' }}>
                      {data.coveragePercent}%
                    </div>
                    <div style={styles.statLabel}>{cat.replace(/([A-Z])/g, ' $1').trim()}</div>
                  </div>
                ))}
              </div>

              {recs.recommendations && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {recs.recommendations.map((rec, i) => (
                    <div key={i} style={{ ...styles.recRow, borderLeft: `3px solid ${rec.business_impact === 'high' ? '#34D399' : rec.business_impact === 'medium' ? '#FBBF24' : '#64748B'}` }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={styles.rankBadge}>#{rec.rank}</span>
                          <strong style={{ fontSize: 14, color: '#F8FAFC' }}>{rec.title}</strong>
                          <span style={{ fontSize: 11, background: '#334155', padding: '2px 6px', borderRadius: 4, color: '#94A3B8' }}>{rec.post_type}</span>
                          <span style={{ fontSize: 11, background: rec.business_impact === 'high' ? '#064E3B' : '#1E293B', padding: '2px 6px', borderRadius: 4, color: rec.business_impact === 'high' ? '#34D399' : '#94A3B8' }}>{rec.business_impact}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.4 }}>
                          <span style={{ color: '#CBD5E1' }}>Keyword:</span> {rec.target_keyword} — {rec.reasoning}
                        </div>
                      </div>
                      <button onClick={() => useRecommendation(rec)} style={{ ...styles.useRecBtn, background: activeBiz.bg, color: activeBiz.color }}>
                        ⚡ Generate
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {!recs && !recsLoading && (
            <p style={{ color: '#64748B', fontSize: 14, margin: 0 }}>
              Analyze content gaps and get prioritized topic recommendations for {activeBiz.name}.
            </p>
          )}
        </section>

        {/* Generate Section */}
        <section id="generate-section" style={styles.card}>
          <h2 style={styles.cardTitle}>Generate New Post</h2>
          <form onSubmit={handleGenerate} style={styles.form}>
            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Target Keyword</label>
                <input
                  style={styles.input}
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  placeholder="e.g., reduce AI receptionist client churn rate"
                  disabled={generating}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Post Type</label>
                <select style={styles.select} value={postType} onChange={e => setPostType(e.target.value)} disabled={generating}>
                  {POST_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label} — {t.desc}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Additional Notes (optional)</label>
              <textarea
                style={{ ...styles.input, minHeight: 60, resize: 'vertical' }}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any specific instructions, angles, or data to include..."
                disabled={generating}
              />
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button type="submit" style={{ ...styles.generateBtn, background: activeBiz.bg }} disabled={generating || !keyword.trim()}>
                {generating ? (genStep || '⏳ Starting...') : `⚡ Generate for ${activeBiz.name}`}
              </button>
              {generating && runCost > 0 && (
                <span style={{ fontSize: 13, color: '#94A3B8' }}>Est. cost so far: ${runCost.toFixed(2)}</span>
              )}
            </div>
          </form>

          {!generating && runCost > 0 && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#0F172A', borderRadius: 6, fontSize: 12, color: '#64748B' }}>
              💰 Estimated run cost: <strong style={{ color: '#F8FAFC' }}>${runCost.toFixed(2)}</strong>
              {' '}({Object.entries(STEP_COSTS).filter(([k]) => {
                if (k === 'template_static') return activeBiz.linkFormat !== 'nextjs';
                if (k === 'template_nextjs') return activeBiz.linkFormat === 'nextjs';
                return true;
              }).map(([, v]) => `${v.label}: $${v.est.toFixed(2)}`).join(' + ')})
            </div>
          )}

          {genResult && (
            <div style={{ ...styles.resultBox, background: genResult.validationFailed || genResult.dedupFailed ? '#7F1D1D' : '#064E3B' }}>
              {genResult.dedupFailed ? (
                <>
                  <strong style={{ color: '#FCA5A5' }}>⚠️ Duplicate Detected:</strong> {genResult.dedup?.recommendation}
                  <div style={{ marginTop: 4, fontSize: 13, color: '#FECACA' }}>
                    Slug &quot;{genResult.post?.slug}&quot; already exists. Try a different keyword angle.
                  </div>
                </>
              ) : genResult.validationFailed ? (
                <>
                  <strong style={{ color: '#FCA5A5' }}>⛔ Validation Failed:</strong> {genResult.post?.title}
                  <div style={{ marginTop: 8, fontSize: 13, color: '#FCA5A5' }}>
                    {genResult.validation?.errors?.join(' | ')}
                  </div>
                </>
              ) : genResult.qc ? (
                <>
                  <strong>✅ Generated:</strong> {genResult.post?.title} ({genResult.post?.word_count} words)
                  <br />
                  <strong>QC:</strong> {genResult.qc.verdict}
                  {genResult.qc.scores && (
                    <span> — SEO: {genResult.qc.scores.seo}/10, AEO: {genResult.qc.scores.aeo_readiness}/10, Info Gain: {genResult.qc.scores.information_gain}/10, Overall: {genResult.qc.scores.overall}/10</span>
                  )}
                  {genResult.cost && <span style={{ color: '#94A3B8' }}> — Est. cost: ${genResult.cost.toFixed(2)}</span>}
                  {genResult.qc.hallucination_flags?.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 13, color: '#FCA5A5' }}>
                      ⚠️ Hallucination flags: {genResult.qc.hallucination_flags.join(' | ')}
                    </div>
                  )}
                  {genResult.qc.business_protection_flags?.length > 0 && (
                    <div style={{ marginTop: 4, fontSize: 13, color: '#FCA5A5' }}>
                      🛡️ Business flags: {genResult.qc.business_protection_flags.join(' | ')}
                    </div>
                  )}
                </>
              ) : (
                <strong>⏳ Post generated, pending QC</strong>
              )}
            </div>
          )}
        </section>

        {/* Error */}
        {error && (
          <div style={styles.errorBox}>
            <strong>Error:</strong> {error}
            <button onClick={() => setError(null)} style={styles.dismissBtn}>✕</button>
          </div>
        )}

        {/* Posts List */}
        <section style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={styles.cardTitle}>Generated Posts — {activeBiz.name} ({posts.length})</h2>
            <button onClick={fetchPosts} style={styles.refreshBtn}>↻ Refresh</button>
          </div>

          {loading ? (
            <p style={{ color: '#94A3B8', textAlign: 'center', padding: 40 }}>Loading...</p>
          ) : posts.length === 0 ? (
            <p style={{ color: '#94A3B8', textAlign: 'center', padding: 40 }}>No generated posts yet for {activeBiz.name}.</p>
          ) : (
            <div style={styles.postsList}>
              {posts.map(post => {
                const statusInfo = STATUS_COLORS[post.status] || STATUS_COLORS.pending;
                const qcInfo = parseQcNotes(post);
                const hasNotes = qcInfo.heldReason || qcInfo.hallucinations.length > 0 || qcInfo.bizFlags.length > 0 || qcInfo.validationErrors.length > 0;
                const isExpanded = expandedNotes === post.id;

                return (
                  <div key={post.id} style={styles.postRow}>
                    <div style={styles.postInfo}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 20 }}>{post.emoji || '📝'}</span>
                        <strong style={{ fontSize: 15 }}>{post.title}</strong>
                      </div>
                      <div style={styles.postMeta}>
                        <span style={{ ...styles.statusBadge, backgroundColor: statusInfo.bg, color: statusInfo.text }}>
                          {statusInfo.label}
                        </span>
                        {post.primary_keyword && <span>{post.primary_keyword}</span>}
                        {post.word_count > 0 && <span>{post.word_count} words</span>}
                        {post.read_time && <span>{post.read_time}</span>}
                        {post.qc_score?.overall && <span>QC: {post.qc_score.overall}/10</span>}
                        <span>{new Date(post.created_at).toLocaleDateString()}</span>
                      </div>

                      {/* QC Scores row */}
                      {qcInfo.scores && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                          {Object.entries(qcInfo.scores).filter(([k]) => k !== 'overall').map(([key, val]) => (
                            <span key={key} style={{
                              fontSize: 11, padding: '2px 6px', borderRadius: 4,
                              background: val >= 7 ? '#064E3B' : val >= 5 ? '#78350F' : '#7F1D1D',
                              color: val >= 7 ? '#34D399' : val >= 5 ? '#FBBF24' : '#FCA5A5',
                            }}>
                              {key.replace(/_/g, ' ')}: {val}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Hold reason badge */}
                      {qcInfo.heldReason && (
                        <div style={{ marginTop: 6, fontSize: 12, color: '#FBBF24', display: 'flex', alignItems: 'center', gap: 6 }}>
                          ⚠️ <span>Held: {qcInfo.heldReason}</span>
                        </div>
                      )}

                      {/* Expandable QC details */}
                      {hasNotes && (
                        <button
                          onClick={() => setExpandedNotes(isExpanded ? null : post.id)}
                          style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 12, cursor: 'pointer', marginTop: 4, padding: 0, textDecoration: 'underline' }}
                        >
                          {isExpanded ? '▾ Hide QC details' : '▸ Show QC details'}
                        </button>
                      )}

                      {isExpanded && (
                        <div style={{ marginTop: 8, padding: 12, background: '#0F172A', borderRadius: 6, fontSize: 12, lineHeight: 1.6 }}>
                          {qcInfo.hallucinations.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <strong style={{ color: '#FCA5A5' }}>⚠️ Hallucination Flags:</strong>
                              {qcInfo.hallucinations.map((h, i) => (
                                <div key={i} style={{ color: '#FDA4AF', marginTop: 4, paddingLeft: 12, borderLeft: '2px solid #7F1D1D' }}>{h}</div>
                              ))}
                            </div>
                          )}
                          {qcInfo.bizFlags.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <strong style={{ color: '#FBBF24' }}>🛡️ Business Protection Flags:</strong>
                              {qcInfo.bizFlags.map((f, i) => (
                                <div key={i} style={{ color: '#FDE68A', marginTop: 4, paddingLeft: 12, borderLeft: '2px solid #78350F' }}>{f}</div>
                              ))}
                            </div>
                          )}
                          {qcInfo.validationErrors.length > 0 && (
                            <div>
                              <strong style={{ color: '#FCA5A5' }}>⛔ Validation Errors:</strong>
                              {qcInfo.validationErrors.map((e, i) => (
                                <div key={i} style={{ color: '#FDA4AF', marginTop: 4, paddingLeft: 12, borderLeft: '2px solid #7F1D1D' }}>{typeof e === 'string' ? e : e.message || JSON.stringify(e)}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div style={styles.postActions}>
                      <button onClick={() => handlePreview(post.id)} style={styles.actionBtn}>👁 Preview</button>
                      {(post.status === 'pending' || post.status === 'revision_needed') && (
                        <>
                          <button
                            onClick={() => handleApprove(post.id)}
                            style={{ ...styles.approveBtn, background: activeBiz.bg }}
                            disabled={publishing === post.id}
                          >
                            {publishing === post.id ? '⏳...' : '✅ Publish'}
                          </button>
                          <button onClick={() => handleReject(post.id)} style={styles.rejectBtn}>❌</button>
                        </>
                      )}
                      {post.status === 'published' && (
                        <a href={getLiveUrl(post)} target="_blank" rel="noopener" style={styles.liveLink}>
                          🔗 View Live
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Preview Modal */}
      {previewId && (
        <div style={styles.modal} onClick={() => setPreviewId(null)}>
          <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={{ fontWeight: 600 }}>Preview — {activeBiz.name}</span>
              <button onClick={() => setPreviewId(null)} style={styles.modalClose}>✕</button>
            </div>
            {activeBiz.linkFormat === 'nextjs' ? (
              <div style={{ flex: 1, overflow: 'auto', padding: 24, background: '#050505', color: '#fafaf9' }}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <iframe
                srcDoc={previewHtml}
                style={styles.previewFrame}
                title="Blog Post Preview"
                sandbox="allow-same-origin"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { fontFamily: "'Inter', -apple-system, sans-serif", background: '#0F172A', minHeight: '100vh', color: '#E2E8F0' },
  header: { background: '#1E293B', borderBottom: '1px solid #334155', padding: '16px 24px' },
  headerInner: { maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  logo: { fontSize: 20, fontWeight: 700, color: '#F8FAFC', margin: 0 },
  bizSelector: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  bizTab: { border: '1px solid', borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' },
  badge: { padding: '4px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600 },
  main: { maxWidth: 1200, margin: '0 auto', padding: '24px 24px 80px' },
  card: { background: '#1E293B', borderRadius: 12, padding: 24, marginBottom: 20, border: '1px solid #334155' },
  cardTitle: { fontSize: 18, fontWeight: 600, color: '#F8FAFC', marginTop: 0, marginBottom: 16 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  formRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  formGroup: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 13, color: '#94A3B8', fontWeight: 500 },
  input: { background: '#0F172A', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', color: '#F8FAFC', fontSize: 14, outline: 'none' },
  select: { background: '#0F172A', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', color: '#F8FAFC', fontSize: 14, outline: 'none' },
  generateBtn: { color: '#fff', border: 'none', borderRadius: 8, padding: '12px 24px', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 4 },
  resultBox: { borderRadius: 8, padding: 16, marginTop: 12, fontSize: 14, color: '#D1FAE5', lineHeight: 1.6 },
  errorBox: { background: '#7F1D1D', borderRadius: 8, padding: 16, marginBottom: 20, fontSize: 14, color: '#FEE2E2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  dismissBtn: { background: 'none', border: 'none', color: '#FEE2E2', cursor: 'pointer', fontSize: 16 },
  refreshBtn: { background: '#334155', border: 'none', borderRadius: 6, padding: '6px 14px', color: '#94A3B8', fontSize: 13, cursor: 'pointer' },
  postsList: { display: 'flex', flexDirection: 'column', gap: 8 },
  postRow: { background: '#0F172A', borderRadius: 8, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  postInfo: { flex: 1, minWidth: 300 },
  postMeta: { display: 'flex', gap: 12, marginTop: 8, fontSize: 12, color: '#64748B', flexWrap: 'wrap', alignItems: 'center' },
  statusBadge: { padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 },
  postActions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  actionBtn: { background: '#334155', border: 'none', borderRadius: 6, padding: '6px 12px', color: '#CBD5E1', fontSize: 13, cursor: 'pointer' },
  approveBtn: { border: 'none', borderRadius: 6, padding: '6px 12px', color: '#D1FAE5', fontSize: 13, cursor: 'pointer', fontWeight: 600 },
  rejectBtn: { background: '#7F1D1D', border: 'none', borderRadius: 6, padding: '6px 12px', color: '#FEE2E2', fontSize: 13, cursor: 'pointer' },
  liveLink: { background: '#1E40AF', borderRadius: 6, padding: '6px 12px', color: '#DBEAFE', fontSize: 13, textDecoration: 'none', fontWeight: 500 },
  modal: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalContent: { background: '#1E293B', borderRadius: 12, width: '95vw', maxWidth: 1100, height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #334155' },
  modalClose: { background: 'none', border: 'none', color: '#94A3B8', fontSize: 20, cursor: 'pointer' },
  previewFrame: { flex: 1, border: 'none', background: '#fff', width: '100%' },
  statBox: { background: '#0F172A', borderRadius: 8, padding: '12px 16px', minWidth: 80, textAlign: 'center' },
  statNum: { fontSize: 22, fontWeight: 700, color: '#F8FAFC' },
  statLabel: { fontSize: 11, color: '#64748B', marginTop: 2, textTransform: 'capitalize' },
  recRow: { background: '#0F172A', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  rankBadge: { background: '#334155', color: '#CBD5E1', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 700 },
  useRecBtn: { border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
};