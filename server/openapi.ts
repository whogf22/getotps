type OpenApiSpec = Record<string, unknown>;

export function buildOpenApiSpec(baseUrl = "https://getotps.com"): OpenApiSpec {
  return {
    openapi: "3.0.3",
    info: {
      title: "GetOTPs API",
      version: "1.0.0",
      description: "Public API for ordering OTP numbers and checking order status.",
    },
    servers: [{ url: baseUrl }],
    tags: [{ name: "Health" }, { name: "Public API" }, { name: "Orders" }],
    paths: {
      "/healthz": {
        get: {
          tags: ["Health"],
          summary: "Liveness probe",
          responses: { "200": { description: "Healthy" } },
        },
      },
      "/readyz": {
        get: {
          tags: ["Health"],
          summary: "Readiness probe",
          responses: { "200": { description: "Ready" } },
        },
      },
      "/api/v1/services": {
        get: {
          tags: ["Public API"],
          summary: "List available services",
          responses: { "200": { description: "Services list" } },
        },
      },
      "/api/v1/balance": {
        get: {
          tags: ["Public API"],
          summary: "Get API key balance",
          security: [{ apiKeyAuth: [] }],
          responses: { "200": { description: "Balance payload" } },
        },
      },
      "/api/v1/order": {
        post: {
          tags: ["Orders"],
          summary: "Create order",
          security: [{ apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { service: { type: "string" } },
                  required: ["service"],
                },
              },
            },
          },
          responses: {
            "200": { description: "Order created" },
            "400": { description: "Validation error" },
            "503": { description: "Provider unavailable" },
          },
        },
      },
      "/api/v1/order/{id}": {
        get: {
          tags: ["Orders"],
          summary: "Get order status",
          security: [{ apiKeyAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Order status" }, "404": { description: "Not found" } },
        },
      },
      "/api/v1/order/{id}/cancel": {
        post: {
          tags: ["Orders"],
          summary: "Cancel order",
          security: [{ apiKeyAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Cancelled" }, "400": { description: "Cannot cancel" } },
        },
      },
      "/api/orders/{id}/stream": {
        get: {
          tags: ["Orders"],
          summary: "Stream order updates (SSE)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "SSE stream" } },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
        },
      },
    },
  };
}
