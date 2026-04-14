# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install    # Install dependencies
npm start      # Start server (node server.js)
```

The app runs on `http://localhost:3000` (or `PORT` env variable).

## Architecture

Real-time restaurant bill tracking app. Users create/join sessions ("masa") and add items under their name. All updates are broadcast instantly via WebSocket.

**Backend:** `server.js` — Express serves static files from `public/`, Socket.io handles all session logic. Sessions are stored in-memory (`Map`). No database.

**Frontend:** `public/` — Single-page app with two screens (login and app). Vanilla JS with Socket.io client. No build step.

**Socket.io events:**
- `create-session` / `join-session` — session management
- `add-item` / `remove-item` — item CRUD (same name+price increments quantity instead of creating new entry)
- `session-updated` — server broadcasts full session state to all participants
- `error-msg` — validation errors sent to client

**Session sharing:** URL query param `?masa=CODE` auto-fills session code on the login screen and hides the "create" flow, showing only the join form.

## Language

The app UI and code comments are in Turkish.
