import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Search, Pencil } from "lucide-react";

interface ServiceRow {
  id: number;
  name: string;
  slug: string;
  price: string;
  icon: string | null;
  category: string | null;
  isActive: number;
}

export default function AdminServices() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editService, setEditService] = useState<ServiceRow | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: services, isLoading } = useQuery<ServiceRow[]>({
    queryKey: ["/api/services"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ServiceRow> }) => {
      const res = await apiRequest("PUT", `/api/admin/services/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setEditService(null);
      toast({ title: "Service updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleActive = (svc: ServiceRow) => {
    updateMutation.mutate({
      id: svc.id,
      data: { isActive: svc.isActive ? 0 : 1 },
    });
  };

  const handleEditSave = () => {
    if (!editService) return;
    const price = parseFloat(editPrice);
    if (isNaN(price) || price <= 0) {
      toast({ title: "Invalid price", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      id: editService.id,
      data: { price: price.toFixed(2) },
    });
  };

  const openEdit = (svc: ServiceRow) => {
    setEditService(svc);
    setEditPrice(svc.price);
  };

  // Get unique categories
  const categories = Array.from(new Set((services || []).map(s => s.category).filter(Boolean))) as string[];

  const filtered = (services || []).filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase()) || s.slug.includes(search.toLowerCase());
    const matchesCat = categoryFilter === "all" || s.category === categoryFilter;
    return matchesSearch && matchesCat;
  });

  return (
    <AdminLayout title="Services" description="Manage OTP service catalog">
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search services..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.sort().map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card className="border-border">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Category</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="w-20 text-center">Active</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No services found
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map(svc => (
                    <TableRow key={svc.id} className={!svc.isActive ? "opacity-50" : ""}>
                      <TableCell className="font-mono text-xs">{svc.id}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{svc.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{svc.slug}</p>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {svc.category && (
                          <Badge variant="secondary" className="text-xs">{svc.category}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">${svc.price}</TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={!!svc.isActive}
                          onCheckedChange={() => toggleActive(svc)}
                          disabled={updateMutation.isPending}
                        />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(svc)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {services?.length ?? 0} services
        </p>
      </div>

      {/* Edit Price Dialog */}
      <Dialog open={!!editService} onOpenChange={() => setEditService(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Service Price</DialogTitle>
          </DialogHeader>
          {editService && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">{editService.name}</p>
                <p className="text-xs text-muted-foreground">{editService.category}</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Price (USD)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={editPrice}
                  onChange={e => setEditPrice(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditService(null)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
