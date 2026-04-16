import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { listLocations } from "@/app/(app)/locations/actions";
import { LocationTable } from "@/components/locations/location-table";

export default async function LocationsPage() {
  const locations = await listLocations();

  return (
    <AppShell
      title="Locations"
      action={
        <Link href="/locations/new">
          <Button className="bg-wk-azure text-white hover:bg-wk-azure/90">
            <Plus className="mr-1.5 h-4 w-4" />
            Add location
          </Button>
        </Link>
      }
    >
      <Tabs defaultValue="table">
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="table">Table</TabsTrigger>
        </TabsList>
        <TabsContent value="table">
          <LocationTable data={locations} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
