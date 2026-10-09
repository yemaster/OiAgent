import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
export class PaneBoundary extends Component<
  { children: ReactNode; label: string },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: unknown) {
    return { error: String(error) };
  }
  render() {
    if (this.state.error)
      return (
        <div
          role="alert"
          className="flex min-h-0 flex-1 flex-col items-start justify-center gap-3 p-6"
        >
          <p className="text-sm">{this.props.label}未能加载</p>
          <p className="max-w-xl break-words text-xs text-muted-foreground">
            {this.state.error}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => this.setState({ error: "" })}
          >
            重试
          </Button>
        </div>
      );
    return this.props.children;
  }
}
