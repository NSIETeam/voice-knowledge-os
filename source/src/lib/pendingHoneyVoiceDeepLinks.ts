import { honeyVoiceRouteFromDeepLink } from "./honeyVoiceDeepLink";

/** Holds the most recent valid external destination until first-run onboarding is complete. */
export class PendingHoneyVoiceDeepLinks {
  private ready = false;
  private pendingRoute: string | null = null;

  constructor(private readonly navigate: (route: string) => void) {}

  receive(raw: string) {
    const route = honeyVoiceRouteFromDeepLink(raw);
    if (!route) return;
    if (this.ready) this.navigate(route);
    else this.pendingRoute = route;
  }

  setReady(ready: boolean) {
    this.ready = ready;
    if (!ready || !this.pendingRoute) return;
    const route = this.pendingRoute;
    this.pendingRoute = null;
    this.navigate(route);
  }
}
