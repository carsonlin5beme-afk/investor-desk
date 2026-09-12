import Link from "next/link";
import { BrandWordmark } from "@/components/Brand";
import { ProfileForm } from "@/components/ProfileForm";
export default function Page() {
  return (
    <main className="profile-page">
      <Link className="profile-home" href="/">
        <BrandWordmark style={{ width: 200 }} /> / Home
      </Link>
      <ProfileForm create={false} />
    </main>
  );
}
