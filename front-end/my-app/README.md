# MediAssist IA Frontend

Next.js frontend MVP for local clinical operations testing against the MediAssist backend API.

## Prerequisites

- Node.js 20+
- Backend API running locally (default expected base URL: `http://localhost:4000/api/v1`)

## Environment Configuration

Create a `.env.local` file from `.env.example`:

```bash
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Set the API endpoint in `.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
```

## Install Dependencies

```bash
npm install
```

## Run in Development

```bash
npm run dev
```

Open `http://localhost:3000`.

## Build for Production

```bash
npm run build
npm run start
```

## Features

- First-run setup screen, sign-in and role-aware workspace
- AI chat, global or per patient folder: type a request in plain language (Enter sends, Shift+Enter adds a line)
  - The backend keeps each chat session's conversation, so follow-up questions refer to earlier answers
  - Changes to data (create, update, cancel, delete, add a note) show what will change and wait for Approve or Reject
  - Quick actions insert common requests to complete
- Patient panel (details, pathologies, notes), calendar of appointments, staff accounts (admin)
- RAG uploads per patient (list, delete, replace) and global knowledge uploads (admin)

## Notes

- The frontend sends idempotency keys for AI execute/confirm requests.
- Auth uses bearer token from login response and stores it in localStorage for local MVP convenience.
