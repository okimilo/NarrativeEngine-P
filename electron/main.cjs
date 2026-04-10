const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');

const SERVER_PORT = 3001;

function waitForServer(maxRetries = 40) {
    return new Promise((resolve, reject) => {
        let retries = 0;
        const check = () => {
            http.get(`http://localhost:${SERVER_PORT}/api/campaigns`, (res) => {
                res.resume();
                resolve();
            }).on('error', () => {
                retries++;
                if (retries >= maxRetries) return reject(new Error('Server failed to start within timeout'));
                setTimeout(check, 500);
            });
        };
        check();
    });
}

async function start() {
    try {
        console.log('[Electron] Starting...');

        // app.isPackaged is Electron's official way to detect production vs dev
        const isPackaged = app.isPackaged;

        // Data directory — stored in the OS user-data folder, never inside the ASAR
        process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');
        process.env.NODE_ENV = 'production';

        console.log('[Electron] DATA_DIR:', process.env.DATA_DIR);

        // In production: server.bundle.cjs is a self-contained esbuild bundle (all deps inlined),
        // unpacked from the ASAR so Node can require() it as a real file.
        // In dev: load server.js directly (node_modules are available on disk).
        const serverPath = isPackaged
            ? path.join(process.resourcesPath, 'app.asar.unpacked', 'server.bundle.cjs')
            : path.join(__dirname, '..', 'server.js');

        console.log('[Electron] Loading server from:', serverPath);

        await import(pathToFileURL(serverPath).href);
        console.log('[Electron] Server module loaded');

        await waitForServer();
        console.log('[Electron] Server is ready');

        const win = new BrowserWindow({
            width: 1400,
            height: 900,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
            },
        });

        // Use loadFile so Electron reads dist/index.html directly from the ASAR —
        // no need for Express to serve static files, which had ASAR streaming issues.
        // The React frontend detects window.location.protocol === 'file:' and
        // switches all fetch() calls to absolute http://localhost:3001/api/... URLs.
        const indexPath = isPackaged
            ? path.join(process.resourcesPath, 'app.asar', 'dist', 'index.html')
            : path.join(__dirname, '..', 'dist', 'index.html');

        await win.loadFile(indexPath);
        console.log('[Electron] Window loaded');

        win.on('closed', () => {
            app.quit();
        });
    } catch (err) {
        console.error('[Electron] Fatal error:', err);
        const { dialog } = require('electron');
        dialog.showErrorBox('Startup Error', err.message + '\n\n' + (err.stack || ''));
        app.quit();
    }
}

app.whenReady().then(start);

app.on('window-all-closed', () => {
    app.quit();
});
