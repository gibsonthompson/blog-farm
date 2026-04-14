/**
 * GitHub API integration for blog automation.
 * Commits multiple files (blog post, blog.html, sitemap.xml) in a SINGLE commit
 * using the Git Trees API to avoid triggering multiple Vercel deploys.
 */

const GITHUB_API = 'https://api.github.com';

function headers() {
  return {
    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function ghFetch(path, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, { headers: headers(), ...options });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }
  return res.json();
}

/**
 * Get the current SHA of a branch's HEAD
 */
async function getBranchSHA(owner, repo, branch = 'main') {
  const ref = await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`);
  return ref.object.sha;
}

/**
 * Get a file's content and SHA (for updates)
 */
async function getFile(owner, repo, path, branch = 'main') {
  try {
    const file = await ghFetch(`/repos/${owner}/${repo}/contents/${path}?ref=${branch}`);
    const content = Buffer.from(file.content, 'base64').toString('utf-8');
    return { content, sha: file.sha };
  } catch (e) {
    return null; // File doesn't exist
  }
}

/**
 * Create a blob for a file
 */
async function createBlob(owner, repo, content) {
  const blob = await ghFetch(`/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({
      content: Buffer.from(content).toString('base64'),
      encoding: 'base64',
    }),
  });
  return blob.sha;
}

/**
 * Commit multiple files in a single commit using Git Trees API.
 * This is critical — it prevents multiple Vercel deploys.
 * 
 * @param {string} owner - GitHub username
 * @param {string} repo - Repo name
 * @param {Array<{path: string, content: string}>} files - Files to commit
 * @param {string} message - Commit message
 * @param {string} branch - Branch name
 * @returns {object} Commit data
 */
export async function commitMultipleFiles(owner, repo, files, message, branch = 'main') {
  // 1. Get latest commit SHA
  const latestCommitSHA = await getBranchSHA(owner, repo, branch);

  // 2. Get the tree SHA from the latest commit
  const latestCommit = await ghFetch(`/repos/${owner}/${repo}/git/commits/${latestCommitSHA}`);
  const baseTreeSHA = latestCommit.tree.sha;

  // 3. Create blobs for each file
  const treeEntries = [];
  for (const file of files) {
    const blobSHA = await createBlob(owner, repo, file.content);
    treeEntries.push({
      path: file.path,
      mode: '100644',
      type: 'blob',
      sha: blobSHA,
    });
  }

  // 4. Create a new tree
  const newTree = await ghFetch(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSHA,
      tree: treeEntries,
    }),
  });

  // 5. Create a new commit
  const newCommit = await ghFetch(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: newTree.sha,
      parents: [latestCommitSHA],
    }),
  });

  // 6. Update the branch ref
  await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return { sha: newCommit.sha, url: newCommit.html_url };
}

/**
 * Fetch the current content of a file from the repo
 */
export async function fetchFileContent(owner, repo, path, branch = 'main') {
  return getFile(owner, repo, path, branch);
}
