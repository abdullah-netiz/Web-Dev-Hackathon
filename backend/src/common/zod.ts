import { z } from 'zod';

/** An optional text field where the UI sends "" for "not set". */
export function optionalString(max = 500) {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).max(max).optional(),
  );
}

export const customFieldsSchema = z.record(z.string().min(1).max(60), z.unknown()).default({});

export const versionSchema = z.coerce.number().int().positive();

export const idParamSchema = z.object({ id: z.string().min(1).max(40) });

export const tagsSchema = z.array(z.string().min(1).max(40)).max(20).default([]);
