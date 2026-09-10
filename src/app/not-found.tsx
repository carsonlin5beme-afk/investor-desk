import Link from "next/link";
import { DocumentPage } from "@/components/DocumentPage";
export default function NotFound() {
  return (
    <DocumentPage eyebrow="A SMALL DETOUR" title="This page isn’t on the desk.">
      <p>The link may have changed. Your workspace is one step away.</p>
      <Link className="button primary" href="/dashboard">
        Return to your workspace
      </Link>
    </DocumentPage>
  );
}
