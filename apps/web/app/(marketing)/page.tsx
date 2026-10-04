import { Agents } from "@/components/marketing/chapters/Agents";
import { Audited } from "@/components/marketing/chapters/Audited";
import { Calibre } from "@/components/marketing/chapters/Calibre";
import { FrontRun } from "@/components/marketing/chapters/FrontRun";
import { Markets } from "@/components/marketing/chapters/Markets";
import { Movement } from "@/components/marketing/chapters/Movement";
import { NeverCloses } from "@/components/marketing/chapters/NeverCloses";
import { OnePrice } from "@/components/marketing/chapters/OnePrice";
import { OnlyOnMonad } from "@/components/marketing/chapters/OnlyOnMonad";
import { Closing } from "@/components/marketing/Closing";
import { Hero } from "@/components/marketing/Hero";

export default function Home() {
  return (
    <>
      <Hero />
      <OnePrice />
      <FrontRun />
      <NeverCloses />
      <Audited />
      <Movement />
      <Calibre />
      <Agents />
      <OnlyOnMonad />
      <Markets />
      <Closing />
    </>
  );
}
