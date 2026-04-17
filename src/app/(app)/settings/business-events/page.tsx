"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EventsList } from "./events-list";
import { EventForm } from "./event-form";
import { CategoryManager } from "./category-manager";
import {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  type EventRow,
  type CategoryRow,
} from "./actions";

export default function BusinessEventsPage() {
  const [events, setEvents] = React.useState<EventRow[]>([]);
  const [categories, setCategories] = React.useState<CategoryRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<EventRow | null>(null);

  const refreshAll = React.useCallback(async () => {
    const [evtResult, catResult] = await Promise.all([
      listEvents(),
      listCategories(),
    ]);
    if ("events" in evtResult) setEvents(evtResult.events);
    if ("categories" in catResult) setCategories(catResult.categories);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // -- Event handlers -------------------------------------------------------

  const handleCreateEvent = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const handleEditEvent = (event: EventRow) => {
    setEditing(event);
    setFormOpen(true);
  };

  const handleDeleteEvent = async (event: EventRow) => {
    if (!confirm(`Delete event "${event.title}"?`)) return;
    const result = await deleteEvent(event.id);
    if ("error" in result) {
      alert(result.error);
    } else {
      await refreshAll();
    }
  };

  const handleSubmitEvent = async (data: {
    title: string;
    description?: string;
    categoryId: string;
    startDate: string;
    endDate?: string;
    scopeType?: string;
    scopeValue?: string;
  }) => {
    if (editing) {
      const result = await updateEvent(editing.id, data);
      if ("error" in result) throw new Error(result.error);
    } else {
      const result = await createEvent(data);
      if ("error" in result) throw new Error(result.error);
    }
    await refreshAll();
  };

  // -- Category handlers ----------------------------------------------------

  const handleCreateCategory = async (data: {
    name: string;
    color: string;
  }) => {
    const result = await createCategory(data);
    if ("error" in result) {
      alert(result.error);
    } else {
      await refreshAll();
    }
  };

  const handleUpdateCategory = async (
    id: string,
    data: { name?: string; color?: string },
  ) => {
    const result = await updateCategory(id, data);
    if ("error" in result) {
      alert(result.error);
    } else {
      await refreshAll();
    }
  };

  const handleDeleteCategory = async (id: string) => {
    const result = await deleteCategory(id);
    if ("error" in result) {
      alert(result.error);
    } else {
      await refreshAll();
    }
  };

  return (
    <AppShell
      title="Business Events"
      action={
        <Link href="/settings">
          <Button variant="ghost" size="sm" className="text-wk-night-grey">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Settings
          </Button>
        </Link>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Loading...
        </p>
      ) : (
        <Tabs defaultValue="events">
          <TabsList variant="line">
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="space-y-4 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Business events are shown as annotations on trend charts.
              </p>
              <Button onClick={handleCreateEvent} size="sm">
                <Plus className="size-4" />
                Create Event
              </Button>
            </div>
            <EventsList
              events={events}
              onEdit={handleEditEvent}
              onDelete={handleDeleteEvent}
            />
          </TabsContent>

          <TabsContent value="categories" className="pt-4">
            <CategoryManager
              categories={categories}
              onCreateCategory={handleCreateCategory}
              onUpdateCategory={handleUpdateCategory}
              onDeleteCategory={handleDeleteCategory}
            />
          </TabsContent>
        </Tabs>
      )}

      <EventForm
        open={formOpen}
        onOpenChange={setFormOpen}
        event={editing}
        categories={categories}
        onSubmit={handleSubmitEvent}
      />
    </AppShell>
  );
}
