import { useEffect, useState } from "react";
import { Copy, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { BrandMark } from "./BrandMark";
import { Button } from "@/components/ui/button";
import { call, desktop } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { version as previewVersion } from "../../../package.json";

export function About() {
  const [info, setInfo] = useState<{
    version: string;
    os: string;
    arch: string;
  }>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!desktop) return;
    let stopped = false;
    void call<{ version: string; os: string; arch: string }>("app_info")
      .then((value) => {
        if (!stopped) setInfo(value);
      })
      .catch(() => {
        if (!stopped) setError("无法读取版本信息");
      });
    return () => {
      stopped = true;
    };
  }, []);
  const links = [
    ["source", "项目主页", ""],
    ["releases", "版本记录", "/releases"],
    ["guide", "使用文档", "/blob/main/docs/USAGE.md"],
    ["issues", "反馈问题", "/issues/new"],
    ["credits", "图标来源与许可", "/blob/main/public/agents/README.md"],
  ];
  return (
    <section className="max-w-xl">
      <div className="flex items-center gap-5 py-5">
        <BrandMark className="size-14 shrink-0" />
        <div>
          <h2 className="text-xl font-semibold">OiAgent</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {desktop
              ? info
                ? `版本 ${info.version}`
                : error || "正在读取版本…"
              : `版本 ${previewVersion} · 浏览器预览`}
          </p>
        </div>
      </div>
      {info && (
        <div className="mb-5 flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {(
              { macos: "macOS", windows: "Windows", linux: "Linux" } as Record<
                string,
                string
              >
            )[info.os] || info.os}{" "}
            · {info.arch}
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              void copyText(`OiAgent ${info.version}\n${info.os} ${info.arch}`)
            }
          >
            <Copy className="size-3.5" />
            复制版本信息
          </Button>
        </div>
      )}
      <div className="divide-y border-y">
        {links.map(([page, label, suffix]) => (
          <Button
            key={page}
            asChild
            variant="ghost"
            className="h-12 w-full justify-between rounded-none px-0 font-normal hover:bg-transparent hover:text-muted-foreground"
          >
            <a
              href={`https://github.com/yemaster/OiAgent${suffix}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                if (desktop) {
                  e.preventDefault();
                  void call("open_project_link", { page }).catch((e) =>
                    toast.error(String(e)),
                  );
                }
              }}
            >
              {label}
              <ArrowUpRight className="size-4 text-muted-foreground" />
            </a>
          </Button>
        ))}
      </div>
    </section>
  );
}
