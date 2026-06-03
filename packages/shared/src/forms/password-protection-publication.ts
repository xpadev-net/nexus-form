import { z } from "zod";

export const PasswordProtectionPublicationSnapshotSchema = z.object({
  enabled: z.boolean(),
  has_password: z.boolean(),
  password_hint: z.string().optional(),
});
export type PasswordProtectionPublicationSnapshot = z.infer<
  typeof PasswordProtectionPublicationSnapshotSchema
>;

export const PasswordProtectionPublicationStateSchema = z.object({
  current: PasswordProtectionPublicationSnapshotSchema,
  published: PasswordProtectionPublicationSnapshotSchema.nullable(),
  is_synced: z.boolean(),
});
export type PasswordProtectionPublicationState = z.infer<
  typeof PasswordProtectionPublicationStateSchema
>;
