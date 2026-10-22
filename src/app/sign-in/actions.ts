"use server";

import { redirect } from "next/navigation";

import { allowedEmails, isSupabaseMode } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SignInState {
  message: string | null;
  email: string;
}

const NOT_RECOGNIZED = "That email and password weren't recognized.";

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!isSupabaseMode()) return { email, message: "Sign-in is off in sample mode." };
  if (!email || !password) return { email, message: "Enter your email and password." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase rate-limits repeated attempts; say so instead of a generic error.
    const limited = error.status === 429;
    return { email, message: limited ? "Too many attempts. Wait a few minutes and try again." : NOT_RECOGNIZED };
  }
  if (!allowedEmails().includes(email)) {
    await supabase.auth.signOut();
    return { email, message: "This account isn't allowed to use this private app." };
  }
  redirect("/");
}

export async function signOut(): Promise<void> {
  if (isSupabaseMode()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/sign-in");
}
