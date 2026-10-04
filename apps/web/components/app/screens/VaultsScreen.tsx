"use client";

import dynamic from "next/dynamic";
import { early } from "./early";
import { VaultBoardSkeleton } from "./skeletons";

const load = early(() => import("@/components/vaults/Vaults").then((m) => m.VaultIndex));

export const VaultsClient = dynamic(() => load(), { ssr: false, loading: () => <VaultBoardSkeleton /> });
