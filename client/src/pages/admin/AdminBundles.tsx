import { GenericAdminTablePage } from "./GenericAdminTable";

export default function AdminBundles() {
  return (
    <GenericAdminTablePage
      title="Bundles"
      description="Deposit bundle matrix and bonus configuration"
      endpoint="/api/admin/bundles"
      exportResource="bundles"
    />
  );
}
