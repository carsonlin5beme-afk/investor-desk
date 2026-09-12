import Link from "next/link";
import { BrandWordmark } from "@/components/Brand";
import { AmbientRadioControls } from "@/components/AmbientRadio";
import { ArrowUpRight } from "lucide-react";
export function DocumentPage({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="document-page">
      <header>
        <Link href="/">
          <BrandWordmark style={{ width: 200 }} />
        </Link>
        <Link className="text-button" href="/dashboard">
          Open workspace
          <ArrowUpRight size={16} />
        </Link>
        <AmbientRadioControls />
      </header>
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {children}
      <footer>
        <Link href="/methodology">Methodology</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/dashboard">Back to the desk</Link>
      </footer>
    </main>
  );
}
