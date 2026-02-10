"use server";

import {
  SignupFormSchema,
  LoginFormSchema,
  FormState,
} from "@/app/lib/definitions";
import { prisma } from "@/app/lib/singleton";
import { createSession, decrypt, deleteSession } from "../lib/session";
import { redirect } from "@/i18n/navigation";
import bcrypt from "bcrypt";
import { cookies } from "next/headers";

export async function signup(state: FormState, formData: FormData) {
  // Validate form fields
  const validatedFields = SignupFormSchema.safeParse({
    username: formData.get("username"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  // If any form fields are invalid, return early
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  // Hash the password
  const saltRounds = 12;
  const hashedPassword = await bcrypt.hash(
    validatedFields.data.password,
    saltRounds,
  );

  // Call the  db to create a user...
  let user;
  try {
    user = await prisma.user.create({
      data: {
        pseudo: validatedFields.data.username,
        email: validatedFields.data.email,
        password: hashedPassword,
      },
    });
  } catch {
    return {
      message: "Impossible de creer le compte. Email ou pseudo deja utilise.",
    };
  }

  if (!user) {
    return {
      message: "An error occurred while creating the user.",
    };
  }

  await createSession(user.id);
  redirect({ href: "/", locale: "fr" });
}

export async function login(state: FormState, formData: FormData) {
  const validatedFields = LoginFormSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Informations de connexion invalides.",
    };
  }

  const user = await prisma.user.findUnique({
    where: { email: validatedFields.data.email },
    select: {
      id: true,
      password: true,
    },
  });

  if (!user) {
    return { message: "Email ou mot de passe invalide." };
  }

  const isPasswordValid = await bcrypt.compare(
    validatedFields.data.password,
    user.password,
  );

  if (!isPasswordValid) {
    return { message: "Email ou mot de passe invalide." };
  }

  await createSession(user.id);
  redirect({ href: "/", locale: "fr" });
}

export async function logout() {
  await deleteSession();
  redirect({ href: "/login", locale: "fr" });
}

export async function getCurrentUser() {
  const token = (await cookies()).get("session")?.value;
  const payload = await decrypt(token);

  if (!payload?.userId || typeof payload.userId !== "string") return null;

  return prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, pseudo: true }, // jamais password
  });
}
