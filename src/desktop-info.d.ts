export {};

declare global {
  interface Window {
    desktopInfo?: {
      isDesktop: boolean;
      platform?: string;
      versions?: Record<string, string>;
      beep?: () => Promise<boolean>;
    };
  }
}
