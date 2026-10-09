import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import type { RemoteModel } from "@/lib/providers";
export function ProviderModelInput({
  id,
  label,
  value,
  onChange,
  models,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  models: RemoteModel[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = models.filter((m) =>
    `${m.id} ${m.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="输入模型 ID，或从列表选择"
        />
        <Popover
          open={open}
          onOpenChange={(value) => {
            setOpen(value);
            if (!value) setQuery("");
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label={`选择${label}`}
              disabled={!models.length}
            >
              <ChevronsUpDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-80 max-w-[calc(100vw-2rem)] p-2"
          >
            <Input
              aria-label={`搜索${label}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模型…"
              className="mb-2"
            />
            <div className="max-h-64 overflow-auto">
              {filtered.map((m) => (
                <Button
                  key={m.id}
                  variant="ghost"
                  className="h-auto w-full justify-start py-2 text-left"
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{m.name}</span>
                    {m.id !== m.name && (
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {m.id}
                      </span>
                    )}
                  </span>
                </Button>
              ))}
              {!filtered.length && (
                <p className="p-3 text-sm text-muted-foreground">
                  没有匹配的模型，可在输入框中手动填写。
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
