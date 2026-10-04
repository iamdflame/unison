"use client";

import dynamic from "next/dynamic";
import { early } from "./early";
import { Skeleton } from "./skeletons";

const load = early(() => import("@/components/vaults/Vaults").then((m) => m.VaultDetail));

export const VaultDetailClient = dynamic(() => load(), { ssr: false, loading: () => <Skeleton rows={5} label="Loading the vault" /> });
