'use client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useRouter } from 'next/navigation';

interface DataIslandErrorProps {
  section: string;
}

export function DataIslandError({ section }: DataIslandErrorProps) {
  const router = useRouter();
  return (
    <Card>
      <CardContent role="alert" className="flex flex-col items-start gap-2 py-6">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load {section}.
        </p>
        <Button variant="outline" size="sm" aria-label={`Retry loading ${section}`} onClick={() => router.refresh()}>
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}
