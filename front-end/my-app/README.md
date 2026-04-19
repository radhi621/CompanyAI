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

## MVP Features in `app/page.tsx`

- Initial admin bootstrap and login
- Session-aware role display
- AI-first prompt composer (fetch mode + insert mode)
- Document upload flow for pdf/doc/docx/xls/xlsx/txt/csv in rag or non_rag mode
- Prompt shortcuts for common operational actions
- Multi-turn conversation memory passed to the agent for follow-up prompts
- Agent execution timeline with raw payload introspection
- Automatic entity ID memory extracted from AI outputs
- Pin or unpin remembered entity IDs to influence next prompt context
- Context controls: on/off memory toggle, preview of context pack, clear conversation
- Grouped and collapsible context chips (History, Entities, Pending) with per-group include/exclude controls
- Context presets for fast filtering (Full, History only, Entities only, Pending only)
- Destructive action confirmation controls (approve/reject)
- Latest agent response debug panel

## Notes

- The frontend sends idempotency keys for AI execute/confirm requests.
- Auth uses bearer token from login response and stores it in localStorage for local MVP convenience.
