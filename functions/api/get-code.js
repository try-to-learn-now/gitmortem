// File: functions/api/get-code.js
import {
  corsHeaders, pickToken, safeInt, normalizePath,
  sha256HexFromString, ghJson, resolveRefToCommitSha
} from "./_utils.js";

function looksBinary(text) {
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
  const pathRaw = url.searchParams.get("path");
  const refInput = url.searchParams.get("ref"); // can be branch/tag/sha

  if (!owner || !repo || !pathRaw) {
    return new Response("Missing owner/repo/path", { status: 400, headers: corsHeaders() });
  }

  const path = normalizePath(pathRaw);
  const token = pickToken(env, owner);
  if (!token) {
    return new Response("Server config error: No token found", { status: 500, headers: corsHeaders() });
  }

  // Chunk params (line-based)
  const start = Math.max(safeInt(url.searchParams.get("start"), 1), 1); // 1-based
  const endRaw = Math.max(safeInt(url.searchParams.get("end"), 0), 0);   // 0=full
  const wantLineNumbers = url.searchParams.get("ln") === "1";
  const wantMarkdown = url.searchParams.get("md") === "1";

  // Resolve ref→commit SHA (pins content)
  const resolved = await resolveRefToCommitSha({ owner, repo, refInput, token });
  if (!resolved.ok) {
    return new Response(`Ref Error: ${resolved.error}`, { status: resolved.status, headers: corsHeaders() });
  }
  const { ref, commitSha } = resolved;

  // 1) Fetch metadata (sha, size, etc.)
  const metaUrl = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`);
  metaUrl.searchParams.set("ref", commitSha);

  const { res: metaRes, data: metaJson } = await ghJson(metaUrl.toString(), token);
  if (!metaRes.ok) {
    return new Response(`GitHub Meta Error (${metaRes.status}): ${metaJson.message || metaRes.statusText}`, {
      status: metaRes.status,
      headers: corsHeaders(),
    });
  }

  const blobSha = metaJson?.sha || "";
  const fileSize = metaJson?.size ?? "";
  const downloadUrl = metaJson?.download_url || "";

  // 2) Fetch raw content
  let rawText = "";
  if (downloadUrl) {
    // Use download_url (already pinned by ref in metadata response)
    const r = await fetch(downloadUrl, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "User-Agent": "GitMortem-AccuracyPack",
      },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return new Response(`GitHub Raw Error (${r.status}): ${err || r.statusText}`, {
        status: r.status,
        headers: corsHeaders(),
      });
    }
    rawText = await r.text();
  } else {
    // fallback: contents raw accept
    const rawUrl = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`);
    rawUrl.searchParams.set("ref", commitSha);
    const r = await fetch(rawUrl.toString(), {
      headers: {
        "Authorization": `Bearer ${token}`,
        "User-Agent": "GitMortem-AccuracyPack",
        "Accept": "application/vnd.github.v3.raw",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return new Response(`GitHub Raw Error (${r.status}): ${err || r.statusText}`, {
        status: r.status,
        headers: corsHeaders(),
      });
    }
    rawText = await r.text();
  }

  if (looksBinary(rawText)) {
    return new Response("Binary file detected. Use GitHub to download/open it.", {
      status: 415,
      headers: corsHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
    });
  }

  // Fingerprint full file
  const fullSha = await sha256HexFromString(rawText);

  // Chunk slicing
  const lines = rawText.split("\n");
  const totalLines = lines.length;

  if (endRaw > 0 && start > totalLines) {
    return new Response(`Range Error: start (${start}) > totalLines (${totalLines})`, {
      status: 416,
      headers: corsHeaders({
        "Content-Type": "text/plain; charset=utf-8",
        "X-Total-Lines": String(totalLines),
        "X-Full-SHA256": fullSha,
        "X-Commit-SHA": commitSha,
        "X-Source": `${owner}/${repo}@${commitSha}:${path}`,
      }),
    });
  }

  let rangeStart = 1;
  let rangeEnd = totalLines;
  let outLines = lines;

  if (endRaw > 0) {
    rangeStart = start;
    rangeEnd = Math.min(endRaw, totalLines);
    outLines = lines.slice(rangeStart - 1, rangeEnd);
  }

  const nextStart = rangeEnd < totalLines ? rangeEnd + 1 : -1;
  const width = Math.max(4, String(totalLines).length);

  let body = outLines.join("\n");
  if (wantLineNumbers) {
    body = addLineNumbers(outLines, rangeStart, width);
  }
  if (wantMarkdown) {
    body =
      "```text\n" +
      `// source=${owner}/${repo}@${commitSha}:${path}\n` +
      `// lines=${rangeStart}-${rangeEnd}/${totalLines}\n` +
      body +
      "\n```\n";
  }

  // Fingerprint response body (and chunk)
  const bodySha = await sha256HexFromString(body);

  return new Response(body, {
    headers: corsHeaders({
      "Content-Type": "text/plain; charset=utf-8",

      // Accuracy headers
      "X-Ref": ref,
      "X-Commit-SHA": commitSha,
      "X-Source": `${owner}/${repo}@${commitSha}:${path}`,
      "X-Blob-SHA": blobSha,
      "X-File-Size": String(fileSize),

      "X-Total-Lines": String(totalLines),
      "X-Range": `${rangeStart}-${rangeEnd}`,
      "X-Next-Start": String(nextStart),

      "X-Full-SHA256": fullSha,
      "X-Body-SHA256": bodySha,
      "X-Chunk-SHA256": bodySha, // same as body for chunked reads
    }),
  });
}
