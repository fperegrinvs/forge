import { z } from "zod";

// Zod schema is the single source of truth for domain types.
// TypeScript type is derived via z.infer — never define the type separately.
export const StarterSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  createdAt: z.date(),
});

export type Starter = z.infer<typeof StarterSchema>;

// Derive input schemas from the entity schema — don't duplicate fields.
export const CreateStarterInputSchema = StarterSchema.omit({
  id: true,
  createdAt: true,
});

export type CreateStarterInput = z.infer<typeof CreateStarterInputSchema>;
