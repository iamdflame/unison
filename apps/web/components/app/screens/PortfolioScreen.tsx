"use client";

import dynamic from "next/dynamic";
import { early } from "./early";
import { Skeleton } from "./skeletons";

const load = early(() => import("@/components/portfolio/Portfolio").then((m) => m.Portfolio));

export const PortfolioClient = dynamic(() => load(), { ssr: false, loading: () => <Skeleton rows={6} label="Loading your portfolio" /> });
