import { GenericAdminTablePage } from "./GenericAdminTable";

export default function AdminReferrals() {
  return (
    <GenericAdminTablePage
      title="Referrals"
      description="Referral performance and counts"
      endpoint="/api/admin/referrals"
      exportResource="referrals"
    />
  );
}
