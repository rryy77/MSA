import type { Metadata } from "next";
import { MsaShell } from "@/components/msa/MsaShell";

export const metadata: Metadata = {
  title: "MSA",
  description: "Meet Schedule Assistant — 日程調整",
};

export default function MsaGroupLayout({ children }: { children: React.ReactNode }) {
  return <MsaShell>{children}</MsaShell>;
}
