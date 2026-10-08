# CompanyAI / MediAssist IA

CompanyAI is a full-stack medical operations workspace built around the MediAssist IA assistant. The repository contains a TypeScript Express backend and a Next.js frontend for managing patients, doctors, appointments, AI-assisted records, and agent-driven workflows.
<img width="2556" height="1396" alt="image" src="https://github.com/user-attachments/assets/47b36b69-e720-4814-a57c-c9684014f368" />

## Project Structure

- `back-end/` - Express API, MongoDB models, AI and agent services, OpenAPI docs
- `front-end/my-app/` - Next.js console for testing and using the backend

## What It Does

- Authenticates staff with JWT access and refresh tokens
- Manages patients, doctors, schedules, and appointments
- Supports role-based access for admin, doctor, nurse, and secretary users
- Generates and stores AI-assisted medical records
- Uses RAG retrieval with Qdrant for document search and patient-scoped context
- Provides an agent endpoint that can plan and execute supported medical-office actions
- Exposes interactive API docs at `/docs`

## Prerequisites

- Node.js 20 or newer
- Docker (for the local MongoDB container), or MongoDB installed natively
- Qdrant running locally or remotely
- Gemini API key
- Groq API key

## Setup

### 0. Database (MongoDB in Docker)

From the repository root:

```bash
docker compose up -d     # create/start MongoDB (data persists in the companyai-mongo-data volume)
docker compose stop      # pause it
docker compose start     # resume it
docker compose down      # remove the container (data is kept)
docker compose down -v   # remove the container AND delete all data
```

Open a shell on the database with `docker exec -it companyai-mongo mongosh medical`.

MongoDB is exposed on `127.0.0.1:27017` by default. If that port is already taken (for example by a native MongoDB service), create a root `.env` file with `MONGO_PORT=27018` and use that port in `MONGODB_URI`.

### 1. Backend environment

Create `back-end/.env` from `back-end/.env.example` and set your values.

Use a local MongoDB URI, for example:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/medical
```

Other required backend values include JWT secrets, `BOOTSTRAP_ADMIN_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, and `QDRANT_URL`.

### 2. Frontend environment

Create `front-end/my-app/.env.local` from `front-end/my-app/.env.example` and point it to the backend API:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
```

## Install Dependencies

Install backend dependencies:

```bash
cd back-end
npm install
```

Install frontend dependencies:

```bash
cd front-end/my-app
npm install
```

## Run the Project

Start the backend first:

```bash
cd back-end
npm run dev
```

Then start the frontend in a second terminal:

```bash
cd front-end/my-app
npm run dev
```

Open the frontend at `http://localhost:3000` and the backend API at `http://localhost:4000/api/v1`.

## Backend Scripts

- `npm run dev` - start the API in watch mode
- `npm run build` - compile TypeScript
- `npm run start` - run the compiled server
- `npm run typecheck` - run TypeScript validation
- `npm test` - run the backend test suite (`npm run test:watch` to re-run on changes)

### Backend tests

The tests (Vitest + Supertest, in `back-end/tests/`) exercise the API against a real MongoDB, so start the database first with `docker compose up -d`. They use a separate database named `mediassist_test` on the Docker port (picked up from `MONGO_PORT` in the root `.env`), and refuse to run against any database whose name does not end in `_test`. Set `TEST_MONGODB_URI` to use a different instance.

Gemini, Groq and Qdrant are stubbed, and the test environment uses dummy keys, so tests never call external services or use your API quota.

## Frontend Scripts

- `npm run dev` - start the Next.js app
- `npm run build` - build for production
- `npm run start` - start the production frontend
- `npm run lint` - run ESLint

## How to Use

1. Make sure MongoDB, Qdrant, and the backend are running.
2. Open the frontend in your browser.
3. Bootstrap the first admin account using the backend bootstrap admin flow.
4. Log in with a staff account.
5. Use the frontend console to manage patients, doctors, appointments, and AI-assisted records.
6. Use the agent tools for natural-language workflows when you need the assistant to carry out supported actions.

## API Documentation

After the backend starts, open:

- `GET /docs`
- `GET /openapi.json`

## Common API Areas

- `auth` - login, refresh, logout, bootstrap admin, current user
- `patients` - patient creation, listing, assignments, summaries
- `doctors` - doctor profiles, schedules, available slots
- `appointments` - create, update, cancel, restore appointments
- `ai` - generate, upload, list, update, restore AI records
- `agent` - execute and confirm agent actions

## Notes

- The backend expects a local MongoDB instance by default.
- AI file ingestion supports PDF, DOC, DOCX, XLS, XLSX, TXT, and CSV files.
- Refresh tokens are rotated on refresh and stored hashed in MongoDB.
- If you change the frontend API URL, update `NEXT_PUBLIC_API_BASE_URL` in `front-end/my-app/.env.local`.
