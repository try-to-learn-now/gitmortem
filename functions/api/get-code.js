// File: functions/api/get-code.js
// Cloudflare Pages Function
// Features:
// - Multi-account token selection (TOKEN_<OWNER>, fallback TOKEN_DEFAULT)
// - Full plain-text proxy to GitHub file content
// - Optional chunking by lines: ?start=1&end=400
// - Optional line numbers: ?ln=1
// - Optional markdown wrapping: ?md=1
// - NO CACHE: Cache-Control: no-store
// - CORS enabled

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
    ...extra,
  };
}

function pickToken(env, owner) {
  const cleanOwner = String(owner || "").toUpperCase().replace(/-/g, "_");
  return env[`TOKEN_${cleanOwner}`] || env.TOKEN_DEFAULT || "";
}

function safeInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function looksBinary(text) {
  // quick heuristic: null bytes usually mean binary
  return text.includes("\u0000");
}

function addLineNumbers(lines, startLineNumber = 1, width = 4) {
  return lines
    .map((line, i) => {
      const n = String(startLineNumber + i).padStart(width, "0");
      return `${n} | ${line}`;
    })
    .join("\n");
}

export async function onRequest(context) {
  const { env, request } = context;

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const owner = url.searchParams.get("owner");
  const repo = url.searchParams.get("repo");
  const path = url.searchParams.get("path");

  if (!owner || !repo || !path) {
    return new Response("Missing owner/repo/path", { status: 400, headers: corsHeaders() });
  }

  const token = pickToken(env, owner);
  if (!token) {
    return new Response("Server config error: No token found", { status: 500, headers: corsHeaders() });
  }

  // Optional chunking params
  const start = Math.max(safeInt(url.searchParams.get("start"), 1), 1); // 1-based
  const endRaw = safeInt(url.searchParams.get("end"), 0); // 0 = full
  const wantLineNumbers = url.searchParams.get("ln") === "1";
  const wantMarkdown = url.searchParams.get("md") === "1";

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  console.log("get-code →", apiUrl);

  try {
    const ghRes = await fetch(apiUrl, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "User-Agent": "Mozilla/5.0 (GitMortem-AI-Proxy)",
        "Accept": "application/vnd.github.v3.raw",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!ghRes.ok) {
      const err = await ghRes.text().catch(() => "");
      console.log("❌ GitHub get-code Error:", ghRes.status, err);
      return new Response(`GitHub Error (${ghRes.status}): ${err || ghRes.statusText}`, {
        status: ghRes.status,
        headers: corsHeaders(),
      });
    }

    const fullText = await ghRes.text();

    if (looksBinary(fullText)) {
      return new Response("Binary file detected. Use GitHub to download/open it.", {
        status: 415,
        headers: corsHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
      });
    }

    const lines = fullText.split("\n");
    const totalLines = lines.length;

    let rangeStart = 1;
    let rangeEnd = totalLines;
    let outLines = lines;

    if (endRaw > 0) {
      rangeStart = start;
      rangeEnd = Math.min(endRaw, totalLines);
      outLines = lines.slice(rangeStart - 1, rangeEnd);
    }

    const nextStart = rangeEnd < totalLines ? rangeEnd + 1 : -1;

    // line number width
    const width = Math.max(4, String(totalLines).length);

    let body = outLines.join("\n");

    if (wantLineNumbers) {
      body = addLineNumbers(outLines, rangeStart, width);
    }

    if (wantMarkdown) {
      const fence = "```";
      body =
        `${fence}\n` +
        `// owner=${owner} repo=${repo} path=${path} lines=${rangeStart}-${rangeEnd}/${totalLines}\n` +
        body +
        `\n${fence}\n`;
    }

    return new Response(body, {
      headers: corsHeaders({
        "Content-Type": "text/plain; charset=utf-8",
        "X-Owner": owner,
        "X-Repo": repo,
        "X-Path": path,
        "X-Total-Lines": String(totalLines),
        "X-Range": `${rangeStart}-${rangeEnd}`,
        "X-Next-Start": String(nextStart),
      }),
    });
  } catch (e) {
    console.log("get-code Crash:", e);
    return new Response(`Proxy Crash: ${e.message}`, { status: 500, headers: corsHeaders() });
  }
}
