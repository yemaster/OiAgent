import { cn } from "@/lib/utils";

/** The alpha silhouette uses the surrounding text color in every theme. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-6 shrink-0 bg-current", className)}
      style={{
        maskImage: "url('/brand/mark/256x256.png')",
        maskSize: "140%",
        maskPosition: "center",
        maskRepeat: "no-repeat",
        WebkitMaskImage: "url('/brand/mark/256x256.png')",
        WebkitMaskSize: "140%",
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
      }}
    />
  );
}
