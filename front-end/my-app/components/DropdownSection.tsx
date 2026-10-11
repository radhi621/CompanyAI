import type { ReactNode } from "react";

export function DropdownSection(input: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <details
      open={input.defaultOpen}
      className="group rounded-xl border border-[#d8ccb6] bg-[#fffaf1] p-3"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#d6c9b4] bg-[#f8f1e4] text-[#6b5d47]">
            {input.icon}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-[#7e7058]">
              {input.title}
            </p>
            {input.subtitle && <p className="mt-0.5 text-[11px] text-[#85775d]">{input.subtitle}</p>}
          </div>
        </div>
        <span className="text-xs text-[#7f7057] transition-transform group-open:rotate-180">v</span>
      </summary>
      <div className="mt-3 border-t border-[#ebe1d1] pt-3">{input.children}</div>
    </details>
  );
}
