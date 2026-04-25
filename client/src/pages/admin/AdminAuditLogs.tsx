import { GenericAdminTablePage } from "./GenericAdminTable";

export default function AdminAuditLogs() {
  return (
    <GenericAdminTablePage
      title="Audit Logs"
      description="Security and operational audit trail"
      endpoint="/api/admin/audit-logs"
      exportResource="audit_logs"
    />
  );
}
