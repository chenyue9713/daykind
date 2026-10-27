import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session cookie on navigation and sends signed-out
// visitors to /sign-in. This is an optimistic check only: every data read and
// write verifies the user again on the server, and the database enforces
// ownership with row-level security. Sample mode has no sign-in.

const PUBLIC_PATHS = ["/sign-in"];

export async function proxy(request: NextRequest) {
  if (process.env.DAYKIND_DATA_SOURCE !== "supabase") return NextResponse.next();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!data?.claims && !isPublic) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/sign-in";
    signIn.search = "";
    return NextResponse.redirect(signIn);
  }
  return response;
}

export const config = {
  // Skip static assets, the workout-import upload handlers (which stream
  // large request bodies), and the reminder scheduler endpoint (called with a
  // bearer secret, never a session). Each authenticates on its own.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|import/preview|import/confirm|api/reminders/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
