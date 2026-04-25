import { GenericAdminTablePage } from "./GenericAdminTable";

export default function AdminProviders() {
  return (
    <GenericAdminTablePage
      title="Providers"
      description="SMS provider health, priority and status"
      endpoint="/api/admin/providers"
      exportResource="providers"
    />
  );
}
