// File Path: /functions/api/get-file.js

/**
 * Yeh "The Proxy" hai. AI jab file link par click karega, toh yeh file ka content la kar dega.
 * @param {object} context - Cloudflare ka context object.
 */
export async function onRequest(context) {
    const { searchParams } = new URL(context.request.url);
    const { env } = context;

    const owner = searchParams.get('owner');
    const repo = searchParams.get('repo');
    const path = searchParams.get('path');

    if (!owner || !repo || !path) return new Response('Error: Missing owner, repo, or path parameters.', { status: 400 });

    // --- SAME SMART TOKEN LOGIC ---
    const envVarName = `TOKEN_${owner.toUpperCase().replace(/-/g, '_')}`;
    let token = env[envVarName] || env.TOKEN_DEFAULT;

    if (!token) return new Response('Error: Server is not configured with a token for this user.', { status: 500 });

    // GitHub API se raw content maango
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    try {
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'User-Agent': 'Cloudflare-Worker-Explorer',
                'Accept': 'application/vnd.github.v3.raw' // Yeh direct raw content laayega
            }
        });

        if (!response.ok) return new Response(`GitHub API Error while fetching file: ${response.statusText}`, { status: response.status });

        // GitHub se jo content mila, usko seedha response mein bhej do
        return new Response(response.body, {
            headers: {
                'Content-Type': response.headers.get('Content-Type') || 'text/plain',
            }
        });

    } catch (e) {
        return new Response(`Proxy Error: ${e.message}`, { status: 500 });
    }
}
