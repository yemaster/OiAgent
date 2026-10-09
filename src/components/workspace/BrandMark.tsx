import { cn } from "@/lib/utils";

/** The alpha silhouette uses the surrounding text color in every theme. */
export function BrandMark({
  className,
  navigation = false,
}: {
  className?: string;
  navigation?: boolean;
}) {
  const source = navigation
    ? "/brand/oiagent-navigation.svg"
    : "/brand/mark/256x256.png";
  const size = navigation ? "100%" : "140%";
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-6 shrink-0 bg-current", className)}
      style={{
        maskImage: `url('${source}')`,
        maskSize: size,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        WebkitMaskImage: `url('${source}')`,
        WebkitMaskSize: size,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
      }}
    />
  );
}
