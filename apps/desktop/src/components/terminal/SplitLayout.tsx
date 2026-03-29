import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import type { SplitDirection } from "../../types/session";

interface SplitLayoutProps {
  direction: SplitDirection;
  count: number;
  children: ReactNode;
}

export function SplitLayout({ direction, count, children }: SplitLayoutProps) {
  return (
    <div
      className={cn(
        "grid min-h-[440px] gap-3",
        count <= 1 && "grid-cols-1",
        count === 2 && direction === "vertical" && "grid-cols-2",
        count === 2 && direction === "horizontal" && "grid-cols-1 grid-rows-2",
        count >= 3 && direction === "vertical" && "grid-cols-2",
        count >= 3 && direction === "horizontal" && "grid-cols-1 lg:grid-cols-2"
      )}
    >
      {children}
    </div>
  );
}
