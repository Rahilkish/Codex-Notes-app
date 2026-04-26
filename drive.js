// ── Google Drive / Obsidian Sync ──
// Handles OAuth, folder lookup, and writing field notes as .md files to Drive

const Drive = (() => {
  const CLIENT_ID = '582791233110-avlgld3637i8tcqapp5gs0aglvvehdrs.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/drive.file';
  const FOLDER_NAME = 'Field Notes';

  let accessToken = null;
  let fieldNotesFolderId = null;
  let tokenClient = null;
  let gapiReady = false;
  let gisReady = false;

  // ── Init ──
  function init() {
    // Load Google API script + GIS script dynamically
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
        callback: async (resp) => {
          if (resp.error) { console.error('OAuth error', resp); return; }
          accessToken = resp.access_token;
          // store token + expiry
          const expiry = Date.now() + (resp.expires_in - 60) * 1000;
          localStorage.setItem('codex_drive_token', JSON.stringify({ token: accessToken, expiry }));
          gapi.client.setToken({ access_token: accessToken });
          fieldNotesFolderId = null; // reset so we re-fetch folder
          updateDriveUI(true);
        },
      });
      gisReady = true;
    });
  }

  function loadScript(src, cb) {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.defer = true;
    s.onload = cb;
    document.head.appendChild(s);
  }

  function tryRestoreToken() {
    const raw = localStorage.getItem('codex_drive_token');
    if (!raw) return;
    const { token, expiry } = JSON.parse(raw);
    if (Date.now() < expiry) {
      accessToken = token;
      gapi.client.setToken({ access_token: token });
      updateDriveUI(true);
    } else {
      localStorage.removeItem('codex_drive_token');
    }
  }

  // ── Connect / Disconnect ──
  function connect() {
    if (!gisReady) { alert('Still loading Google services, try again in a moment.'); return; }
    tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  function disconnect() {
    if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null;
    fieldNotesFolderId = null;
    localStorage.removeItem('codex_drive_token');
    gapi.client.setToken(null);
    updateDriveUI(false);
  }

  function isConnected() { return !!accessToken; }

  // ── UI ──
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

  // ── Folder lookup ──
  async function getOrCreateFolder() {
    if (fieldNotesFolderId) return fieldNotesFolderId;

    // Search for existing folder named "Field Notes"
    const res = await gapi.client.request({
      path: 'https://www.googleapis.com/drive/v3/files',
      method: 'GET',
      params: {
        q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id,name)',
      },
    });

    const files = res.result.files;
    if (files && files.length > 0) {
      fieldNotesFolderId = files[0].id;
      return fieldNotesFolderId;
    }

    // Create it if it doesn't exist
    const created = await gapi.client.request({
      path: 'https://www.googleapis.com/drive/v3/files',
      method: 'POST',
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });

    fieldNotesFolderId = created.result.id;
    return fieldNotesFolderId;
  }

  // ── Upload a file to Drive folder ──
  async function uploadFile(filename, content, mimeType, folderId) {
    const metadata = { name: filename, parents: [folderId] };

    // Use multipart upload
    const boundary = '-------codex_boundary';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    let body;
    let contentType;

    if (typeof content === 'string') {
      // text / markdown
      body = delimiter
        + 'Content-Type: application/json\r\n\r\n'
        + JSON.stringify(metadata)
        + delimiter
        + `Content-Type: ${mimeType}\r\n\r\n`
        + content
        + closeDelimiter;
      contentType = `multipart/related; boundary="${boundary}"`;

      await gapi.client.request({
        path: 'https://www.googleapis.com/upload/drive/v3/files',
        method: 'POST',
        params: { uploadType: 'multipart' },
        headers: { 'Content-Type': contentType },
        body,
      });
    } else {
      // Binary (image / audio) — use base64 encoded resumable upload
      // content is a dataURL string like "data:image/jpeg;base64,..."
      const [header, b64] = content.split(',');
      const binaryMime = header.match(/:(.*?);/)[1];
      const byteChars = atob(b64);
      const byteArr = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);

      // Step 1: initiate resumable upload
      const initRes = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': binaryMime,
            'X-Upload-Content-Length': byteArr.length,
          },
          body: JSON.stringify({ ...metadata }),
        }
      );
      const uploadUrl = initRes.headers.get('Location');

      // Step 2: upload binary
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': binaryMime, 'Content-Length': byteArr.length },
        body: byteArr,
      });
    }
  }

  // ── Push a field note to Drive ──
  async function pushFieldNote(note) {
    if (!isConnected()) return;

    try {
      const folderId = await getOrCreateFolder();
      const d = new Date(note.createdAt);
      const dateStr = d.toISOString().slice(0, 10);
      const timeStr = d.toTimeString().slice(0, 5).replace(':', '-');
      const slug = (note.text || 'untitled').slice(0, 40).replace(/[^a-z0-9 ]/gi, '').trim().replace(/\s+/g, '-').toLowerCase();
      const baseName = `${dateStr}_${timeStr}_${slug}`;

      // Build markdown content
      let md = `---\ncaptured: ${d.toLocaleString('en-GB')}\ntype: field-note\ntags: [spark, capture]\n---\n\n`;
      if (note.text) md += `${note.text}\n\n`;

      let photoFilename = null;
      let audioFilename = null;

      // Upload photo if present
      if (note.photo) {
        const ext = note.photo.includes('image/png') ? 'png' : 'jpg';
        photoFilename = `${baseName}.${ext}`;
        await uploadFile(photoFilename, note.photo, note.photo.split(';')[0].split(':')[1], folderId);
        md += `![photo](${photoFilename})\n\n`;
      }

      // Upload audio if present
      if (note.audio) {
        audioFilename = `${baseName}.webm`;
        await uploadFile(audioFilename, note.audio, 'audio/webm', folderId);
        md += `[🎵 Audio note](${audioFilename})\n\n`;
      }

      md += `---\n*Captured in Codex — expand this spark*\n`;

      // Upload the markdown file
      const mdFilename = `${baseName}.md`;
      await uploadFile(mdFilename, md, 'text/markdown', folderId);

      // Show sync indicator briefly
      showSyncFlash();
    } catch (err) {
      console.error('Drive sync failed:', err);
    }
  }

  function showSyncFlash() {
    const status = document.getElementById('drive-status');
    if (!status) return;
    status.textContent = '↑ Synced to Drive';
    setTimeout(() => { status.textContent = '✓ Syncing to Obsidian'; }, 2000);
  }

  return { init, connect, disconnect, isConnected, pushFieldNote, updateDriveUI };
})();
