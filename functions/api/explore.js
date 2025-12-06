// File Path: /functions/api/explore.js

/**
 * Yeh "The Brain" hai. File list fetch karta hai aur smart token selection karta hai.
 * @param {object} context - Cloudflare ka context object.
 */
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const origin = url.origin; // Yeh aapka domain nikalega (e.g., https://my-app.pages.dev)
    
    const owner = url.searchParams.get('owner');
    const repo = url.searchParams.get('repo');

    if (!owner || !repo) {
        return new Response('Error: Owner and Repo are required in the URL.', { status: 400 });
    }

    // --- SMART TOKEN SELECTION LOGIC ---
    // 1. Owner ke naam ko uppercase aur valid environment variable format mein badlo.
    const envVarName = `TOKEN_${owner.toUpperCase().replace(/-/g, '_')}`;
    
    // 2. Check karo agar us owner ka specific token hai, warna DEFAULT token use karo.
    let token = env[envVarName] || env.TOKEN_DEFAULT;
    
    // Debugging ke liye: Cloudflare logs mein dikhega ki kaunsa token uthaya gaya.
    console.log(`Repo Owner: ${owner}, Using Token Variable: ${env[envVarName] ? envVarName : 'TOKEN_DEFAULT'}`);

    if (!token) {
        return new Response('Error: Server is not configured with GitHub tokens. Please set TOKEN_DEFAULT at least.', { status: 500 });
    }

    // GitHub API call
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;

    try {
        const response = await fetch(apiUrl, {
            headers: { 'Authorization': `token ${token}`, 'User-Agent': 'Cloudflare-Worker-Explorer' }
        });

        if (!response.ok) {
            if (response.status === 404) return new Response(`Error: Repository not found or it's private and the token is invalid.`, { status: 404 });
            return new Response(`GitHub API Error: ${response.statusText}`, { status: response.status });
        }

        const data = await response.json();
        
        // --- TREE GENERATION WITH FULL PROXY URLS ---
        let output = `${repo}/\n`;
        const tree = {};

        // GitHub se mili flat list ko ek nested tree object mein convert karo
        data.tree.forEach(file => {
            if (file.type !== 'blob') return;
            let current = tree;
            file.path.split('/').forEach((part, i, arr) => {
                if (!current[part]) current[part] = {};
                if (i === arr.length - 1) {
                    current[part].__isFile = true;
                    current[part].path = file.path;
                }
                current = current[part];
            });
        });

        // Nested object se text-based tree banao
        const buildTree = (node, prefix = '') => {
            let result = '';
            const entries = Object.keys(node);
            entries.forEach((entry, i) => {
                const isLast = i === entries.length - 1;
                const connector = isLast ? '└─' : '├─';
                const nextPrefix = prefix + (isLast ? '   ' : '│  ');

                if (node[entry].__isFile) {
                    // --- MAGIC: Full Domain Proxy URL ban raha hai ---
                    const fullProxyUrl = `${origin}/api/get-file?owner=${owner}&repo=${repo}&path=${encodeURIComponent(node[entry].path)}`;
                    result += `${prefix}${connector} ${entry}\n`;
                    result += `${prefix}${isLast ? '   ' : '│  '}└─ 🔗 ${fullProxyUrl}\n`;
                } else {
                    result += `${prefix}${connector} ${entry}/\n`;
                    result += buildTree(node[entry], nextPrefix);
                }
            });
            return result;
        };

        output += buildTree(tree);
        return new Response(output, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

    } catch (e) {
        return new Response(`Server Error: ${e.message}`, { status: 500 });
    }
}
