# Codex

**A slow, intentional productivity tool for creative minds.**

Codex is a mobile-first PWA built on the philosophy that most productivity apps are designed wrong — too loud, too gamified, too eager to make you feel busy rather than help you actually think. Codex is the opposite. It's a well-machined tool. It gets out of your way.

---

## Philosophy

**Slow Design.** The interface is raw and intentional. No badges, no streaks, no colour-coded priority matrices. Just tasks, observations, and goals — each in their own space.

**The Art of Noticing.** Alongside standard task management, Codex has a structural capture layer called Field Notes — built for the moment an idea strikes. A photo, a few words, an audio clip. The spark, before you lose it.

**Decay over deletion.** Tasks you ignore slowly fade over 4 days. The app becomes a quiet mirror of your real priorities, not your stated ones.

---

## Features

### Tasks
- Add tasks with a weight: **Light**, **Solid**, or **Heavy**
- Mark tasks for **Today** to surface them at the top
- **Sprint Mode** — hold the Sprint button for 2 seconds to activate. Tasks lock into levels by weight. You can't move to the next level until the current one is cleared
- Tasks **decay** over 4 days if untouched — fading visually, then archiving silently
- Swipe left to delete. Completed tasks go to a session tray with an undo option

### Field Notes
- Capture a photo, record audio, and write up to 140 characters
- Each note is timestamped automatically
- **Syncs directly to your Obsidian vault** via Google Drive — each note becomes a `.md` file, ready to expand

### Creative Codex
- Long-term goals live here, separate from daily noise
- Each goal has a title, description, and a colour thread that follows its tasks into the main list
- Break goals into **task steps** (pushable to the main task list) or **checklists** (internal to the goal)
- Goals never decay. Their steps do

---

## Stack

Built entirely with vanilla web technologies — no frameworks, no build tools.

- HTML / CSS / Vanilla JavaScript
- `localStorage` for local data persistence
- Google Drive API (v3) for Obsidian sync
- Deployed as a PWA via GitHub Pages

---

## Setup

1. Open [the app](https://rahilkish.github.io/Codex-Notes-app/) on your Android phone in Chrome
2. Tap the three-dot menu → **Add to Home Screen**
3. It installs as a standalone app — no browser bar, no app store required

To enable Obsidian sync, tap **Connect to Obsidian** in the Field Notes section and sign in with the Google account that owns your Obsidian vault folder on Drive.

---

## Status

Early access. Core features are stable. This is a personal tool being developed in the open.

---

*Designed and built by Rahil Kishanchandani*  
*Slow Design. The Art of Noticing.*
