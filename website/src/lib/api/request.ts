import type { z } from "zod";
import { ApiRouteError } from "@/lib/api/errors";

function flattenZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

export async function parseRequestBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiRouteError(400, "invalid_json", "Request body must be valid JSON");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiRouteError(400, "validation_error", "Invalid request body", {
      issues: flattenZodIssues(parsed.error),
    });
  }

  return parsed.data;
}

