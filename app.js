// ── Google Drive API Config ──
const GOOGLE_CLIENT_ID = '582791233110-avlgld3637i8tcqapp5gs0aglvvehdrs.apps.googleusercontent.com';
let driveAccessToken = null;

function initGoogleAuth() {
  const client = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/drive.file',
    callback: (response) => {
      if (response && response.access_token) {
        driveAccessToken = response.access_token;
        const btn = document.getElementById('btn-connect-drive');
        btn.textContent = 'Drive Connected ✓';
        btn.style.background = '#0f9d58';
        btn.disabled = true;
      }
    },
  });
  document.getElementById('btn-connect-drive').addEventListener('click', () => {
    client.requestAccessToken();
  });
}

window.addEventListener('load', () => {
  if (typeof google !== 'undefined') initGoogleAuth();
});

// ── Storage ──
const DB = {
  get: (key) => JSON.parse(localStorage.getItem(key) || '[]'),
  set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
};
const KEYS = { tasks: 'codex-tasks', notes: 'codex-notes', goals: 'codex-goals' };
const uid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

// ── Decay ──
const DECAY_MS = 4 * 24 * 60 * 60 * 1000;
function decayLevel(task) {
  if (task.completed || task.archived || task.decayExempt) return 'fresh';
  const ref = task.renewedAt ?? task.createdAt;
  const age = Date.now() - ref;
  if (age < DECAY_MS * 0.5) return 'fresh';
  if (age < DECAY_MS) return 'aging';
  return 'old';
}
function runDecay() {
  let tasks = DB.get(KEYS.tasks);
  let goals = DB.get(KEYS.goals);
  let changed = false;
  tasks = tasks.map(t => {
    if (decayLevel(t) === 'old' && !t.archived) { changed = true; return { ...t, archived: true }; }
    return t;
  });
  if (changed) {
    DB.set(KEYS.tasks, tasks);
    goals = goals.map(g => ({
      ...g,
      steps: g.steps.map(s => {
        if (s.type === 'task' && s.pushedToTasks && !s.completed) {
          const linked = tasks.find(t => t.id === s.taskId);
          if (linked?.archived) return { ...s, needsNewStep: true };
        }
        return s;
      })
    }));
    DB.set(KEYS.goals, goals);
  }
}

// ── Swipe delete (tasks + notes) — red zone, full swipe = delete ──
const DELETE_THRESHOLD = 180;

function initSwipeDelete(rowEl, onDelete) {
  const inner = rowEl.querySelector('.swipe-inner');
  if (!inner) return;
  let startX = 0, startY = 0, dx = 0, axis = null, active = false;

  inner.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0; axis = null; active = true;
    inner.style.transition = 'none';
  }, { passive: true });

  inner.addEventListener('touchmove', e => {
    if (!active) return;
    const mx = e.touches[0].clientX - startX;
    const my = e.touches[0].clientY - startY;
    if (!axis) axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    if (axis === 'y') return;
    e.preventDefault();
    if (mx > 0) return;
    dx = mx;
    inner.style.transform = `translateX(${dx}px)`;
  }, { passive: false });

  inner.addEventListener('touchend', () => {
    if (!active || axis !== 'x') { active = false; return; }
    active = false;
    inner.style.transition = 'transform 0.22s ease';
    if (Math.abs(dx) >= DELETE_THRESHOLD) {
      inner.style.transform = 'translateX(-110%)';
      rowEl.style.transition = 'max-height 0.28s ease, opacity 0.28s ease';
      rowEl.style.overflow = 'hidden';
      rowEl.style.maxHeight = rowEl.offsetHeight + 'px';
      requestAnimationFrame(() => { rowEl.style.maxHeight = '0'; rowEl.style.opacity = '0'; });
      setTimeout(onDelete, 320);
    } else {
      inner.style.transform = 'translateX(0)';
    }
  });

  document.addEventListener('touchstart', e => {
    if (!rowEl.contains(e.target)) {
      inner.style.transition = 'transform 0.22s ease';
      inner.style.transform = 'translateX(0)';
    }
  }, { passive: true });
}

// ── Swipe for goals — grey zone slides, releases to open sheet ──
const GOAL_REVEAL = 110;

function initSwipeGoal(rowEl, onRelease) {
  const inner = rowEl.querySelector('.goal-swipe-inner');
  if (!inner) return;
  let startX = 0, startY = 0, dx = 0, axis = null, active = false;

  inner.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0; axis = null; active = true;
    inner.style.transition = 'none';
  }, { passive: true });

  inner.addEventListener('touchmove', e => {
    if (!active) return;
    const mx = e.touches[0].clientX - startX;
    const my = e.touches[0].clientY - startY;
    if (!axis) axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    if (axis === 'y') return;
    e.preventDefault();
    if (mx > 0) return;
    dx = Math.max(mx, -GOAL_REVEAL);
    inner.style.transform = `translateX(${dx}px)`;
  }, { passive: false });

  inner.addEventListener('touchend', () => {
    if (!active || axis !== 'x') { active = false; return; }
    active = false;
    inner.style.transition = 'transform 0.22s ease';
    inner.style.transform = 'translateX(0)';
    if (Math.abs(dx) >= 60) {
      onRelease();
    }
  });

  document.addEventListener('touchstart', e => {
    if (!rowEl.contains(e.target)) {
      inner.style.transition = 'transform 0.22s ease';
      inner.style.transform = 'translateX(0)';
    }
  }, { passive: true });
}

// ── Long press → show ✕ on step or checklist item ──
const LONG_PRESS_MS = 1000;

function initLongPressDelete(el, xBtn, onDelete) {
  let timer = null;

  const start = () => {
    timer = setTimeout(() => {
      el.classList.add('long-press-active');
      xBtn.classList.add('visible');
    }, LONG_PRESS_MS);
  };

  const cancel = () => {
    clearTimeout(timer);
  };

  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', cancel, { passive: true });
  el.addEventListener('touchmove', cancel, { passive: true });

  xBtn.addEventListener('click', e => {
    e.stopPropagation();
    onDelete();
  });

  document.addEventListener('touchstart', e => {
    if (!el.contains(e.target) && !xBtn.contains(e.target)) {
      el.classList.remove('long-press-active');
      xBtn.classList.remove('visible');
    }
  }, { passive: true });
}

// ── Nav ──
function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => { v.classList.add('hidden'); v.classList.remove('active'); });
      btn.classList.add('active');
      const view = document.getElementById(`view-${btn.dataset.view}`);
      view.classList.remove('hidden');
      view.classList.add('active');
    });
  });
}

// ── Tasks ──
let sprintActive = false, sprintTimer = null, sessionCompleted = [];

function renderTasks() {
  const all = DB.get(KEYS.tasks);
  const active = all.filter(t => !t.archived && !t.completed);
  const today = active.filter(t => t.today);
  const other = active.filter(t => !t.today);
  const list = document.getElementById('task-list');
  const sprintEl = document.getElementById('sprint-levels');
  list.innerHTML = ''; sprintEl.innerHTML = '';

  if (sprintActive) {
    sprintEl.classList.remove('hidden');
    list.classList.add('hidden');
    renderSprint(active, sprintEl);
  } else {
    sprintEl.classList.add('hidden');
    list.classList.remove('hidden');
    if (today.length) { appendHeader(list, 'Today'); today.forEach(t => list.appendChild(makeTaskRow(t))); }
    if (other.length) { appendHeader(list, today.length ? 'Other' : 'All Tasks'); other.forEach(t => list.appendChild(makeTaskRow(t))); }
    if (!active.length) {
      const e = document.createElement('li'); e.className = 'empty-state'; e.textContent = 'No tasks yet.';
      list.appendChild(e);
    }
  }
  renderCompletedTray();
}

function appendHeader(list, text) {
  const h = document.createElement('li'); h.className = 'list-section-header'; h.textContent = text;
  list.appendChild(h);
}

function makeTaskRow(task) {
  const row = document.createElement('li');
  row.className = 'swipe-row'; row.style.listStyle = 'none';

  const deleteZone = document.createElement('div');
  deleteZone.className = 'swipe-delete-zone'; deleteZone.textContent = 'Delete';

  const inner = document.createElement('div');
  inner.className = 'swipe-inner task-item';
  inner.dataset.decay = decayLevel(task);

  const parentThread = task.parentGoalId
    ? `<span class="task-parent" style="border-left-color:${task.parentGoalColor}">${task.parentGoalLabel}</span>` : '';
  const renewBtn = decayLevel(task) !== 'fresh'
    ? `<button class="task-renew" data-id="${task.id}">↺</button>` : '';

  inner.innerHTML = `
    <button class="task-check" data-id="${task.id}"></button>
    <div class="task-body">
      ${parentThread}
      <span class="task-title">${task.title}</span>
      <div class="task-meta">
        <span class="task-weight">${task.weight}</span>
        <button class="task-today-btn ${task.today ? 'active' : ''}" data-id="${task.id}">
          ${task.today ? '● Today' : '○ Today'}
        </button>
      </div>
    </div>
    ${renewBtn}
  `;

  row.appendChild(deleteZone);
  row.appendChild(inner);

  initSwipeDelete(row, () => {
    let tasks = DB.get(KEYS.tasks);
    tasks = tasks.filter(t => t.id !== task.id);
    DB.set(KEYS.tasks, tasks);
    renderTasks();
  });
  return row;
}

function renderSprint(tasks, container) {
  const levels = [{ key: 'heavy', label: 'Heavy' }, { key: 'solid', label: 'Solid' }, { key: 'light', label: 'Light' }];
  let prevDone = true;
  levels.forEach(({ key, label }) => {
    const group = tasks.filter(t => t.weight === key);
    if (!group.length) return;
    const div = document.createElement('div');
    div.className = 'sprint-level'; div.dataset.locked = String(!prevDone);
    div.innerHTML = `<div class="sprint-level-header">${label}</div>`;
    const ul = document.createElement('ul'); ul.style.listStyle = 'none';
    group.forEach(t => ul.appendChild(makeTaskRow(t)));
    div.appendChild(ul); container.appendChild(div);
    prevDone = group.every(t => t.completed);
  });
}

function renderCompletedTray() {
  let tray = document.getElementById('completed-tray');
  if (!tray) {
    tray = document.createElement('div'); tray.id = 'completed-tray';
    document.getElementById('view-tasks').appendChild(tray);
  }
  if (!sessionCompleted.length) { tray.innerHTML = ''; return; }
  tray.innerHTML = `
    <button id="tray-toggle" class="tray-toggle">✓ ${sessionCompleted.length} done <span id="tray-arrow">▾</span></button>
    <ul id="tray-list" class="tray-list hidden"></ul>
  `;
  const trayList = tray.querySelector('#tray-list');
  sessionCompleted.forEach(task => {
    const li = document.createElement('li'); li.className = 'tray-item';
    li.innerHTML = `<span class="tray-title">${task.title}</span><button class="tray-undo" data-id="${task.id}">Undo</button>`;
    trayList.appendChild(li);
  });
  tray.querySelector('#tray-toggle').addEventListener('click', () => {
    trayList.classList.toggle('hidden');
    tray.querySelector('#tray-arrow').textContent = trayList.classList.contains('hidden') ? '▾' : '▴';
  });
  trayList.addEventListener('click', e => {
    const btn = e.target.closest('.tray-undo'); if (!btn) return;
    const tasks = DB.get(KEYS.tasks);
    const idx = tasks.findIndex(t => t.id === btn.dataset.id);
    if (idx > -1) { tasks[idx].completed = false; DB.set(KEYS.tasks, tasks); }
    sessionCompleted = sessionCompleted.filter(t => t.id !== btn.dataset.id);
    renderTasks();
  });
}

function initTasks() {
  const sprintBtn = document.getElementById('btn-sprint');
  sprintBtn.addEventListener('pointerdown', () => {
    sprintTimer = setTimeout(() => {
      sprintActive = !sprintActive;
      sprintBtn.textContent = sprintActive ? 'Sprint: ON' : 'Sprint';
      sprintBtn.classList.toggle('active-mode', sprintActive);
      renderTasks();
    }, 2000);
  });
  sprintBtn.addEventListener('pointerup', () => clearTimeout(sprintTimer));
  sprintBtn.addEventListener('pointerleave', () => clearTimeout(sprintTimer));

  document.getElementById('form-task').addEventListener('submit', e => {
    e.preventDefault();
    const title = document.getElementById('input-title').value.trim();
    const weight = document.getElementById('input-weight').value;
    if (!title) return;
    const tasks = DB.get(KEYS.tasks);
    tasks.push({
      id: uid('t'), title, weight, today: false,
      parentGoalId: null, parentGoalLabel: null, parentGoalColor: null,
      createdAt: Date.now(), renewedAt: null, completed: false, archived: false, decayExempt: false,
    });
    DB.set(KEYS.tasks, tasks); e.target.reset(); renderTasks();
  });

  const handleAction = e => {
    const checkBtn = e.target.closest('.task-check');
    const renewBtn = e.target.closest('.task-renew');
    const todayBtn = e.target.closest('.task-today-btn');
    if (checkBtn) {
      const tasks = DB.get(KEYS.tasks);
      const idx = tasks.findIndex(t => t.id === checkBtn.dataset.id);
      if (idx > -1) { tasks[idx].completed = true; sessionCompleted.unshift({ ...tasks[idx] }); DB.set(KEYS.tasks, tasks); renderTasks(); }
    }
    if (renewBtn) {
      const tasks = DB.get(KEYS.tasks);
      const idx = tasks.findIndex(t => t.id === renewBtn.dataset.id);
      if (idx > -1) { tasks[idx].renewedAt = Date.now(); DB.set(KEYS.tasks, tasks); renderTasks(); }
    }
    if (todayBtn) {
      const tasks = DB.get(KEYS.tasks);
      const idx = tasks.findIndex(t => t.id === todayBtn.dataset.id);
      if (idx > -1) { tasks[idx].today = !tasks[idx].today; DB.set(KEYS.tasks, tasks); renderTasks(); }
    }
  };
  document.getElementById('task-list').addEventListener('click', handleAction);
  document.getElementById('sprint-levels').addEventListener('click', handleAction);
}

// ── Field Notes ──
let pendingPhoto = null, pendingAudioBlob = null, pendingAudioUrl = null;
let mediaRecorder = null, audioChunks = [], isRecording = false;

function blobToDataUrl(blob) {
  return new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(blob); });
}
function setAudioBars(el, state) {
  el.classList.remove('recording', 'playing');
  if (state === 'recording') el.classList.add('recording');
  if (state === 'playing') el.classList.add('playing');
}

function renderNotes() {
  const notes = DB.get(KEYS.notes);
  const list = document.getElementById('notes-list');
  list.innerHTML = '';
  if (!notes.length) { list.innerHTML = '<li class="empty-state">No field notes yet.</li>'; return; }
  notes.forEach(n => {
    const row = document.createElement('div'); row.className = 'swipe-row';
    const deleteZone = document.createElement('div'); deleteZone.className = 'swipe-delete-zone'; deleteZone.textContent = 'Delete';
    const inner = document.createElement('div'); inner.className = 'swipe-inner note-item';
    const d = new Date(n.createdAt);
    const ts = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
      + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    inner.innerHTML = `<span class="note-timestamp">${ts}</span>`;
    if (n.photo) { const img = document.createElement('img'); img.className = 'note-photo'; img.src = n.photo; inner.appendChild(img); }
    if (n.text) { const p = document.createElement('p'); p.className = 'note-text'; p.textContent = n.text; inner.appendChild(p); }
    if (n.audio) {
      const audioDiv = document.createElement('div'); audioDiv.className = 'note-audio';
      audioDiv.innerHTML = `
        <button class="note-audio-play">▶</button>
        <div class="note-audio-bars">
          <span class="bar"></span><span class="bar"></span>
          <span class="bar"></span><span class="bar"></span><span class="bar"></span>
        </div>`;
      const playBtn = audioDiv.querySelector('.note-audio-play');
      const bars = audioDiv.querySelector('.note-audio-bars');
      let audio = null;
      playBtn.addEventListener('click', () => {
        if (audio && !audio.paused) {
          audio.pause(); audio.currentTime = 0;
          playBtn.textContent = '▶'; setAudioBars(bars, 'idle'); return;
        }
        audio = new Audio(n.audio);
        playBtn.textContent = '■'; setAudioBars(bars, 'playing');
        audio.play();
        audio.onended = () => { playBtn.textContent = '▶'; setAudioBars(bars, 'idle'); };
      });
      inner.appendChild(audioDiv);
    }
    row.appendChild(deleteZone); row.appendChild(inner);
    initSwipeDelete(row, () => {
      let nts = DB.get(KEYS.notes); nts = nts.filter(nn => nn.id !== n.id); DB.set(KEYS.notes, nts); renderNotes();
    });
    list.appendChild(row);
  });
}

function initFieldNotes() {
  const textarea = document.getElementById('input-note');
  const counter = document.getElementById('char-count');
  textarea.addEventListener('input', () => { counter.textContent = `${textarea.value.length} / 140`; });

  document.getElementById('camera-input').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      pendingPhoto = ev.target.result;
      document.getElementById('preview-img').src = pendingPhoto;
      document.getElementById('photo-preview').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('btn-clear-photo').addEventListener('click', () => {
    pendingPhoto = null;
    document.getElementById('photo-preview').classList.add('hidden');
    document.getElementById('camera-input').value = '';
  });

  const recordBtn = document.getElementById('btn-record');
  const captureUI = document.getElementById('audio-capture-ui');
  const captureBars = document.getElementById('capture-bars');
  const statusLabel = document.getElementById('audio-status-label');
  const playPreviewBtn = document.getElementById('btn-play-preview');
  let previewAudioObj = null;

  recordBtn.addEventListener('click', async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = () => {
          pendingAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          pendingAudioUrl = URL.createObjectURL(pendingAudioBlob);
          stream.getTracks().forEach(t => t.stop());
          setAudioBars(captureBars, 'idle');
          statusLabel.textContent = 'Recorded';
          playPreviewBtn.classList.remove('hidden');
          recordBtn.textContent = 'Record';
          recordBtn.classList.remove('recording');
          isRecording = false;
        };
        mediaRecorder.start();
        isRecording = true;
        captureUI.classList.remove('hidden');
        setAudioBars(captureBars, 'recording');
        statusLabel.textContent = 'Recording…';
        recordBtn.textContent = '■ Stop';
        recordBtn.classList.add('recording');
      } catch { alert('Microphone access denied.'); }
    } else {
      mediaRecorder.stop();
    }
  });

  playPreviewBtn.addEventListener('click', () => {
    if (!pendingAudioUrl) return;
    if (previewAudioObj && !previewAudioObj.paused) {
      previewAudioObj.pause(); previewAudioObj.currentTime = 0;
      playPreviewBtn.textContent = '▶'; setAudioBars(captureBars, 'idle'); return;
    }
    previewAudioObj = new Audio(pendingAudioUrl);
    playPreviewBtn.textContent = '■'; setAudioBars(captureBars, 'playing');
    previewAudioObj.play();
    previewAudioObj.onended = () => { playPreviewBtn.textContent = '▶'; setAudioBars(captureBars, 'idle'); };
  });

  document.getElementById('btn-clear-audio').addEventListener('click', () => {
    pendingAudioBlob = null; pendingAudioUrl = null;
    captureUI.classList.add('hidden');
    playPreviewBtn.classList.add('hidden'); playPreviewBtn.textContent = '▶';
    setAudioBars(captureBars, 'idle');
    statusLabel.textContent = 'Ready';
    recordBtn.textContent = 'Record'; recordBtn.classList.remove('recording');
  });

  document.getElementById('form-note').addEventListener('submit', async e => {
    e.preventDefault();
    const text = document.getElementById('input-note').value.trim();
    if (!text && !pendingPhoto && !pendingAudioBlob) return;
    let audioDataUrl = null;
    if (pendingAudioBlob) audioDataUrl = await blobToDataUrl(pendingAudioBlob);
    const notes = DB.get(KEYS.notes);
    notes.unshift({ id: uid('fn'), text, photo: pendingPhoto ?? null, audio: audioDataUrl, createdAt: Date.now() });
    DB.set(KEYS.notes, notes);

    // Push text to Google Drive for Obsidian
    if (driveAccessToken && text) {
      uploadNoteToDrive(text, notes[0].createdAt);
    }

    e.target.reset(); counter.textContent = '0 / 140';
    pendingPhoto = null; pendingAudioBlob = null; pendingAudioUrl = null;
    document.getElementById('photo-preview').classList.add('hidden');
    captureUI.classList.add('hidden');
    playPreviewBtn.classList.add('hidden'); playPreviewBtn.textContent = '▶';
    setAudioBars(captureBars, 'idle'); statusLabel.textContent = 'Ready';
    recordBtn.textContent = 'Record'; recordBtn.classList.remove('recording');
    document.getElementById('camera-input').value = '';
    renderNotes();
  });
}

// ── Creative Codex ──
let sheetGoalId = null;

function goalPreview(goal) {
  if (goal.description) return goal.description;
  const t = goal.steps.filter(s => s.type === 'task').length;
  const l = goal.steps.filter(s => s.type === 'checklist').length;
  const parts = [];
  if (t) parts.push(`${t} task${t > 1 ? 's' : ''}`);
  if (l) parts.push(`${l} list${l > 1 ? 's' : ''}`);
  return parts.length ? parts.join(' · ') : 'No steps yet';
}

function renderGoals() {
  const goals = DB.get(KEYS.goals);
  const list = document.getElementById('goals-list');
  list.innerHTML = '';
  if (!goals.length) { list.innerHTML = '<li class="empty-state">No goals yet.</li>'; return; }
  goals.forEach(g => list.appendChild(makeGoalItem(g)));
}

function makeGoalItem(goal) {
  const li = document.createElement('li');
  li.className = 'goal-item'; li.dataset.goalId = goal.id;

  const row = document.createElement('div'); row.className = 'goal-swipe-row';

  const greyZone = document.createElement('div');
  greyZone.className = 'goal-grey-zone'; greyZone.textContent = 'Options';

  const inner = document.createElement('div'); inner.className = 'goal-swipe-inner';

  const summary = document.createElement('div'); summary.className = 'goal-summary';
  summary.innerHTML = `
    <span class="goal-swatch" style="background:${goal.color}"></span>
    <span class="goal-summary-text">
      <span class="goal-title-text">${goal.title}</span>
      <span class="goal-preview">${goalPreview(goal)}</span>
    </span>
    <span class="goal-chevron">▾</span>
  `;

  const body = document.createElement('div'); body.className = 'goal-body';
  body.innerHTML = buildGoalBody(goal);

  inner.appendChild(summary);
  inner.appendChild(body);
  row.appendChild(greyZone);
  row.appendChild(inner);
  li.appendChild(row);

  summary.addEventListener('click', () => {
    li.classList.toggle('open');
    if (li.classList.contains('open')) initGoalBodyEvents(body, goal.id, li);
  });

  initSwipeGoal(row, () => openGoalSheet(goal.id));

  return li;
}

function buildGoalBody(goal) {
  const stepsHtml = goal.steps.map(s => buildStepHtml(goal, s)).join('');
  return `
    ${goal.description ? `<p class="goal-description">${goal.description}</p>` : ''}
    <ul class="steps-list">${stepsHtml}</ul>
    <div class="goal-add-row">
      <button class="btn-add-step" data-step-type="task">+ Task</button>
      <button class="btn-add-step" data-step-type="checklist">+ List</button>
    </div>
    <div class="inline-step-form hidden">
      <input type="text" class="inline-step-input" placeholder="Name it" maxlength="100" />
      <button type="button" class="cancel-inline">✕</button>
      <button type="button" class="confirm-inline confirm">↵</button>
    </div>
  `;
}

function buildStepHtml(goal, s) {
  if (s.type === 'checklist') {
    const hasDone = (s.items || []).some(i => i.done);
    const itemsHtml = (s.items || []).map(item => `
      <li class="checklist-item ${item.done ? 'done' : ''}" data-item-id="${item.id}" data-step-id="${s.id}" data-goal-id="${goal.id}">
        <button class="check-item-btn ${item.done ? 'checked' : ''}"
          data-goal-id="${goal.id}" data-step-id="${s.id}" data-item-id="${item.id}"></button>
        <span>${item.label}</span>
        <button class="item-delete-x" data-goal-id="${goal.id}" data-step-id="${s.id}" data-item-id="${item.id}">✕</button>
      </li>`).join('');
    return `
      <li class="step-item" data-step-id="${s.id}" data-goal-id="${goal.id}">
        <div class="step-header">
          <span class="step-type-badge">list</span>
          <span class="step-title">${s.title}</span>
          <button class="step-delete-x" data-goal-id="${goal.id}" data-step-id="${s.id}">✕</button>
        </div>
        <ul class="checklist-items">${itemsHtml}</ul>
        ${hasDone ? `<button class="btn-clear-done" data-goal-id="${goal.id}" data-step-id="${s.id}">Clear done</button>` : ''}
        <form class="form-add-check-item" data-goal-id="${goal.id}" data-step-id="${s.id}">
          <input type="text" class="input-check-item" placeholder="Add item" maxlength="80" />
          <button type="submit">+</button>
        </form>
      </li>`;
  }
  return `
    <li class="step-item ${s.completed ? 'done' : ''}" data-step-id="${s.id}" data-goal-id="${goal.id}">
      <div class="step-header">
        <span class="step-type-badge">task</span>
        <span class="step-title">${s.title}</span>
        <button class="step-delete-x" data-goal-id="${goal.id}" data-step-id="${s.id}">✕</button>
      </div>
      <div class="step-actions">
        ${!s.pushedToTasks && !s.completed
          ? `<button class="btn-push" data-goal-id="${goal.id}" data-step-id="${s.id}">Push to Tasks</button>` : ''}
        ${s.pushedToTasks && !s.completed ? `<span class="step-badge">In Tasks</span>` : ''}
        ${s.needsNewStep ? `<span class="step-badge warn">Set new step</span>` : ''}
        ${s.completed ? `<span class="step-badge">Done</span>` : ''}
      </div>
    </li>`;
}

function initGoalBodyEvents(body, goalId, li) {
  if (body._eventsInited) return;
  body._eventsInited = true;

  function bindLongPresses() {
    body.querySelectorAll('.step-item').forEach(stepEl => {
      const xBtn = stepEl.querySelector('.step-delete-x');
      if (!xBtn || stepEl._lpInited) return;
      stepEl._lpInited = true;
      initLongPressDelete(stepEl, xBtn, () => {
        const { goalId: gId, stepId } = xBtn.dataset;
        const goals = DB.get(KEYS.goals);
        const goal = goals.find(g => g.id === gId);
        if (!goal) return;
        goal.steps = goal.steps.filter(s => s.id !== stepId);
        DB.set(KEYS.goals, goals);
        body.querySelector('.steps-list').innerHTML = goal.steps.map(s => buildStepHtml(goal, s)).join('');
        updateGoalPreview(li, goal);
        bindLongPresses();
      });
    });

    body.querySelectorAll('.checklist-item').forEach(itemEl => {
      const xBtn = itemEl.querySelector('.item-delete-x');
      if (!xBtn || itemEl._lpInited) return;
      itemEl._lpInited = true;
      initLongPressDelete(itemEl, xBtn, () => {
        const { goalId: gId, stepId, itemId } = xBtn.dataset;
        const goals = DB.get(KEYS.goals);
        const goal = goals.find(g => g.id === gId);
        const step = goal?.steps.find(s => s.id === stepId);
        if (!step) return;
        step.items = step.items.filter(i => i.id !== itemId);
        DB.set(KEYS.goals, goals);
        body.querySelector('.steps-list').innerHTML = goal.steps.map(s => buildStepHtml(goal, s)).join('');
        bindLongPresses();
      });
    });
  }
  bindLongPresses();

  body.addEventListener('click', e => {
    const addBtn = e.target.closest('.btn-add-step');
    if (addBtn) {
      const form = body.querySelector('.inline-step-form');
      const input = form.querySelector('.inline-step-input');
      form.classList.remove('hidden');
      form.dataset.stepType = addBtn.dataset.stepType;
      input.placeholder = addBtn.dataset.stepType === 'task' ? 'Task name' : 'List name';
      input.focus();
    }

    if (e.target.closest('.confirm-inline')) submitInlineStep(body, goalId, li);
    if (e.target.closest('.cancel-inline')) body.querySelector('.inline-step-form').classList.add('hidden');

    const pushBtn = e.target.closest('.btn-push');
    if (pushBtn) {
      const { goalId: gId, stepId } = pushBtn.dataset;
      const goals = DB.get(KEYS.goals);
      const goal = goals.find(g => g.id === gId);
      const step = goal?.steps.find(s => s.id === stepId);
      if (!goal || !step) return;
      const taskId = uid('t');
      const tasks = DB.get(KEYS.tasks);
      tasks.push({
        id: taskId, title: step.title, weight: 'solid', today: false,
        parentGoalId: goal.id, parentGoalLabel: goal.title, parentGoalColor: goal.color,
        createdAt: Date.now(), renewedAt: null, completed: false, archived: false, decayExempt: false,
      });
      DB.set(KEYS.tasks, tasks);
      step.pushedToTasks = true; step.taskId = taskId;
      DB.set(KEYS.goals, goals);
      renderTasks();
      body.querySelector('.steps-list').innerHTML = goal.steps.map(s => buildStepHtml(goal, s)).join('');
      bindLongPresses();
    }

    const checkBtn = e.target.closest('.check-item-btn');
    if (checkBtn) {
      const { goalId: gId, stepId, itemId } = checkBtn.dataset;
      const goals = DB.get(KEYS.goals);
      const goal = goals.find(g => g.id === gId);
      const step = goal?.steps.find(s => s.id === stepId);
      const item = step?.items.find(i => i.id === itemId);
      if (!item) return;
      item.done = !item.done;
      DB.set(KEYS.goals, goals);
      body.querySelector('.steps-list').innerHTML = goal.steps.map(s => buildStepHtml(goal, s)).join('');
      bindLongPresses();
    }

    const clearBtn = e.target.closest('.btn-clear-done');
    if (clearBtn) {
      const { goalId: gId, stepId } = clearBtn.dataset;
      const goals = DB.get(KEYS.goals);
      const goal = goals.find(g => g.id === gId);
      const step = goal?.steps.find(s => s.id === stepId);
      if (!step) return;
      step.items = step.items.filter(i => !i.done);
      DB.set(KEYS.goals, goals);
      body.querySelector('.steps-list').innerHTML = goal.steps.map(s => buildStepHtml(goal, s)).join('');
      bindLongPresses();
    }
  });

  body.addEventListener('submit', e => {
    const checkForm = e.target.closest('.form-add-check-item'); if (!checkForm) return;
    e.preventDefault();
    const input = checkForm.querySelector('.input-check-item');
    const label = input.value.trim(); if (!label) return;
    const { goalId: gId, stepId } = checkForm.dataset;
    const goals = DB.get(KEYS.goals);
    const goal = goals.find(g => g.id === gId);
    const step = goal?.steps.find(s => s.id === stepId);
    if (!step) return;
    step.items.push({ id: uid('i'), label, done: false });
    DB.set(KEYS.goals, goals);
    input.value = '';
    body.querySelector('.steps-list').innerHTML = goal.steps.map(s => buildStepHtml(goal, s)).join('');
    bindLongPresses();
  });

  const inlineInput = body.querySelector('.inline-step-input');
  if (inlineInput) {
    inlineInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submitInlineStep(body, goalId, li); }
    });
  }
}

function submitInlineStep(body, goalId, li) {
  const form = body.querySelector('.inline-step-form');
  const input = form.querySelector('.inline-step-input');
  const title = input.value.trim(); if (!title) return;
  const stepType = form.dataset.stepType;
  const goals = DB.get(KEYS.goals);
  const goal = goals.find(g => g.id === goalId); if (!goal) return;
  const step = stepType === 'checklist'
    ? { id: uid('s'), type: 'checklist', title, items: [] }
    : { id: uid('s'), type: 'task', title, pushedToTasks: false, taskId: null, completed: false, needsNewStep: false };
  goal.steps.push(step);
  DB.set(KEYS.goals, goals);
  input.value = ''; form.classList.add('hidden');
  body.querySelector('.steps-list').innerHTML = goal.steps.map(s => buildStepHtml(goal, s)).join('');
  updateGoalPreview(li, goal);
  if (body._eventsInited) {
    body.querySelectorAll('.step-item').forEach(stepEl => { stepEl._lpInited = false; });
    body.querySelectorAll('.checklist-item').forEach(itemEl => { itemEl._lpInited = false; });
    const bindFn = body._bindLongPresses;
    if (bindFn) bindFn();
  }
}

function updateGoalPreview(li, goal) {
  const preview = li.querySelector('.goal-preview');
  if (preview) preview.textContent = goalPreview(goal);
}

// ── Goal Action Sheet ──
function openGoalSheet(goalId) {
  const goals = DB.get(KEYS.goals);
  const goal = goals.find(g => g.id === goalId); if (!goal) return;
  sheetGoalId = goalId;
  document.getElementById('sheet-goal-name').textContent = goal.title;
  document.getElementById('sheet-goal-title').value = goal.title;
  document.getElementById('sheet-goal-desc').value = goal.description || '';
  document.getElementById('sheet-goal-color').value = goal.color;
  document.getElementById('goal-sheet-backdrop').classList.remove('hidden');
  document.getElementById('goal-action-sheet').classList.remove('hidden');
}

function closeGoalSheet() {
  sheetGoalId = null;
  document.getElementById('goal-sheet-backdrop').classList.add('hidden');
  document.getElementById('goal-action-sheet').classList.add('hidden');
}

function initGoalSheet() {
  document.getElementById('goal-sheet-backdrop').addEventListener('click', closeGoalSheet);
  document.getElementById('sheet-save-btn').addEventListener('click', () => {
    if (!sheetGoalId) return;
    const goals = DB.get(KEYS.goals);
    const goal = goals.find(g => g.id === sheetGoalId); if (!goal) return;
    goal.title = document.getElementById('sheet-goal-title').value.trim() || goal.title;
    goal.description = document.getElementById('sheet-goal-desc').value.trim();
    goal.color = document.getElementById('sheet-goal-color').value;
    DB.set(KEYS.goals, goals);
    closeGoalSheet(); renderGoals();
  });
  document.getElementById('sheet-delete-btn').addEventListener('click', () => {
    if (!sheetGoalId) return;
    let goals = DB.get(KEYS.goals);
    goals = goals.filter(g => g.id !== sheetGoalId);
    DB.set(KEYS.goals, goals);
    closeGoalSheet(); renderGoals();
  });
}

function initCreative() {
  const modal = document.getElementById('modal-goal');
  document.getElementById('btn-add-goal').addEventListener('click', () => modal.showModal());
  document.getElementById('btn-cancel-goal').addEventListener('click', () => modal.close());
  document.getElementById('form-goal').addEventListener('submit', e => {
    e.preventDefault();
    const title = document.getElementById('input-goal-title').value.trim();
    const description = document.getElementById('input-goal-desc').value.trim();
    const color = document.getElementById('input-goal-color').value;
    if (!title) return;
    const goals = DB.get(KEYS.goals);
    goals.push({ id: uid('g'), title, description, color, createdAt: Date.now(), steps: [] });
    DB.set(KEYS.goals, goals);
    modal.close(); e.target.reset(); renderGoals();
  });
  initGoalSheet();
}

// ── Boot ──
runDecay();
initNav();
initTasks(); renderTasks();
initFieldNotes(); renderNotes();
initCreative(); renderGoals();

// ── Drive Upload Engine ──
const DRIVE_FOLDER_ID = '1qx8jWqEXupcFjx-gbOuMvZ7qXISardnZ';

async function uploadNoteToDrive(text, timestamp) {
  const d = new Date(timestamp);
  
  // Format dates to match Claude's layout (YYYY-MM-DD HH:MM)
  const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  
  // Create the filename
 const filename = `${safeTitle || 'Untitled'}_${dateStr.replace(/[: ]/g, '-')}.md`;
  
  // Build the content exactly like Claude's layout + your new tag
  const content = `---
captured: ${dateStr}
tags: [[Field Notes]]
---


${text}`;

  // Build the file metadata and tell it exactly which folder to drop into
  const metadata = {
    name: filename,
    mimeType: 'text/markdown',
    parents: [DRIVE_FOLDER_ID]
  };

  const metadataBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
  const mediaBlob = new Blob([content], { type: 'text/markdown' });
  const form = new FormData();
  form.append('metadata', metadataBlob);
  form.append('file', mediaBlob);

  try {
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + driveAccessToken },
      body: form
    });
    
    if (response.ok) {
      console.log('Successfully pushed directly to the Field Notes folder!');
    } else {
      console.error('Upload failed:', await response.text());
    }
  } catch (err) {
    console.error('Drive upload error:', err);
  }
}
