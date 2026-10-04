"use client";

import dynamic from "next/dynamic";

/** The toaster arrives just after the page is interactive; nothing toasts before someone acts. */
export const LazyToaster = dynamic(() => import("./Toaster").then((m) => m.Toaster), { ssr: false });
