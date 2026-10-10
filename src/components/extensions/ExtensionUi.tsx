import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Choice } from "@/components/workspace/shared";
import type { UiNode } from "@/lib/extensions/ui";
import type { FieldValues } from "@/lib/extensions/types";
export function ExtensionUi({
  node,
  values,
  onChange,
  onAction,
}: {
  node: UiNode;
  values: FieldValues;
  onChange: (id: string, value: string | boolean) => void;
  onAction: (action: string) => void;
}) {
  const prefix = useId();
  function render(n: UiNode, key: string): React.ReactNode {
    const id = `${prefix}-${n.id || key}`;
    const value = n.id && Object.hasOwn(values, n.id) ? values[n.id] : n.value;
    const children = () => n.children?.map((c, i) => render(c, `${key}-${i}`));
    switch (n.type) {
      case "stack":
        return (
          <div key={key} className="space-y-4">
            {children()}
          </div>
        );
      case "row":
        return (
          <div key={key} className="flex flex-wrap items-center gap-3">
            {children()}
          </div>
        );
      case "section":
        return (
          <section key={key} className="space-y-4 border-t pt-5">
            {n.text && <h2 className="text-sm font-medium">{n.text}</h2>}
            {children()}
          </section>
        );
      case "heading":
        return (
          <h2 key={key} className="text-base font-semibold">
            {n.text}
          </h2>
        );
      case "text":
        return (
          <p
            key={key}
            className="whitespace-pre-wrap break-words text-sm leading-6"
          >
            {n.text}
          </p>
        );
      case "code":
        return (
          <pre
            key={key}
            className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs"
          >
            <code>{n.text}</code>
          </pre>
        );
      case "badge":
        return (
          <Badge key={key} variant="secondary">
            {n.text}
          </Badge>
        );
      case "separator":
        return <hr key={key} />;
      case "button":
        return (
          <Button
            key={key}
            variant={n.variant || "outline"}
            disabled={n.disabled}
            onClick={() => onAction(n.action!)}
          >
            {n.text}
          </Button>
        );
      case "checkbox":
        return (
          <div key={key} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={value === true}
              disabled={n.disabled}
              onCheckedChange={(v) => onChange(n.id!, v === true)}
            />
            <Label htmlFor={id}>{n.label}</Label>
          </div>
        );
      case "input":
      case "textarea":
        return (
          <div key={key} className="min-w-0 space-y-2">
            <Label htmlFor={id}>{n.label}</Label>
            {n.type === "input" ? (
              <Input
                id={id}
                value={typeof value === "string" ? value : ""}
                disabled={n.disabled}
                maxLength={32000}
                onChange={(e) => onChange(n.id!, e.target.value)}
              />
            ) : (
              <Textarea
                id={id}
                className="h-40 resize-y field-sizing-fixed"
                value={typeof value === "string" ? value : ""}
                disabled={n.disabled}
                maxLength={32000}
                onChange={(e) => onChange(n.id!, e.target.value)}
              />
            )}
          </div>
        );
      case "select":
        return (
          <div key={key} className="space-y-2">
            <Label>{n.label}</Label>
            <Choice
              label={n.label!}
              value={typeof value === "string" ? value : ""}
              options={n.options || []}
              disabled={n.disabled}
              onChange={(v) => onChange(n.id!, v)}
              className="w-full"
            />
          </div>
        );
      case "table":
        return (
          <Table key={key}>
            <TableHeader>
              <TableRow>
                {n.columns!.map((c, i) => (
                  <TableHead key={i}>{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {n.rows!.map((row, i) => (
                <TableRow key={i}>
                  {row.map((cell, j) => (
                    <TableCell
                      key={j}
                      className="max-w-80 whitespace-pre-wrap break-words"
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
    }
  }
  return render(node, "root");
}
