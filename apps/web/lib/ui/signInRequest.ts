"use client";

import { createStore } from "../store/createStore.ts";

/**
 * Asks the app shell to open the sign-in sheet, from anywhere (a page that arrived from "Continue with a passkey",
 * say). A counter, so every request opens it once; the shell waits until the venue is known before opening.
 */
export const signInRequests = createStore(0);
export const requestSignIn = () => signInRequests.set((n) => n + 1);
