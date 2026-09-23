// Request body handling for the Teams API: bounded JSON reading and zod validation → ApiError.
import type { z } from "zod";
import { ApiError, readJsonBounded, type AppContext } from "../lib/http";
import { MAX_BODY_BYTES, formatIssue } from "./schema";

/** Validates with zod; the first issue becomes a 422 with a readable "path: message". */
export function validate<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const res = schema.safeParse(data);
  if (res.success) return res.data;
  throw new ApiError(422, "invalid", formatIssue(res.error.issues[0]));
}

/** Reads the JSON body (at most MAX_BODY_BYTES, never buffered past that) and validates it. */
export async function readBody<S extends z.ZodType>(c: AppContext, schema: S): Promise<z.output<S>> {
  return validate(schema, await readJsonBounded(c, MAX_BODY_BYTES));
}
