export type MaximisableAction = "open" | "close" | "toggle";

export function nextMaximisedState(prev: boolean, action: MaximisableAction): boolean {
  switch (action) {
    case "open":
      return true;
    case "close":
      return false;
    case "toggle":
      return !prev;
  }
}
