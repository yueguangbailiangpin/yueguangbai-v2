import { z } from 'zod';

export const staffLogoutResponseSchema = z.object({
  logged_out: z.literal(true),
  all_devices_logged_out: z.literal(false),
}).strict();

export const staffLogoutAllResponseSchema = z.object({
  logged_out: z.literal(true),
  all_devices_logged_out: z.literal(true),
  session_version: z.number().int(),
}).strict();
