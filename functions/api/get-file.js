// File Path: /functions/api/get-file.js

export async function onRequest(context) {
    const { searchParams } = new URL(context.request.url);
    const { env } = context;

    const owner = searchParams.get('owner');
    const repo = searchParams.get('repo');
    const path = searchParams.get('path');

    if (!owner || !repo || !path) return new Response('Missing parameters', { status: 400 });

    // --- 🧠 SAME SMART TOKEN LOGIC ---
    // Kyunki 'get-file' ko alag se call kiya jata hai, isko bhi token decide karna padega
    const cleanOwner = owner.toUpperCase().replace(/-/g, '_');
    const envVarName = `TOKEN_${cleanOwner}`;
    let token = env[envVarName] || env.TOKEN_DEFAULT;

    if (!token) return new Response('Server Config Error: Token not found.', { status: 500 });

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    try {
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'User-Agent': 'Cloudflare-Worker-Explorer',
                'Accept': 'application/vnd.github.v3.raw' // Raw content chahiye
            }
        });

        if (!response.ok) return new Response(`GitHub Error: ${response.statusText}`, { status: response.status });

        // Content wapas bhej do
        return new Response(response.body, {
            headers: {
                'Content-Type': response.headers.get('Content-Type') || 'text/plain',
                'Access-Control-Allow-Origin': '*' // AI ko access dene ke liye
            }
        });

    } catch (e) {
        return new Response(`Proxy Error: ${e.message}`, { status: 500 });
    }
}
