import type { ReactNode } from "react";
import { Agents } from "@/components/marketing/chapters/Agents";
import { Audited } from "@/components/marketing/chapters/Audited";
import { Calibre } from "@/components/marketing/chapters/Calibre";
import { FrontRun } from "@/components/marketing/chapters/FrontRun";
import { Markets } from "@/components/marketing/chapters/Markets";
import { Movement } from "@/components/marketing/chapters/Movement";
import { MovementPart } from "@/components/marketing/chapters/MovementParts";
import { PLATES } from "@/components/marketing/chapters/movementPlates";
import { NeverCloses } from "@/components/marketing/chapters/NeverCloses";
import { OnePrice } from "@/components/marketing/chapters/OnePrice";
import { OnlyOnMonad } from "@/components/marketing/chapters/OnlyOnMonad";
import { Closing } from "@/components/marketing/Closing";
import { Hero } from "@/components/marketing/Hero";

/** Below the fold, a chapter is rendered by the browser only as it nears the viewport (`defer-paint`). */
function Later({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`defer-paint ${className}`}>{children}</div>;
}

export default function Home() {
  return (
    <>
      <Hero />
      <Later>
        <OnePrice />
      </Later>
      <Later>
        <FrontRun />
      </Later>
      <Later>
        <NeverCloses />
      </Later>
      <Later>
        <Audited />
      </Later>
      <Later className="lg:[--defer-h:320vh]">
        <Movement plates={PLATES.map((p) => <MovementPart key={p.name} name={p.name} />)} />
      </Later>
      <Later>
        <Calibre />
      </Later>
      <Later>
        <Agents />
      </Later>
      <Later>
        <OnlyOnMonad />
      </Later>
      <Later>
        <Markets />
      </Later>
      <Later className="[--defer-h:720px]">
        <Closing />
      </Later>
    </>
  );
}
