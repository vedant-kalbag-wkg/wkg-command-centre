"use client";

import { useState, useRef, useCallback } from "react";
import { X, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateKeyContacts } from "@/app/(app)/locations/actions";
import { cn } from "@/lib/utils";

type Contact = {
  name: string;
  role: string;
  email: string;
  phone: string;
};

interface KeyContactsEditorProps {
  locationId: string;
  initialContacts: Contact[] | null | undefined;
  disabled?: boolean;
}

export function KeyContactsEditor({
  locationId,
  initialContacts,
  disabled = false,
}: KeyContactsEditorProps) {
  const [contacts, setContacts] = useState<Contact[]>(
    initialContacts ?? []
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref so blur handler always reads latest contacts (avoids stale closure)
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;

  const persist = useCallback(
    (updated: Contact[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setIsSaving(true);
        setError(null);
        try {
          const result = await updateKeyContacts(locationId, updated);
          if ("error" in result) {
            setError(result.error ?? "Failed to save contacts");
          }
        } catch {
          setError("Failed to save contacts");
        } finally {
          setIsSaving(false);
        }
      }, 1000);
    },
    [locationId]
  );

  // Save on blur — called when user leaves any input field
  const handleBlur = useCallback(() => {
    persist(contactsRef.current);
  }, [persist]);

  const updateField = (index: number, field: keyof Contact, value: string) => {
    const updated = contacts.map((c, i) =>
      i === index ? { ...c, [field]: value } : c
    );
    setContacts(updated);
    // Do NOT persist here — save only happens on blur
  };

  const addContact = () => {
    const updated = [...contacts, { name: "", role: "", email: "", phone: "" }];
    setContacts(updated);
  };

  const removeContact = (index: number) => {
    const updated = contacts.filter((_, i) => i !== index);
    setContacts(updated);
    persist(updated);
  };

  if (contacts.length === 0) {
    return (
      <div className="py-4 text-center">
        <p className="text-sm text-muted-foreground">No contacts added yet</p>
        {!disabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addContact}
            className="mt-3"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add contact
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {contacts.map((contact, index) => (
        <div
          key={index}
          className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-center rounded-lg border border-border px-3 py-2"
        >
          <Input
            value={contact.name}
            onChange={(e) => updateField(index, "name", e.target.value)}
            onBlur={handleBlur}
            placeholder="Name *"
            disabled={disabled}
            className={cn("h-8 text-sm", !contact.name && "border-destructive")}
          />
          <Input
            value={contact.role}
            onChange={(e) => updateField(index, "role", e.target.value)}
            onBlur={handleBlur}
            placeholder="Role"
            disabled={disabled}
            className="h-8 text-sm"
          />
          <Input
            value={contact.email}
            onChange={(e) => updateField(index, "email", e.target.value)}
            onBlur={handleBlur}
            placeholder="Email"
            type="email"
            disabled={disabled}
            className="h-8 text-sm"
          />
          <Input
            value={contact.phone}
            onChange={(e) => updateField(index, "phone", e.target.value)}
            onBlur={handleBlur}
            placeholder="Phone"
            disabled={disabled}
            className="h-8 text-sm"
          />
          {!disabled && (
            <button
              type="button"
              onClick={() => removeContact(index)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive transition-colors"
              aria-label="Remove contact"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}

      <div className="flex items-center gap-3">
        {!disabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addContact}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add contact
          </Button>
        )}
        {isSaving && (
          <div className="flex items-center gap-1 text-[12px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving…
          </div>
        )}
      </div>

      {error && (
        <p className="text-[12px] text-destructive">{error}</p>
      )}
    </div>
  );
}
