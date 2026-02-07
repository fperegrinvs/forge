import { z } from "zod";

export const {{pascalName}}Schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  createdAt: z.date(),
});

export type {{pascalName}} = z.infer<typeof {{pascalName}}Schema>;

export const Create{{pascalName}}InputSchema = {{pascalName}}Schema.omit({
  id: true,
  createdAt: true,
});

export type Create{{pascalName}}Input = z.infer<typeof Create{{pascalName}}InputSchema>;
