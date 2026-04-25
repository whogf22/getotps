import { GenericAdminTablePage } from "./GenericAdminTable";

export default function AdminApiPlans() {
  return (
    <GenericAdminTablePage
      title="API Plans"
      description="API plan pricing and throttling"
      endpoint="/api/admin/api-plans"
      exportResource="api_plans"
    />
  );
}
