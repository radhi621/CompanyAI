# MediAssist IA Backend

Production-grade backend foundation for the MediAssist IA project.

## Stack

- Node.js + TypeScript
- Express
- MongoDB Atlas via Mongoose
- JWT (access + refresh)
- Gemini 2.5 Flash (primary LLM)
- Groq (fallback LLM)
- Qdrant (RAG vector store)

## Features implemented in this phase

- Professional TypeScript structure and environment validation
- Interactive API docs with Swagger:
  - GET /openapi.json
  - GET /docs
- Auth module with:
  - Bootstrap admin route
  - Login
  - Refresh token rotation
  - Logout
  - Current user profile
  - Admin-only user creation
- Role hierarchy:
  - admin > doctor > nurse > secretary
- Patient assignment model and APIs
- Doctors and scheduling module with timezone-aware slot generation
- Appointments module with:
  - Conflict detection (doctor overlap prevention)
  - Flexible long-duration appointments (supports surgeries)
  - Role-aware duration override
  - Nurse view-only enforcement
  - Soft delete + restore
- AI module with:
  - Non-RAG prompt generation
  - RAG prompt generation using Qdrant retrieval
  - Automatic persistence of AI-generated records
  - Soft delete + restore
  - Ownership enforcement:
    - Same-role users cannot edit each other records
    - Owner can edit own records
    - Higher roles can override lower roles
- Agent orchestration module with function-style tool execution from natural language
- Mandatory confirmation for destructive AI actions (cancel appointment)
- Agent audit logs and pending-action tracking for traceability
- Idempotency-Key support on agent execute/confirm endpoints for safe retries
- LLM retry policy with exponential backoff across providers
- Strict planner JSON parsing and unsafe-key defenses
- Planner self-repair attempt and safe no-tool fallback response
- Assignment enforcement:
  - Non-admin users can access only assigned patients and related AI records

## Project structure

- src/config: env and database config
- src/middlewares: auth/authorization/ownership/access guards
- src/models: user, refresh token, patient, doctor, doctor schedule, appointment, AI record
- src/modules/auth: auth APIs
- src/modules/patients: patient APIs
- src/modules/doctors: doctor and schedule APIs
- src/modules/appointments: appointment APIs
- src/modules/ai: AI + RAG APIs
- src/modules/agent: AI tool orchestration APIs
- src/docs: OpenAPI specification
- src/services/llm: Gemini and Groq clients and router
- src/services/rag: Qdrant integration and retrieval/indexing

## Environment variables

Copy .env.example to .env and fill values.

Required keys:

- MONGODB_URI
- APP_TIMEZONE (default Africa/Casablanca)
- DEFAULT_APPOINTMENT_DURATION_MINUTES (default 45)
- MAX_APPOINTMENT_DURATION_MINUTES (default 720)
- LLM_RETRIES_PER_PROVIDER (default 2)
- LLM_RETRY_BASE_DELAY_MS (default 250)
- AGENT_IDEMPOTENCY_TTL_MINUTES (default 1440)
- JWT_ACCESS_SECRET
- JWT_REFRESH_SECRET
- BOOTSTRAP_ADMIN_KEY
- GEMINI_API_KEY
- GROQ_API_KEY
- QDRANT_URL

Recommended defaults are already included in .env.example.

## Install and run

1. Install dependencies

npm install

2. Type check

npm run typecheck

3. Build

npm run build

4. Run in development

npm run dev

## API base

- Base: /api/v1

### Auth

- POST /auth/bootstrap-admin
- POST /auth/login
- POST /auth/refresh
- POST /auth/logout
- GET /auth/me
- POST /auth/users (admin)

### Patients

- POST /patients (admin, secretary)
- GET /patients
- GET /patients/:patientId
- PATCH /patients/:patientId/assignments (admin)

### Doctors

- POST /doctors (admin)
- GET /doctors
- GET /doctors/:doctorId
- GET /doctors/:doctorId/schedule
- PUT /doctors/:doctorId/schedule (admin, owner doctor)
- GET /doctors/:doctorId/slots

### Appointments

- POST /appointments (admin, doctor, secretary)
- GET /appointments (all authenticated roles, nurse is view-only)
- GET /appointments/:appointmentId
- PATCH /appointments/:appointmentId (admin, doctor, secretary + owner-or-higher policy)
- DELETE /appointments/:appointmentId (soft delete)
- POST /appointments/:appointmentId/restore (admin)

### AI

- POST /ai/records/generate
- POST /ai/records/upload (multipart file ingestion for rag/non_rag)
- GET /ai/records
- GET /ai/records/:recordId
- PATCH /ai/records/:recordId
- DELETE /ai/records/:recordId (soft delete)
- POST /ai/records/:recordId/restore (admin)

### Agent

- POST /agent/execute
- POST /agent/actions/:actionId/confirm

Agent reliability notes:

- Optional `Idempotency-Key` header is supported on both endpoints.
- Repeating the same request with the same key and payload returns the same response.
- Reusing the same key with a different payload is rejected.

Implemented tools:

- create_patient
- list_patients
- search_patient
- get_patient_summary
- list_appointments
- check_availability
- create_appointment
- cancel_appointment
- get_uncontacted_patients
- search_medical_records_RAG
- update_patient_notes
- get_day_schedule
- create_staff_account
- create_doctor_profile
- list_doctors

## Notes

- Supported uploaded document formats for AI file ingestion: pdf, doc, docx, xls, xlsx, txt, csv.
- Qdrant collection is auto-created on first RAG operation.
- AI records are indexed back into Qdrant to improve future RAG retrieval.
- Refresh tokens are stored hashed in MongoDB and rotated on refresh.
- Time calculations and schedule slots are timezone-aware using APP_TIMEZONE.
