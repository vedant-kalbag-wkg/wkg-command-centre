interface AppShellProps {
  title: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}

export function AppShell({ title, action, children }: AppShellProps) {
  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Content header */}
      <header className="flex h-14 items-center gap-3 border-b border-wk-mid-grey px-6 shrink-0 -mx-4 md:-mx-6 -mt-4 md:-mt-6 mb-4 md:mb-6">
        <h1 className="text-xl font-bold tracking-[-0.01em] text-wk-graphite">
          {title}
        </h1>
        {action && <div className="ml-auto">{action}</div>}
      </header>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}
