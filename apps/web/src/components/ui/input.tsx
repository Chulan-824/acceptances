import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn("ui-input", type === "file" && "ui-file-input", className)}
      {...props}
    />
  );
}

export { Input };
