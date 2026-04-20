"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import { Pencil, Trash2, Plus, Package } from "lucide-react";
import { toast } from "sonner";
import type { ProductListItem } from "@/app/(app)/products/actions";
import { createProduct, deleteProduct } from "@/app/(app)/products/actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProductsTableProps {
  data: ProductListItem[];
}

const columnHelper = createColumnHelper<ProductListItem>();

export function ProductsTable({ data }: ProductsTableProps) {
  const router = useRouter();

  // Add product dialog state
  const [addOpen, setAddOpen] = React.useState(false);
  const [addName, setAddName] = React.useState("");
  const [addLoading, setAddLoading] = React.useState(false);

  // Delete product dialog state
  const [deleteTarget, setDeleteTarget] = React.useState<ProductListItem | null>(null);
  const [deleteLoading, setDeleteLoading] = React.useState(false);

  async function handleAddProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim()) return;
    setAddLoading(true);
    const result = await createProduct({ name: addName.trim() });
    setAddLoading(false);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      setAddOpen(false);
      setAddName("");
      router.refresh();
    }
  }

  async function handleDeleteProduct() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    const result = await deleteProduct(deleteTarget.id);
    setDeleteLoading(false);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      setDeleteTarget(null);
      router.refresh();
    }
  }

  const columns = React.useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Product Name",
        cell: (info) => (
          <span className="font-medium text-foreground">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor("providerName", {
        header: "Provider",
        cell: (info) => (
          <span className="text-foreground/70">{info.getValue() ?? "—"}</span>
        ),
      }),
      columnHelper.accessor("hotelsOffering", {
        header: "Hotels Offering",
        cell: (info) => (
          <span className="tabular-nums">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor("hotelsUnavailable", {
        header: "Hotels Unavailable",
        cell: (info) => (
          <span className="tabular-nums">{info.getValue()}</span>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit product"
                      className="min-h-[44px] min-w-[44px]"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        toast.info("Edit product coming soon");
                      }}
                    />
                  }
                >
                  <Pencil className="size-4" />
                </TooltipTrigger>
                <TooltipContent>Edit product</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete product"
                      className="min-h-[44px] min-w-[44px] text-destructive hover:text-destructive"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        setDeleteTarget(row.original);
                      }}
                    />
                  }
                >
                  <Trash2 className="size-4" />
                </TooltipTrigger>
                <TooltipContent>Delete product</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ),
      }),
    ],
    []
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <>
      {/* Add Product CTA */}
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          Add product
        </Button>
      </div>

      <div className="rounded-lg border border-border overflow-x-auto">
        {data.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No products yet"
            description="Products are imported from your Kiosk Config Groups board. Run an import to populate this list."
            action={
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" />
                Add product
              </Button>
            }
          />
        ) : (
          <Table
            className="table-fixed"
            style={{ width: `max(100%, ${table.getCenterTotalSize()}px)` }}
          >
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  key={headerGroup.id}
                  className="bg-muted hover:bg-muted border-b border-border"
                >
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer transition-colors min-h-[44px] hover:bg-primary/10"
                  onClick={() => router.push(`/products/${row.original.id}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Add Product Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Product</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddProduct} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="product-name">Product Name</Label>
              <Input
                id="product-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="Enter product name"
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                Cancel
              </DialogClose>
              <Button
                type="submit"
                disabled={addLoading || !addName.trim()}
              >
                {addLoading ? "Adding..." : "Add product"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete product?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the product from the catalog. Per-hotel configurations
            referencing this product will also be removed. This cannot be undone.
          </p>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              disabled={deleteLoading}
              onClick={handleDeleteProduct}
            >
              {deleteLoading ? "Deleting..." : "Delete Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
