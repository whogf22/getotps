import { GenericAdminTablePage } from "./GenericAdminTable";

export default function AdminOrders() {
  return (
    <GenericAdminTablePage
      title="Orders"
      description="All OTP orders with provider attribution"
      endpoint="/api/admin/orders"
      exportResource="orders"
    />
  );
}
