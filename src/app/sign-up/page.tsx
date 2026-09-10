import Link from "next/link";
import { ProfileForm } from "@/components/ProfileForm";
export default function Page() {
  return (
    <main className="profile-page">
      <Link className="profile-home" href="/">
        Investor Desk / Home
      </Link>
      <ProfileForm create={true} />
    </main>
  );
}
