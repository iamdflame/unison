"use client";

import dynamic from "next/dynamic";
import { early } from "./early";
import { BoardSkeleton } from "./skeletons";

const load = early(() => import("../MarketsBoard").then((m) => m.MarketsBoard));

export const MarketsClient = dynamic(() => load(), { ssr: false, loading: () => <BoardSkeleton /> });
