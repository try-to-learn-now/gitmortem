// File: functions/api/_utils.js

export function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
    ...extra,
  };
}

export function pickToken(env, owner) {
  const cleanOwner = String(owner || "").toUpperCase().replace(/-/g, "_");
  return env[`TOKEN_${cleanOwner}`] || env.TOKEN_DEFAULT || "";
}

export function safeInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizePath(p) {
  return String(p || "")
    .replace(/^\/+/, "")
    .replace(/\.\.(\/|\\)/g, "") // basic traversal defense
    .trim();
}

export function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[c]));
}

export function escAttr(s) {
  return escHtml(s);
}

export async function sha256HexFromString(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function ghJson(url, token) {
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GitMortem-AccuracyPack",
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function resolveRefToCommitSha({ owner, repo, refInput, token }) {
  // 1) repo info → default branch
  const repoInfoUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const { res: repoRes, data: repoInfo } = await ghJson(repoInfoUrl, token);
  if (!repoRes.ok) {
    return { ok: false, status: repoRes.status, error: repoInfo.message || repoRes.statusText };
  }

  const defaultBranch = repoInfo.default_branch || "main";
  const ref = refInput || defaultBranch;

  // 2) if already looks like sha
  if (/^[0-9a-f]{7,40}$/i.test(ref)) {
    return { ok: true, ref, commitSha: ref, defaultBranch };
  }

  // 3) heads
  {
    const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(ref)}`;
    const { res, data } = await ghJson(refUrl, token);
    if (res.ok && data?.object?.sha) return { ok: true, ref, commitSha: data.object.sha, defaultBranch };
  }

  // 4) tags
  {
    const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/refs/tags/${encodeURIComponent(ref)}`;
    const { res, data } = await ghJson(refUrl, token);
    if (res.ok && data?.object?.sha) return { ok: true, ref, commitSha: data.object.sha, defaultBranch };
  }

  return { ok: false, status: 400, error: `Could not resolve ref "${ref}"` };
}
