"use client";

import { Lockup } from "@/components/brand/Lockup";
import { WatchFace } from "@/components/brand/WatchFace";

/** The error page's drawings, kept out of every page's first load: fetched only when a page has actually failed. */
export const ErrorLockup = () => <Lockup capHeight={13} />;
export const ErrorWatch = () => <WatchFace hacked className="w-[min(74vw,460px)]" />;
