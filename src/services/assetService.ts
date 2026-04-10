import { API_BASE as API, ASSET_BASE } from '../lib/apiBase';

/**
 * Downloads a remote image and saves it locally.
 * Returns the local relative path for the image.
 */
export async function downloadImageToLocal(url: string, npcName: string): Promise<string> {
    // Basic sanitization for filename
    const sanitizedName = npcName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${sanitizedName}_${Date.now()}.png`;

    const res = await fetch(`${API}/assets/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, filename }),
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to download image to local storage');
    }

    const data = await res.json();
    // In Electron production (file:// protocol), prefix with the server base so
    // <img src> resolves to http://localhost:3001/assets/portraits/... not file:///.
    return `${ASSET_BASE}${data.path}`; // e.g. /assets/portraits/bob_123.png
}
