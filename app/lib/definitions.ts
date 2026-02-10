import * as z from "zod";

export const SignupFormSchema = z.object({
  username: z
    .string()
    .min(2, { error: "Name must be at least 2 characters long." })
    .max(50, { error: "Name must be less than 50 characters long." })
    .trim(),
  email: z.email({ error: "Please enter a valid email." }).trim(),
  password: z
    .string()
    // .min(8, { error: "Be at least 8 characters long" })
    // .regex(/[a-zA-Z]/, { error: "Contain at least one letter." })
    // .regex(/[0-9]/, { error: "Contain at least one number." })
    // .regex(/[^a-zA-Z0-9]/, {
    //   error: "Contain at least one special character.",
    // })
    .trim(),
});

export const LoginFormSchema = z.object({
  email: z.email({ error: "Please enter a valid email." }).trim(),
  password: z.string().min(1, { error: "Password is required." }),
});

export type FormState =
  | {
      errors?: Record<string, string[]>;
      message?: string;
    }
  | undefined;

export type SessionPayload = {
  userId: string;
  expiresAt: Date;
};
