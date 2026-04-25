import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Props = {
  title: string;
  description: string;
  endpoint: string;
  exportResource: string;
};

export function GenericAdminTablePage({ title, description, endpoint, exportResource }: Props) {
  const { data, isLoading } = useQuery<any[]>({ queryKey: [endpoint] });
  const rows = Array.isArray(data) ? data : [];
  const columns = useMemo(() => (rows.length > 0 ? Object.keys(rows[0]) : []), [rows]);

  return (
    <AdminLayout title={title} description={description}>
      <div className="space-y-4">
        <div className="flex justify-end">
          <a href={`/api/admin/export/${exportResource}`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </a>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((column) => (
                      <TableHead key={column}>{column}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell colSpan={Math.max(columns.length, 1)}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading &&
                    rows.map((row, idx) => (
                      <TableRow key={idx}>
                        {columns.map((column) => (
                          <TableCell key={`${idx}-${column}`} className="align-top whitespace-nowrap">
                            {typeof row[column] === "object" && row[column] !== null
                              ? JSON.stringify(row[column])
                              : String(row[column] ?? "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
