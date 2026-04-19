export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "MediAssist IA API",
    version: "1.0.0",
    description:
      "Medical department backend API with role-based access, scheduling, appointments, and AI (RAG + non-RAG).",
  },
  servers: [
    {
      url: "/api/v1",
      description: "Local API base",
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login and receive access/refresh tokens",
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Rotate refresh token and issue new tokens",
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Get current authenticated user",
      },
    },
    "/patients": {
      get: {
        tags: ["Patients"],
        summary: "List patients with assignment filtering",
      },
      post: {
        tags: ["Patients"],
        summary: "Create patient",
      },
    },
    "/patients/{patientId}": {
      get: {
        tags: ["Patients"],
        summary: "Get patient by ID",
      },
    },
    "/patients/{patientId}/assignments": {
      patch: {
        tags: ["Patients"],
        summary: "Update patient assigned staff",
      },
    },
    "/doctors": {
      get: {
        tags: ["Doctors"],
        summary: "List doctors",
      },
      post: {
        tags: ["Doctors"],
        summary: "Create doctor profile",
      },
    },
    "/doctors/{doctorId}": {
      get: {
        tags: ["Doctors"],
        summary: "Get doctor by ID",
      },
    },
    "/doctors/{doctorId}/schedule": {
      get: {
        tags: ["Doctors"],
        summary: "Get doctor schedule",
      },
      put: {
        tags: ["Doctors"],
        summary: "Create or update doctor schedule",
      },
    },
    "/doctors/{doctorId}/slots": {
      get: {
        tags: ["Doctors"],
        summary: "Get available slots based on schedule and conflicts",
      },
    },
    "/appointments": {
      get: {
        tags: ["Appointments"],
        summary: "List appointments",
      },
      post: {
        tags: ["Appointments"],
        summary: "Create appointment",
      },
    },
    "/appointments/{appointmentId}": {
      get: {
        tags: ["Appointments"],
        summary: "Get appointment by ID",
      },
      patch: {
        tags: ["Appointments"],
        summary: "Update appointment",
      },
      delete: {
        tags: ["Appointments"],
        summary: "Soft delete appointment",
      },
    },
    "/appointments/{appointmentId}/restore": {
      post: {
        tags: ["Appointments"],
        summary: "Restore soft deleted appointment",
      },
    },
    "/ai/records": {
      get: {
        tags: ["AI"],
        summary: "List AI records",
      },
    },
    "/ai/records/generate": {
      post: {
        tags: ["AI"],
        summary: "Generate and store AI record (RAG or non-RAG)",
      },
    },
    "/ai/records/upload": {
      post: {
        tags: ["AI"],
        summary: "Upload documents (pdf, excel, doc, docx, txt, csv) and generate AI record",
        description:
          "Accepts multipart/form-data with patientId, mode, optional title/prompt, and files[] to process in RAG or non-RAG flows.",
      },
    },
    "/ai/records/{recordId}": {
      get: {
        tags: ["AI"],
        summary: "Get AI record by ID",
      },
      patch: {
        tags: ["AI"],
        summary: "Update AI record",
      },
      delete: {
        tags: ["AI"],
        summary: "Soft delete AI record",
      },
    },
    "/ai/records/{recordId}/restore": {
      post: {
        tags: ["AI"],
        summary: "Restore soft deleted AI record",
      },
    },
    "/agent/execute": {
      post: {
        tags: ["Agent"],
        summary: "Plan and execute role-aware tool calls from a natural-language prompt",
        description:
          "Supports Idempotency-Key header for safe retries. Includes planner repair and no-tool fallback when planner JSON is malformed.",
        parameters: [
          {
            in: "header",
            name: "Idempotency-Key",
            required: false,
            schema: {
              type: "string",
            },
            description:
              "Optional key to make retried execute requests return the same result for the same actor and payload.",
          },
        ],
      },
    },
    "/agent/actions/{actionId}/confirm": {
      post: {
        tags: ["Agent"],
        summary: "Confirm or reject pending destructive tool execution",
        description:
          "Supports Idempotency-Key header for safe retries. Only the original requester can confirm.",
        parameters: [
          {
            in: "header",
            name: "Idempotency-Key",
            required: false,
            schema: {
              type: "string",
            },
            description:
              "Optional key to make retried confirm requests return the same result for the same actor and payload.",
          },
        ],
      },
    },
  },
} as const;