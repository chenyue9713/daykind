import "server-only";

// Placeholder for managed authentication. There is no sign-in yet: every
// request is treated as the sample user. Replace this with the auth
// provider's session lookup; repositories already take the user as input.

export interface CurrentUser {
  id: string;
  /** True while there is no real authentication. */
  isSampleUser: boolean;
}

export const SAMPLE_USER_ID = "sample-user";

export async function getCurrentUser(): Promise<CurrentUser> {
  return { id: SAMPLE_USER_ID, isSampleUser: true };
}
