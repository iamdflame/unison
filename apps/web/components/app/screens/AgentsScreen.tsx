"use client";

import dynamic from "next/dynamic";
import { early } from "./early";
import { Skeleton } from "./skeletons";

const load = early(() => import("@/components/agents/Agents").then((m) => m.Agents));

export const AgentsClient = dynamic(() => load(), { ssr: false, loading: () => <Skeleton rows={5} label="Loading agents" /> });
