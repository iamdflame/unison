"use client";

import { useEffect } from "react";
import { bootVenue } from "@/lib/venue";

/** Decides, once per page load, whether the app talks to a live Unison network or runs the simulation. */
export function VenueBoot() {
  useEffect(() => {
    void bootVenue();
  }, []);
  return null;
}
