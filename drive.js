// ── Google Drive / Obsidian Sync ──
const Drive = (() => {
  const CLIENT_ID = '582791233110-avlgld3637i8tcqapp5gs0aglvvehdrs.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/drive';

  // Hardcoded Obsidian folder IDs
  const FOLDER_ID = '1qx8jWqEXupcFjx-gbOuMvZ7qXISardnZ'; // Your main Field Notes folder
  const MEDIA_FOLDER_ID = '1kfRpU-oo9mqJ9aKOXtnZKGw8672XfY3n'; // Your Media folder

  let accessToken = null;
  let tokenClient = null;
  let gapiReady = false;
  let gisReady = false;

  // ── Init ──
  function init() {
    loadScript('https://apis.google.com/js/api.js', () => {
      gapi.load('client', async () => {
        await gapi.client.init({});
        gapiReady = true;
        tryRestoreToken();
      });
    });

    loadScript('https://accounts.google.com/gsi/client', () => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
          if (resp.error) { console.error('OAuth error', resp); return; }
          accessToken = resp.access_token;
          const expiry = Date.now() + (resp.expires_in - 60) * 1000;
          localStorage.setItem('codex_drive_token', JSON.stringify({ token: accessToken, expiry }));
          gapi.client.setToken({ access_token: accessToken });
          updateDriveUI(true);
        },
      });
      gisReady = true;
    });
  }

  function loadScript(src, cb) {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.defer = true; s.onload = cb;
    document.head.appendChild(s);
  }

  function tryRestoreToken() {
    const raw = localStorage.getItem('codex_drive_token');
    if (!raw) return;
    try {
      const { token, expiry } = JSON.parse(raw);
      if (Date.now() < expiry) {
        accessToken = token;
        gapi.client.setToken({ access_token: token });
        updateDriveUI(true);
      } else {
        localStorage.removeItem('codex_drive_token');
      }
    } catch { localStorage.removeItem('codex_drive_token'); }
  }

  // ── Connect / Disconnect ──
  function connect() {
    if (!gisReady) { alert('Still loading, try again in a moment.'); return; }
    tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  function disconnect() {
    if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null;
    localStorage.removeItem('codex_drive_token');
    gapi.client.setToken(null);
    updateDriveUI(false);
  }

  function isConnected() { return !!accessToken; }

  function updateDriveUI(connected) {
    const btn = document.getElementById('btn-drive-connect');
    const status = document.getElementById('drive-status');
    if (!btn) return;
    if (connected) {
      btn.textContent = 'Disconnect Drive';
      btn.classList.add('connected');
      if (status) status.textContent = '✓ Syncing to Obsidian';
    } else {
      btn.textContent = 'Connect to Obsidian';
      btn.classList.remove('connected');
      if (status) status.textContent = '';
    }
  }

  // ── Upload any file using fetch + resumable upload ──
  async function uploadFile(filename, dataUrlOrText, mimeType, targetFolderId) {
    let bodyBytes;

    if (mimeType === 'text/markdown') {
      // plain text
      bodyBytes = new TextEncoder().encode(dataUrlOrText);
    } else {
      // dataURL — strip header and decode base64
      const base64 = dataUrlOrText.split(',')[1];
      const binary = atob(base64);
      bodyBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bodyBytes[i] = binary.charCodeAt(i);
      }
    }

    // Step 1 — initiate resumable upload session
    const metadata = {
      name: filename,
      parents: [targetFolderId],
    };

    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': bodyBytes.length,
        },
        body: JSON.stringify(metadata),
      }
    );

    if (!initRes.ok) {
      const err = await initRes.text();
      throw new Error(`Upload init failed: ${err}`);
    }

    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) throw new Error('No upload URL returned');

    // Step 2 — upload the actual bytes
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'Content-Length': bodyBytes.length,
      },
      body: bodyBytes,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`Upload failed: ${err}`);
    }

    return await uploadRes.json();
  }

  // ── Push a field note to the Obsidian folder ──
  async function pushFieldNote(note) {
    if (!isConnected()) return;

    const status = document.getElementById('drive-status');

    try {
      if (status) status.textContent = '↑ Sending…';

      const d = new Date(note.createdAt);
      const dateStr = d.toISOString().slice(0, 10);
      const timeStr = d.toTimeString().slice(0, 5).replace(':', '-');
      
      const slug = (note.text || 'untitled')
        .slice(0, 40)
        .replace(/[^a-z0-9 ]/gi, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase() || 'note';
      
      const baseName = slug; 

      let md = `---\ncaptured: ${d.toLocaleString('en-GB')}\ntype: field-note\ncollection: "[[Field Notes]]"\n---\n\n`;
      if (note.text) md += `${note.text}\n\n`;

      // Upload photo to MEDIA folder
      if (note.photo) {
        const ext = note.photo.startsWith('data:image/png') ? 'png' : 'jpg';
        const photoName = `${dateStr}_${timeStr}_${baseName}.${ext}`;
        const photoMime = ext === 'png' ? 'image/png' : 'image/jpeg';
        
        // Pass MEDIA_FOLDER_ID to route the image correctly
        await uploadFile(photoName, note.photo, photoMime, MEDIA_FOLDER_ID);
        
        md += `![[${photoName}]]\n\n`;
      }

      if (note.audio) {
        md += `<audio controls src="${note.audio}"></audio>\n\n`;
      }

      md += `---\n*Captured in Codex — expand this spark*\n`;

      // Upload markdown file to main Field Notes folder
      await uploadFile(`${baseName}.md`, md, 'text/markdown', FOLDER_ID);

      if (status) {
        status.textContent = '✓ Saved to Obsidian';
        setTimeout(() => { status.textContent = '✓ Syncing to Obsidian'; }, 3000);
      }

    } catch (err) {
      console.error('Drive sync error:', err);
      if (status) {
        status.textContent = '✗ Sync failed';
        setTimeout(() => { status.textContent = '✓ Syncing to Obsidian'; }, 4000);
      }
    }
  }

  return { init, connect, disconnect, isConnected, pushFieldNote, updateDriveUI };
})();
