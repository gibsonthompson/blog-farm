'use client';
import { useState, useEffect, useCallback } from 'react';

const STATUS_COLORS = {
  pending: { bg: '#FEF3C7', text: '#92400E', label: 'Pending Review' },
  approved: { bg: '#D1FAE5', text: '#065F46', label: 'Approved' },
  published: { bg: '#DBEAFE', text: '#1E40AF', label: 'Published' },
  rejected: { bg: '#FEE2E2', text: '#991B1B', label: 'Rejected' },
  revision_needed: { bg: '#FDE68A', text: '#78350F', label: 'Needs Revision' },
};

const POST_TYPES = [
  { value: 'industry', label: 'Industry Guide', desc: 'Best AI Receptionist for [Industry]' },
  { value: 'comparison', label: 'Competitor Comparison', desc: 'CallBird vs [Competitor]' },
  { value: 'how-to', label: 'How-To Guide', desc: 'How to [Solve Problem]' },
  { value: 'statistics', label: 'Statistics & Data', desc: 'Data-driven post with numbers' },
  { value: 'guide', label: 'Comprehensive Guide', desc: 'Definitive resource on a topic' },
  { value: 'cost-analysis', label: 'Cost Analysis', desc: 'ROI and cost comparison' },
  { value: 'about', label: 'Brand / AEO', desc: 'AEO-optimized brand awareness' },
];

export default function Dashboard() {
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

  // Form state
  const [keyword, setKeyword] = useState('');
  const [postType, setPostType] = useState('industry');
  const [notes, setNotes] = useState('');

  const fetchPosts = useCallback(async () => {
    try {
      const res = await fetch('/api/posts?business=callbird');
      const data = await res.json();
      setPosts(data.posts || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  async function fetchRecommendations() {
    setRecsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/keywords?recommend=true&count=8&business=callbird');
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
    // Scroll to generate form
    document.getElementById('generate-section')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function handleGenerate(e) {
    e.preventDefault();
    if (!keyword.trim()) return;
    setGenerating(true);
    setError(null);
    setGenResult(null);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessSlug: 'callbird',
          targetKeyword: keyword.trim(),
          postType,
          notes: notes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setGenResult(data);
      setKeyword('');
      setNotes('');
      fetchPosts();
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
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

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <h1 style={styles.logo}>Blog Automation</h1>
          <span style={styles.badge}>CallBird AI</span>
        </div>
      </header>

      <main style={styles.main}>
        {/* AI Strategy Section */}
        <section style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={styles.cardTitle}>Content Strategy Brain</h2>
            <button onClick={fetchRecommendations} style={styles.generateBtn} disabled={recsLoading}>
              {recsLoading ? '⏳ Analyzing Gaps...' : '🧠 Get AI Recommendations'}
            </button>
          </div>

          {recs && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={styles.statBox}>
                  <div style={styles.statNum}>{recs.existingCount}</div>
                  <div style={styles.statLabel}>Published Posts</div>
                </div>
                <div style={styles.statBox}>
                  <div style={styles.statNum}>{recs.totalOpportunities}</div>
                  <div style={styles.statLabel}>Untapped Opportunities</div>
                </div>
                {recs.coverage && Object.entries(recs.coverage).map(([cat, data]) => (
                  <div key={cat} style={styles.statBox}>
                    <div style={{ ...styles.statNum, color: data.coveragePercent > 60 ? '#34D399' : data.coveragePercent > 30 ? '#FBBF24' : '#F87171' }}>
                      {data.coveragePercent}%
                    </div>
                    <div style={styles.statLabel}>{cat}</div>
                  </div>
                ))}
              </div>

              {recs.recommendations && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {recs.recommendations.map((rec, i) => (
                    <div key={i} style={{ ...styles.recRow, borderLeft: `3px solid ${rec.business_impact === 'high' ? '#34D399' : rec.business_impact === 'medium' ? '#FBBF24' : '#64748B'}` }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                          <span style={styles.rankBadge}>#{rec.rank}</span>
                          <strong style={{ fontSize: 14, color: '#F8FAFC' }}>{rec.title}</strong>
                          <span style={{ fontSize: 11, background: '#334155', padding: '2px 6px', borderRadius: 4, color: '#94A3B8' }}>{rec.post_type}</span>
                          <span style={{ fontSize: 11, background: rec.business_impact === 'high' ? '#064E3B' : '#1E293B', padding: '2px 6px', borderRadius: 4, color: rec.business_impact === 'high' ? '#34D399' : '#94A3B8' }}>{rec.business_impact} impact</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.4 }}>
                          <span style={{ color: '#CBD5E1' }}>Keyword:</span> {rec.target_keyword} — {rec.reasoning}
                        </div>
                      </div>
                      <button onClick={() => useRecommendation(rec)} style={styles.useRecBtn}>
                        ⚡ Generate This
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {!recs && !recsLoading && (
            <p style={{ color: '#64748B', fontSize: 14, margin: 0 }}>
              Click "Get AI Recommendations" to analyze your content gaps and get prioritized suggestions for what to write next.
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
                  placeholder="e.g., AI receptionist for auto repair shops"
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
            <button type="submit" style={styles.generateBtn} disabled={generating || !keyword.trim()}>
              {generating ? '⏳ Generating & Running QC...' : '⚡ Generate Blog Post'}
            </button>
          </form>

          {genResult && (
            <div style={styles.resultBox}>
              <strong>✅ Generated:</strong> {genResult.post.title} ({genResult.post.word_count} words)
              <br />
              <strong>QC Verdict:</strong> {genResult.qc.verdict}
              {genResult.qc.scores && (
                <span> — SEO: {genResult.qc.scores.seo}/10, Voice: {genResult.qc.scores.brand_voice}/10, Overall: {genResult.qc.scores.overall}/10</span>
              )}
              {genResult.qc.issues?.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 13, color: '#92400E' }}>
                  Issues: {genResult.qc.issues.join(' | ')}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Error display */}
        {error && (
          <div style={styles.errorBox}>
            <strong>Error:</strong> {error}
            <button onClick={() => setError(null)} style={styles.dismissBtn}>✕</button>
          </div>
        )}

        {/* Posts List */}
        <section style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={styles.cardTitle}>Generated Posts ({posts.length})</h2>
            <button onClick={fetchPosts} style={styles.refreshBtn}>↻ Refresh</button>
          </div>

          {loading ? (
            <p style={{ color: '#94A3B8', textAlign: 'center', padding: 40 }}>Loading...</p>
          ) : posts.length === 0 ? (
            <p style={{ color: '#94A3B8', textAlign: 'center', padding: 40 }}>No posts yet. Generate your first one above.</p>
          ) : (
            <div style={styles.postsList}>
              {posts.map(post => {
                const statusInfo = STATUS_COLORS[post.status] || STATUS_COLORS.pending;
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
                        <span>{post.primary_keyword}</span>
                        <span>{post.word_count} words</span>
                        <span>{post.read_time}</span>
                        {post.qc_score?.overall && <span>QC: {post.qc_score.overall}/10</span>}
                        <span>{new Date(post.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div style={styles.postActions}>
                      <button onClick={() => handlePreview(post.id)} style={styles.actionBtn}>👁 Preview</button>
                      {(post.status === 'pending' || post.status === 'revision_needed') && (
                        <>
                          <button
                            onClick={() => handleApprove(post.id)}
                            style={styles.approveBtn}
                            disabled={publishing === post.id}
                          >
                            {publishing === post.id ? '⏳ Publishing...' : '✅ Approve & Publish'}
                          </button>
                          <button onClick={() => handleReject(post.id)} style={styles.rejectBtn}>❌ Reject</button>
                        </>
                      )}
                      {post.status === 'published' && (
                        <a
                          href={`https://callbirdai.com/blog-${post.slug}.html`}
                          target="_blank"
                          rel="noopener"
                          style={styles.liveLink}
                        >
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
              <span style={{ fontWeight: 600 }}>Preview</span>
              <button onClick={() => setPreviewId(null)} style={styles.modalClose}>✕</button>
            </div>
            <iframe
              srcDoc={previewHtml}
              style={styles.previewFrame}
              title="Blog Post Preview"
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { fontFamily: "'Inter', -apple-system, sans-serif", background: '#0F172A', minHeight: '100vh', color: '#E2E8F0' },
  header: { background: '#1E293B', borderBottom: '1px solid #334155', padding: '16px 24px' },
  headerInner: { maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  logo: { fontSize: 20, fontWeight: 700, color: '#F8FAFC', margin: 0 },
  badge: { background: '#122092', color: '#F6B828', padding: '4px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600 },
  main: { maxWidth: 1200, margin: '0 auto', padding: '24px 24px 80px' },
  card: { background: '#1E293B', borderRadius: 12, padding: 24, marginBottom: 20, border: '1px solid #334155' },
  cardTitle: { fontSize: 18, fontWeight: 600, color: '#F8FAFC', marginTop: 0, marginBottom: 16 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  formRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  formGroup: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 13, color: '#94A3B8', fontWeight: 500 },
  input: { background: '#0F172A', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', color: '#F8FAFC', fontSize: 14, outline: 'none' },
  select: { background: '#0F172A', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', color: '#F8FAFC', fontSize: 14, outline: 'none' },
  generateBtn: { background: '#122092', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 24px', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 4 },
  resultBox: { background: '#064E3B', borderRadius: 8, padding: 16, marginTop: 12, fontSize: 14, color: '#D1FAE5', lineHeight: 1.6 },
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
  approveBtn: { background: '#065F46', border: 'none', borderRadius: 6, padding: '6px 12px', color: '#D1FAE5', fontSize: 13, cursor: 'pointer', fontWeight: 600 },
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
  rankBadge: { background: '#334155', color: '#CBD5E1', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  useRecBtn: { background: '#122092', border: 'none', borderRadius: 6, padding: '8px 14px', color: '#F6B828', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
};
