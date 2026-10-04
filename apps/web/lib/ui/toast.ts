"use client";

/**
 * `toast` without carrying Sonner in every page: the same calls (message, success, error, loading; ids, actions,
 * descriptions), sent once Sonner and the mounted <Toaster> are ready. Ids are made here, so `toast.loading`
 * still returns one at once and later updates replace the same toast, in order.
 */
type Sonner = typeof import("sonner");
type Message = Parameters<Sonner["toast"]>[0];
type Options = NonNullable<Parameters<Sonner["toast"]>[1]>;
type Id = string | number;

let sonner: Promise<Sonner> | null = null;
const loadSonner = () => (sonner ??= import("sonner"));

let markMounted: () => void = () => undefined;
const mounted = new Promise<void>((resolve) => (markMounted = resolve));
/** Called by <Toaster> once it listens: toasts sent before then wait for it instead of vanishing. */
export const toasterMounted = () => markMounted();

let seq = 0;
function send(kind: "message" | "success" | "error" | "loading", message: Message, options?: Options): Id {
  const id = options?.id ?? `u${++seq}`;
  void Promise.all([loadSonner(), mounted]).then(([{ toast }]) => (kind === "message" ? toast : toast[kind])(message, { ...options, id }));
  return id;
}

export const toast = Object.assign((message: Message, options?: Options) => send("message", message, options), {
  success: (message: Message, options?: Options) => send("success", message, options),
  error: (message: Message, options?: Options) => send("error", message, options),
  loading: (message: Message, options?: Options) => send("loading", message, options),
  dismiss: (id?: Id) => void loadSonner().then(({ toast }) => toast.dismiss(id)),
});
