import { z } from 'zod';
import { BadRequestError } from './errors.js';
import {
  CLEANING_METHODS,
  CLEANING_STATUSES,
  EQUIPMENT_STATUSES,
} from '../domain/types.js';

/**
 * Runs a schema and converts a failure into the API's 400, with one detail
 * entry per offending field so a form can render errors inline instead of
 * showing one generic message.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  throw new BadRequestError(`Invalid ${what}.`, result.error.issues.map((issue) => ({
    path: issue.path.join('.') || what,
    message: issue.message,
  })));
}

const uuid = z.string().uuid('Must be a UUID.');

/* ---------- pagination ---------- */

/**
 * One pagination contract for every list endpoint.
 *
 * `.strict()` is not used here because each endpoint extends this with its own
 * filters; the extensions are what close the shape. Both fields are coerced,
 * because query strings are always strings -- `?page=2` arrives as "2".
 */
export const paginationQuery = z.object({
  page: z.coerce
    .number()
    .int('Must be a whole number.')
    .positive('Must be at least 1.')
    .optional(),
  pageSize: z.coerce
    .number()
    .int('Must be a whole number.')
    .positive('Must be positive.')
    .optional(),
});

/* ---------- auth ---------- */

export const loginBody = z.object({
  email: z.string().min(3).max(254).email('Must be an email address.'),
  password: z.string().min(1, 'Required.').max(200),
});

/* ---------- equipment ---------- */

export const createEquipmentBody = z.object({
  code: z.string().trim().min(2, 'At least 2 characters.').max(32, 'At most 32 characters.'),
  name: z.string().trim().min(1, 'Required.').max(120, 'At most 120 characters.'),
  status: z.enum([...EQUIPMENT_STATUSES]).optional(),
});

/**
 * `.strict()` rejects unknown keys rather than ignoring them. A client sending
 * `{ statuss: 'retired' }` should be told it made a typo, not have the field
 * silently dropped and wonder why nothing changed.
 */
export const updateEquipmentBody = z
  .object({
    code: z.string().trim().min(2).max(32).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    status: z.enum([...EQUIPMENT_STATUSES]).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update.' });

export const listEquipmentQuery = paginationQuery.extend({
  status: z.enum([...EQUIPMENT_STATUSES]).optional(),
});

/* ---------- cleaning records ---------- */

const notes = z.string().max(2000, 'At most 2000 characters.').nullable();

export const createCleaningRecordBody = z.object({
  cleanedByUserId: uuid.optional(),
  cleanedAt: z.coerce.date({ message: 'Must be a date.' }),
  method: z.enum([...CLEANING_METHODS]),
  notes: notes.optional(),
});

/**
 * Every key optional, but at least one required, and `notes` explicitly
 * nullable: sending `notes: null` means "clear the note" and must produce an
 * audit line, while omitting `notes` means "leave it alone" and must not.
 * Those are different requests and the schema has to preserve the difference.
 */
export const updateCleaningRecordBody = z
  .object({
    cleanedByUserId: uuid.optional(),
    cleanedAt: z.coerce.date({ message: 'Must be a date.' }).optional(),
    method: z.enum([...CLEANING_METHODS]).optional(),
    notes: notes.optional(),
    status: z.enum([...CLEANING_STATUSES]).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update.' });

export const listCleaningRecordsQuery = paginationQuery.extend({
  status: z.enum([...CLEANING_STATUSES]).optional(),
});

export const idParam = z.object({ id: uuid });
