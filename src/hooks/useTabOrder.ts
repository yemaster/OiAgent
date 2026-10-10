import { useState } from "react";

// Visual order is separate from visit history: dragging never changes the
// destination chosen when an active tab is closed.
export function reconcileTabOrder(order: string[], available: string[]) {
  const remaining = new Set(available);
  const next = order.filter((key) => remaining.delete(key));
  next.push(...remaining);
  return next;
}

export function moveTab(order: string[], active: string, target: string) {
  const from = order.indexOf(active);
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, active);
  return next;
}

export function useTabOrder(available: string[]) {
  const signature = JSON.stringify(available);
  const [saved, setSaved] = useState(() => ({ signature, order: available }));
  let order = saved.order;
  if (saved.signature !== signature) {
    // Reconcile before children render. Closed keys must disappear immediately,
    // and reopened tabs append instead of reclaiming an old position.
    order = reconcileTabOrder(order, available);
    setSaved({ signature, order });
  }
  return {
    order,
    move: (active: string, target: string) =>
      setSaved((previous) => {
        const next = moveTab(previous.order, active, target);
        return next === previous.order
          ? previous
          : { ...previous, order: next };
      }),
  };
}
